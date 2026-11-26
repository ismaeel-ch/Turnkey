/**
 * Any endpoint that speaks the OpenAI chat-completions API: the SSI LiteLLM gateway, OpenAI itself, OpenRouter,
 * Azure OpenAI behind a proxy, a local Ollama. Plain fetch with streaming, no SDK.
 * Native tool calling is supported; retries and pacing come from ../http.
 */
import { createPacer, errorFromResponse, scrub, sseData, withRetries, type RetryOptions } from '../http';
import { LlmError, type ChatChunk, type ChatMessage, type ChatRequest, type Provider, type Tier, type ToolCall } from '../types';

export type OpenAiCompatibleConfig = {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  quickModel?: string;
  /** Requests per minute this endpoint allows. Calls beyond it wait a moment. Unset: no pacing. */
  perMinute?: number;
  retry?: RetryOptions;
  fetchImpl?: typeof fetch;
};

/** `host/litellm/v1` → `https://host/litellm/v1`. The address is used exactly as given otherwise. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
}

type StreamEvent = {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string };
};

/** Reads `data: {...}` lines from a server-sent event stream and yields the parsed objects. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  for await (const { data } of sseData(body)) yield data as StreamEvent;
}

export function toOpenAiMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
        })),
      };
    }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId || '', content: m.content };
    return { role: m.role, content: m.content };
  });
}

export function parseToolArgs(raw: string): unknown {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function openAiCompatible(config: OpenAiCompatibleConfig): Provider {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const doFetch = config.fetchImpl ?? fetch;
  const model = (tier: Tier) => (tier === 'quick' && config.quickModel ? config.quickModel : config.model);
  const pace = config.perMinute ? createPacer(config.perMinute) : null;

  return {
    id: config.id,
    nativeTools: true,
    model,
    async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
      const tools = request.tools?.length && request.toolChoice !== 'none' ? request.tools : undefined;
      const body = JSON.stringify({
        model: model(request.tier),
        messages: toOpenAiMessages(request.messages),
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: request.maxTokens,
        ...(tools
          ? {
              tools: tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.parameters },
              })),
              tool_choice: request.toolChoice === 'required' ? 'required' : 'auto',
            }
          : {}),
      });
      let res: Response;
      try {
        await pace?.();
        res = await withRetries(
          () =>
            doFetch(baseUrl + '/chat/completions', {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.apiKey },
              body,
              signal: request.signal,
            }),
          { ...config.retry, signal: request.signal },
        );
      } catch (e) {
        if (e instanceof LlmError) throw e;
        if (request.signal?.aborted) throw new LlmError('aborted', 'the call was stopped', 499);
        throw new LlmError('upstream', 'the model gateway could not be reached');
      }
      if (!res.ok || !res.body) throw await errorFromResponse(res);

      let truncated = false;
      let usage: { input?: number; output?: number } | undefined;
      const pending = new Map<number, { id: string; name: string; args: string }>();
      for await (const event of sseEvents(res.body)) {
        if (event.error) throw new LlmError('upstream', scrub(event.error.message || 'the model gateway reported an error'));
        const choice = event.choices?.[0];
        const text = choice?.delta?.content;
        if (text) yield { type: 'delta', text };
        for (const part of choice?.delta?.tool_calls ?? []) {
          const at = part.index ?? 0;
          const entry = pending.get(at) ?? { id: '', name: '', args: '' };
          if (part.id) entry.id = part.id;
          if (part.function?.name) entry.name += part.function.name;
          if (part.function?.arguments) entry.args += part.function.arguments;
          pending.set(at, entry);
        }
        if (choice?.finish_reason === 'length') truncated = true;
        if (event.usage) usage = { input: event.usage.prompt_tokens, output: event.usage.completion_tokens };
      }
      let n = 0;
      for (const [, entry] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
        if (!entry.name) continue;
        const call: ToolCall = { id: entry.id || 'call_' + ++n, name: entry.name, args: parseToolArgs(entry.args) };
        yield { type: 'tool_call', call };
      }
      yield { type: 'done', truncated, usage };
    },
  };
}

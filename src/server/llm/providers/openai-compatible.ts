/**
 * Any endpoint that speaks the OpenAI chat-completions API: the SSI LiteLLM gateway, OpenAI itself, OpenRouter,
 * Azure OpenAI behind a proxy, a local Ollama. Plain fetch with streaming, no SDK.
 * Native tool calling is supported; retries and pacing come from ../http.
 *
 * For Claude models (by name, see features.ts) three Claude features go through LiteLLM's OpenAI format:
 * - `reasoning_effort`: the tier's effort (LiteLLM turns it into Claude's effort setting). If the gateway refuses it,
 *   the call is sent once more without it and the model is remembered, so later calls leave it out.
 * - `cache_control` on the system prompt, which holds the stable part (role prompt, catalog, tool list). LiteLLM
 *   passes it on to Anthropic; cache hits come back as `cache_read_input_tokens` / `prompt_tokens_details`.
 * - usage with cache reads and writes, so the cost of each call can be worked out.
 * No `temperature` is ever sent, and the tool choice is always `auto`.
 */
import { effortFor, isClaudeModel, withRequiredNote } from '../features';
import { createPacer, errorFromResponse, scrub, sseData, withRetries, type RetryOptions } from '../http';
import {
  LlmError,
  type ChatChunk,
  type ChatMessage,
  type ChatRequest,
  type Provider,
  type Tier,
  type ToolCall,
  type Usage,
} from '../types';

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
  /** Send effort and cache marks. Default: only when the model name is a Claude model. */
  claudeFeatures?: boolean;
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
  usage?: OpenAiUsage | null;
  error?: { message?: string };
};

type OpenAiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number } | null;
  /** LiteLLM adds Anthropic's own counts for Claude models. */
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

/**
 * Usage in the gateway's terms. `prompt_tokens` counts cached input too, so the cached parts are taken out of it:
 * `input` is only the input that was neither read from nor written to the cache.
 */
export function readUsage(u: OpenAiUsage): Usage {
  const cacheRead = u.cache_read_input_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const out: Usage = { input: Math.max(0, (u.prompt_tokens ?? 0) - cacheRead - cacheWrite), output: u.completion_tokens };
  if (cacheRead) out.cacheRead = cacheRead;
  if (cacheWrite) out.cacheWrite = cacheWrite;
  return out;
}

/**
 * Marks the end of the leading system messages for caching: everything before and including it (tools, then system
 * prompt) is the stable prefix. The conversation that follows changes on every call and is not marked.
 */
export function markCache(messages: Record<string, unknown>[]): Record<string, unknown>[] {
  let last = -1;
  while (last + 1 < messages.length && messages[last + 1].role === 'system') last++;
  if (last < 0 || typeof messages[last].content !== 'string' || !messages[last].content) return messages;
  const out = messages.slice();
  out[last] = { ...out[last], content: [{ type: 'text', text: messages[last].content, cache_control: { type: 'ephemeral' } }] };
  return out;
}

/** Does a refusal look like the gateway not accepting the effort setting? */
const refusedEffort = (detail: string) => /reasoning|effort|thinking|output_config/i.test(detail);

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
  /** Models whose gateway refused `reasoning_effort` once: it is left out for them from then on. */
  const noEffort = new Set<string>();

  return {
    id: config.id,
    nativeTools: true,
    model,
    async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
      const name = model(request.tier);
      const claude = config.claudeFeatures ?? isClaudeModel(name);
      const tools = request.tools?.length && request.toolChoice !== 'none' ? request.tools : undefined;
      let messages = toOpenAiMessages(tools ? withRequiredNote(request.messages, request.toolChoice) : request.messages);
      if (claude && request.cache !== false) messages = markCache(messages);
      const bodyWith = (effort: boolean) =>
        JSON.stringify({
          model: name,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: request.maxTokens,
          ...(effort ? { reasoning_effort: effortFor(request) } : {}),
          ...(tools
            ? {
                tools: tools.map((t) => ({
                  type: 'function',
                  function: { name: t.name, description: t.description, parameters: t.parameters },
                })),
                tool_choice: 'auto',
              }
            : {}),
        });
      const send = (body: string, attempts?: number) =>
        withRetries(
          () =>
            doFetch(baseUrl + '/chat/completions', {
              method: 'POST',
              headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.apiKey },
              body,
              signal: request.signal,
            }),
          { ...config.retry, ...(attempts ? { attempts } : {}), signal: request.signal },
        );
      let res: Response;
      try {
        await pace?.();
        const effort = claude && !noEffort.has(name);
        res = await send(bodyWith(effort));
        if (effort && res.status === 400) {
          const detail = await res
            .clone()
            .text()
            .catch(() => '');
          if (refusedEffort(detail)) {
            // A 400 is not retried by withRetries, so this second request keeps the step within three attempts.
            noEffort.add(name);
            await res.body?.cancel().catch(() => undefined);
            res = await send(bodyWith(false), 2);
          }
        }
      } catch (e) {
        if (e instanceof LlmError) throw e;
        if (request.signal?.aborted) throw new LlmError('aborted', 'the call was stopped', 499);
        throw new LlmError('upstream', 'the model gateway could not be reached');
      }
      if (!res.ok || !res.body) throw await errorFromResponse(res);

      let truncated = false;
      let usage: Usage | undefined;
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
        if (event.usage) usage = readUsage(event.usage);
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

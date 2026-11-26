/**
 * Any endpoint that speaks the OpenAI chat-completions API: the SSI LiteLLM gateway, OpenAI itself, OpenRouter,
 * Azure OpenAI behind a proxy, a local Ollama. Plain fetch with streaming, no SDK.
 */
import { LlmError, type ChatChunk, type ChatRequest, type Provider, type Tier } from '../types';

export type OpenAiCompatibleConfig = {
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  quickModel?: string;
  fetchImpl?: typeof fetch;
};

/** `host/litellm/v1` → `https://host/litellm/v1`. The address is used exactly as given otherwise. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
}

type StreamEvent = {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string };
};

/** Reads `data: {...}` lines from a server-sent event stream and yields the parsed objects. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = function* (line: string): Generator<StreamEvent> {
    const text = line.trim();
    if (!text.startsWith('data:')) return;
    const data = text.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      yield JSON.parse(data) as StreamEvent;
    } catch {
      // a partial or non-JSON keep-alive line: ignore it
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        yield* parse(buffer.slice(0, at));
        buffer = buffer.slice(at + 1);
      }
    }
    yield* parse(buffer + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export function openAiCompatible(config: OpenAiCompatibleConfig): Provider {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const doFetch = config.fetchImpl ?? fetch;
  const model = (tier: Tier) => (tier === 'quick' && config.quickModel ? config.quickModel : config.model);

  return {
    id: config.id,
    model,
    async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
      let res: Response;
      try {
        res = await doFetch(baseUrl + '/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + config.apiKey },
          body: JSON.stringify({
            model: model(request.tier),
            messages: request.messages,
            stream: true,
            max_tokens: request.maxTokens,
            temperature: request.temperature,
          }),
          signal: request.signal,
        });
      } catch (e) {
        if (request.signal?.aborted) throw new LlmError('aborted', 'the call was stopped', 499);
        throw new LlmError('upstream', 'the model gateway could not be reached: ' + String((e as Error)?.message || e));
      }
      if (!res.ok || !res.body) {
        // Never pass a key on, not even the masked fragment some gateways echo back.
        const detail = (await res.text().catch(() => '')).slice(0, 300).replace(/\b(sk|pk|key)-[A-Za-z0-9_\-.]{3,}/gi, '$1-…');
        if (res.status === 401 || res.status === 403) throw new LlmError('unauthorized', 'the model gateway refused the key', 401);
        if (res.status === 429) throw new LlmError('rate_limited', 'the model gateway is rate limiting', 429);
        if (/budget/i.test(detail)) throw new LlmError('budget', 'the model budget is used up', 429);
        throw new LlmError(
          res.status >= 500 ? 'upstream' : 'bad_request',
          'the model gateway answered ' + res.status + (detail ? ': ' + detail : ''),
        );
      }
      let truncated = false;
      let usage: { input?: number; output?: number } | undefined;
      for await (const event of sseEvents(res.body)) {
        if (event.error) throw new LlmError('upstream', event.error.message || 'the model gateway reported an error');
        const choice = event.choices?.[0];
        const text = choice?.delta?.content;
        if (text) yield { type: 'delta', text };
        if (choice?.finish_reason === 'length') truncated = true;
        if (event.usage) usage = { input: event.usage.prompt_tokens, output: event.usage.completion_tokens };
      }
      yield { type: 'done', truncated, usage };
    },
  };
}

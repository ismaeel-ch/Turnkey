/**
 * Anthropic's Messages API with streaming, over plain fetch. Native tool calling.
 *
 * Claude features used: `output_config.effort` from the tier (see features.ts), a `cache_control` mark on the system
 * prompt (tools and system prompt are the stable prefix; the conversation after it is not cached), cache reads and
 * writes in usage, tool choice always `auto`, and no sampling settings.
 */
import { effortFor, withRequiredNote } from '../features';
import { createPacer, errorFromResponse, scrub, sseData, withRetries, type RetryOptions } from '../http';
import { LlmError, type ChatChunk, type ChatMessage, type ChatRequest, type Provider, type Tier, type Usage } from '../types';

export type AnthropicConfig = {
  apiKey: string;
  model: string;
  quickModel?: string;
  baseUrl?: string;
  perMinute?: number;
  retry?: RetryOptions;
  fetchImpl?: typeof fetch;
};

type AnthropicUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

type Block = { type: string; [key: string]: unknown };
type Turn = { role: 'user' | 'assistant'; content: Block[] };

/** System text goes in its own field; tool results ride in user turns; neighbouring turns of one role are merged. */
export function toAnthropicMessages(messages: ChatMessage[]): { system: string; messages: Turn[] } {
  const system: string[] = [];
  const turns: Turn[] = [];
  const push = (role: Turn['role'], blocks: Block[]) => {
    if (!blocks.length) return;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else turns.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'system') system.push(m.content);
    else if (m.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId || '', content: m.content }]);
    else if (m.role === 'assistant') {
      const blocks: Block[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? [])
        blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args && typeof c.args === 'object' ? c.args : {} });
      push('assistant', blocks);
    } else push('user', m.content ? [{ type: 'text', text: m.content }] : []);
  }
  if (!turns.length || turns[0].role !== 'user') turns.unshift({ role: 'user', content: [{ type: 'text', text: '(start)' }] });
  return { system: system.join('\n\n'), messages: turns };
}

export function anthropic(config: AnthropicConfig): Provider {
  const baseUrl = (config.baseUrl?.trim() || 'https://api.anthropic.com').replace(/\/+$/, '');
  const doFetch = config.fetchImpl ?? fetch;
  const model = (tier: Tier) => (tier === 'quick' && config.quickModel ? config.quickModel : config.model);
  const pace = config.perMinute ? createPacer(config.perMinute) : null;

  return {
    id: 'anthropic',
    nativeTools: true,
    model,
    async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
      const tools = request.tools?.length && request.toolChoice !== 'none' ? request.tools : undefined;
      const { system, messages } = toAnthropicMessages(tools ? withRequiredNote(request.messages, request.toolChoice) : request.messages);
      const body = JSON.stringify({
        model: model(request.tier),
        max_tokens: request.maxTokens ?? 4096,
        system: system
          ? [{ type: 'text', text: system, ...(request.cache !== false ? { cache_control: { type: 'ephemeral' } } : {}) }]
          : undefined,
        messages,
        stream: true,
        output_config: { effort: effortFor(request) },
        ...(tools
          ? {
              tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })),
              tool_choice: { type: 'auto' },
            }
          : {}),
      });
      let res: Response;
      try {
        await pace?.();
        res = await withRetries(
          () =>
            doFetch(baseUrl + '/v1/messages', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
              body,
              signal: request.signal,
            }),
          { ...config.retry, signal: request.signal },
        );
      } catch (e) {
        if (e instanceof LlmError) throw e;
        if (request.signal?.aborted) throw new LlmError('aborted', 'the call was stopped', 499);
        throw new LlmError('upstream', 'the model could not be reached');
      }
      if (!res.ok || !res.body) throw await errorFromResponse(res);

      let truncated = false;
      const usage: Usage = {};
      const take = (u?: AnthropicUsage) => {
        if (!u) return;
        if (u.input_tokens !== undefined) usage.input = u.input_tokens;
        if (u.output_tokens !== undefined) usage.output = u.output_tokens;
        if (u.cache_read_input_tokens) usage.cacheRead = u.cache_read_input_tokens;
        if (u.cache_creation_input_tokens) usage.cacheWrite = u.cache_creation_input_tokens;
      };
      const blocks = new Map<number, { id: string; name: string; json: string }>();
      for await (const { data } of sseData(res.body)) {
        const ev = data as {
          type?: string;
          index?: number;
          message?: { usage?: AnthropicUsage };
          content_block?: { type?: string; id?: string; name?: string };
          delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
          usage?: AnthropicUsage;
          error?: { message?: string; type?: string };
        };
        if (ev.type === 'error') {
          const overloaded = ev.error?.type === 'overloaded_error';
          throw new LlmError(
            overloaded ? 'rate_limited' : 'upstream',
            scrub(ev.error?.message || 'the model reported an error'),
            overloaded ? 429 : 502,
          );
        }
        if (ev.type === 'message_start') take(ev.message?.usage);
        else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
          blocks.set(ev.index ?? 0, { id: ev.content_block.id || '', name: ev.content_block.name || '', json: '' });
        } else if (ev.type === 'content_block_delta') {
          if (ev.delta?.type === 'text_delta' && ev.delta.text) yield { type: 'delta', text: ev.delta.text };
          else if (ev.delta?.type === 'input_json_delta') {
            const b = blocks.get(ev.index ?? 0);
            if (b) b.json += ev.delta.partial_json || '';
          }
        } else if (ev.type === 'content_block_stop') {
          const b = blocks.get(ev.index ?? 0);
          if (b) {
            blocks.delete(ev.index ?? 0);
            let args: unknown = {};
            if (b.json.trim()) {
              try {
                args = JSON.parse(b.json);
              } catch {
                args = b.json;
              }
            }
            yield { type: 'tool_call', call: { id: b.id, name: b.name, args } };
          }
        } else if (ev.type === 'message_delta') {
          if (ev.delta?.stop_reason === 'max_tokens') truncated = true;
          // Current Claude models can decline a request (HTTP 200, stop_reason "refusal"). Say so instead of an empty answer.
          if (ev.delta?.stop_reason === 'refusal') throw new LlmError('bad_request', 'the model declined this request', 422);
          take(ev.usage);
        }
      }
      yield { type: 'done', truncated, usage: Object.keys(usage).length ? usage : undefined };
    },
  };
}

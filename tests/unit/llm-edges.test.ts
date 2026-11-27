/**
 * The model gateway's less travelled paths: dropped connections, stops, malformed streams, odd tool calls, and the
 * AI SDK adapter's edges. Providers get a fake `fetch` (the network boundary); nothing here mocks gateway code.
 */
import { generateText, streamText } from 'ai';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart } from '@ai-sdk/provider';
import { toAiSdkModel, fromAiSdkPrompt } from '@/server/llm/ai-sdk';
import { createPacer, errorFromResponse, sseData, withRetries } from '@/server/llm/http';
import { anthropic, toAnthropicMessages } from '@/server/llm/providers/anthropic';
import { openAiCompatible, parseToolArgs } from '@/server/llm/providers/openai-compatible';
import { firstJsonObject, forgetToolModes, parseToolReply, toolModeFor, withTools } from '@/server/llm/tools';
import { LlmError, type ChatChunk, type ChatRequest, type Provider, type ToolDef } from '@/server/llm/types';

const enc = new TextEncoder();
const sse = (lines: string[], status = 200) =>
  new Response(new ReadableStream({ start: (c) => (lines.forEach((l) => c.enqueue(enc.encode(l))), c.close()) }), { status });
const asFetch = (f: (url: string, init: RequestInit) => Promise<Response>) => f as unknown as typeof fetch;
const noWait = { sleep: async () => undefined };
const NOTE: ToolDef = {
  name: 'add_note',
  description: 'Add a note',
  parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
};
const ask = (extra: Partial<ChatRequest> = {}): ChatRequest => ({ messages: [{ role: 'user', content: 'hi' }], tier: 'default', ...extra });

async function collect(source: AsyncIterable<ChatChunk>) {
  const out: ChatChunk[] = [];
  for await (const chunk of source) out.push(chunk);
  return out;
}
async function failure(source: AsyncIterable<ChatChunk>): Promise<LlmError> {
  try {
    await collect(source);
  } catch (e) {
    return e as LlmError;
  }
  throw new Error('expected the stream to fail');
}

/** A provider that yields the given chunks, or throws once it reaches an Error. */
const scripted = (chunks: Array<ChatChunk | Error>, id = 'scripted'): Provider => ({
  id,
  model: () => 'scripted-1',
  async *stream() {
    for (const c of chunks) {
      if (c instanceof Error) throw c;
      yield c;
    }
  },
});

describe('http helpers', () => {
  it('a stop during the wait between tries ends the call as aborted', async () => {
    const stop = new AbortController();
    const pending = withRetries(async () => new Response('', { status: 503 }), { baseMs: 10_000, signal: stop.signal });
    setTimeout(() => stop.abort(), 5);
    await expect(pending).rejects.toMatchObject({ code: 'aborted', status: 499 });
  });

  it('a stop before the first try sends nothing', async () => {
    const stop = new AbortController();
    stop.abort();
    let sent = 0;
    await expect(withRetries(async () => (sent++, new Response('ok')), { signal: stop.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(sent).toBe(0);
  });

  it('a stop while a request is out is not retried', async () => {
    const stop = new AbortController();
    let sent = 0;
    const send = async () => {
      sent++;
      stop.abort();
      throw new TypeError('fetch failed');
    };
    await expect(withRetries(send, { ...noWait, signal: stop.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(sent).toBe(1);
  });

  it('never tries more than three times, whatever it is asked', async () => {
    let sent = 0;
    const res = await withRetries(async () => (sent++, new Response('', { status: 502 })), { ...noWait, attempts: 10 });
    expect(res.status).toBe(502);
    expect(sent).toBe(3);
  });

  it('caps a long Retry-After at the longest wait', async () => {
    const waits: number[] = [];
    const answers = [new Response('', { status: 429, headers: { 'retry-after': '3600' } }), new Response('ok')];
    await withRetries(async () => answers.shift()!, { maxMs: 2000, sleep: async (ms) => void waits.push(ms) });
    expect(waits).toEqual([2000]);
  });

  it('a non-Error thrown by fetch still ends as an Error', async () => {
    await expect(
      withRetries(async () => {
        throw 'boom';
      }, noWait),
    ).rejects.toThrow('the request failed');
  });

  it('the pacer waits for room when the wait is short', async () => {
    let t = 0;
    const waits: number[] = [];
    const pace = createPacer(2, { now: () => t, sleep: async (ms) => void (waits.push(ms), (t += ms)), maxWaitMs: 70_000 });
    await pace();
    await pace();
    await pace();
    expect(waits).toEqual([60_005]);
  });

  it('maps refusals: key, budget, rate, upstream, bad request', async () => {
    expect(await errorFromResponse(new Response('', { status: 403 }))).toMatchObject({ code: 'unauthorized', status: 401 });
    expect(await errorFromResponse(new Response('Budget has been exceeded', { status: 400 }))).toMatchObject({ code: 'budget' });
    expect(await errorFromResponse(new Response('slow down', { status: 429 }))).toMatchObject({ code: 'rate_limited' });
    // Anthropic's "overloaded" is the model being busy for everyone: the same as a rate limit, not a broken service
    expect(await errorFromResponse(new Response('{"type":"error","error":{"type":"overloaded_error"}}', { status: 529 }))).toMatchObject({
      code: 'rate_limited',
      status: 429,
    });
    expect(await errorFromResponse(new Response('', { status: 502 }))).toMatchObject({
      code: 'upstream',
      message: 'the model gateway answered 502',
    });
    const bad = await errorFromResponse(new Response('see https://gw.example.test/x for sk-abcdefgh1234', { status: 422 }));
    expect(bad.code).toBe('bad_request');
    expect(bad.message).not.toContain('gw.example.test');
    expect(bad.message).not.toContain('abcdefgh1234');
  });

  it('reads server-sent events split across reads, with names, keep-alives and a last line with no newline', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const part of ['event: ping\ndata: {"a"', ':1}\n: keep-alive\ndata: not json\n\ndata: [DONE]\n', 'data: {"b":2}'])
          c.enqueue(enc.encode(part));
        c.close();
      },
    });
    const out = [];
    for await (const ev of sseData(body)) out.push(ev);
    expect(out).toEqual([
      { event: 'ping', data: { a: 1 } },
      { event: 'ping', data: { b: 2 } },
    ]);
  });

  it('cancels the upstream body when the reader stops early, and leaves a finished one alone', async () => {
    const open = (reasons: unknown[]) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode('data: {"n":1}\ndata: {"n":2}\n'));
        },
        cancel: (reason) => void reasons.push(reason),
      });
    const cancelled: unknown[] = [];
    for await (const ev of sseData(open(cancelled))) {
      expect(ev.data).toEqual({ n: 1 });
      break; // the answer meter, say, cut the answer here
    }
    expect(cancelled).toHaveLength(1);

    const untouched: unknown[] = [];
    const done = new ReadableStream<Uint8Array>({
      start: (c) => (c.enqueue(enc.encode('data: {"n":1}\n')), c.close()),
      cancel: (reason) => void untouched.push(reason),
    });
    for await (const ev of sseData(done)) void ev;
    expect(untouched).toHaveLength(0);
  });
});

describe('anthropic provider edges', () => {
  const make = (answer: (url: string, init: RequestInit) => Promise<Response>) =>
    anthropic({ apiKey: 'test-key', model: 'claude-test', fetchImpl: asFetch(answer), retry: noWait });

  it('a dropped connection is "could not be reached", a stop is "aborted"', async () => {
    const down = make(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await failure(down.stream(ask()))).toMatchObject({ code: 'upstream', message: 'the model could not be reached' });

    const stop = new AbortController();
    const stopped = make(async () => {
      stop.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    expect(await failure(stopped.stream(ask({ signal: stop.signal })))).toMatchObject({ code: 'aborted' });
  });

  it('an empty body is reported, not read', async () => {
    const p = make(async () => new Response(null, { status: 200 }));
    const e = await failure(p.stream(ask()));
    // the service failed, not the request: reported as upstream, naming the status
    expect(e).toBeInstanceOf(LlmError);
    expect(e).toMatchObject({ code: 'upstream', message: 'the model gateway answered 200 with no body' });
  });

  it('assembles tool input from pieces; empty input is {}, broken input stays text', async () => {
    const p = make(async () =>
      sse([
        'data: {"type":"message_start","message":{"usage":{"input_tokens":9}}}\n',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t1","name":"add_note"}}\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"title\\":"}}\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"a\\"}"}}\n',
        'data: {"type":"content_block_stop","index":0}\n',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t2","name":"add_note"}}\n',
        'data: {"type":"content_block_stop","index":1}\n',
        'data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"t3","name":"add_note"}}\n',
        'data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{oops"}}\n',
        'data: {"type":"content_block_stop","index":2}\n',
        'data: {"type":"content_block_stop","index":7}\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":4}}\n',
      ]),
    );
    const out = await collect(p.stream(ask({ tools: [NOTE] })));
    expect(out.filter((c) => c.type === 'tool_call').map((c) => (c as { call: unknown }).call)).toEqual([
      { id: 't1', name: 'add_note', args: { title: 'a' } },
      { id: 't2', name: 'add_note', args: {} },
      { id: 't3', name: 'add_note', args: '{oops' },
    ]);
    expect(out.at(-1)).toEqual({ type: 'done', truncated: false, usage: { input: 9, output: 4 } });
  });

  it('an overloaded model is "rate limited"; another stream error is "upstream"', async () => {
    const over = make(async () => sse(['data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n']));
    expect(await failure(over.stream(ask()))).toMatchObject({ code: 'rate_limited', status: 429 });
    const other = make(async () => sse(['data: {"type":"error","error":{}}\n']));
    expect(await failure(other.stream(ask()))).toMatchObject({ code: 'upstream', message: 'the model reported an error' });
  });

  it('with toolChoice none, sends no tools; with cache off, no cache mark', async () => {
    let sent: Record<string, unknown> = {};
    const p = make(async (_url, init) => ((sent = JSON.parse(String(init.body))), sse(['data: {"type":"message_stop"}\n'])));
    await collect(
      p.stream(
        ask({
          tools: [NOTE],
          toolChoice: 'none',
          cache: false,
          messages: [
            { role: 'system', content: 'S' },
            { role: 'user', content: 'hi' },
          ],
        }),
      ),
    );
    expect(sent.tools).toBeUndefined();
    expect(sent.system).toEqual([{ type: 'text', text: 'S' }]);
  });

  it('a conversation that starts with the assistant, or with nothing, gets a user turn first', () => {
    expect(toAnthropicMessages([{ role: 'assistant', content: 'Hello' }]).messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'text', text: '(start)' }],
    });
    expect(toAnthropicMessages([{ role: 'user', content: '' }]).messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: '(start)' }] },
    ]);
    const call = toAnthropicMessages([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'add_note', args: 'not an object' }] },
      { role: 'tool', content: 'done' },
    ]).messages;
    expect(call[1].content).toEqual([{ type: 'tool_use', id: 'c', name: 'add_note', input: {} }]);
    expect(call[2].content).toEqual([{ type: 'tool_result', tool_use_id: '', content: 'done' }]);
  });
});

describe('OpenAI-compatible provider edges', () => {
  const make = (answer: (url: string, init: RequestInit) => Promise<Response>) =>
    openAiCompatible({
      id: 'litellm',
      baseUrl: 'https://gw.example.test/v1',
      apiKey: 'test-key',
      model: 'gpt-test',
      fetchImpl: asFetch(answer),
      retry: noWait,
    });

  it('a dropped connection is "could not be reached", a stop is "aborted"', async () => {
    const down = make(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await failure(down.stream(ask()))).toMatchObject({ code: 'upstream', message: 'the model gateway could not be reached' });
    const stop = new AbortController();
    const stopped = make(async () => {
      stop.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    expect(await failure(stopped.stream(ask({ signal: stop.signal })))).toMatchObject({ code: 'aborted' });
  });

  it('an error inside the stream ends it, with no address or key in the message', async () => {
    const p = make(async () =>
      sse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
        'data: {"error":{"message":"failed at https://gw.example.test with Bearer abc.def"}}\n',
      ]),
    );
    const e = await failure(p.stream(ask()));
    expect(e.code).toBe('upstream');
    expect(e.message).not.toContain('gw.example.test');
    expect(e.message).not.toContain('abc.def');
  });

  it('a call with no name is dropped, a call with no id gets one, calls come in index order', async () => {
    const p = make(async () =>
      sse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"name":"add_","arguments":"{\\"title\\""}}]}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"function":{"name":"note","arguments":":\\"b\\"}"}}]}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"x0","function":{"name":"add_note"}}]}}]}\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":2,"function":{"arguments":"{}"}}]}}]}\n',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n',
      ]),
    );
    const out = await collect(p.stream(ask({ tools: [NOTE] })));
    expect(out).toEqual([
      { type: 'tool_call', call: { id: 'x0', name: 'add_note', args: {} } },
      { type: 'tool_call', call: { id: 'call_1', name: 'add_note', args: { title: 'b' } } },
      { type: 'done', truncated: true, usage: undefined },
    ]);
  });

  it('reads tool arguments: empty is {}, broken stays text', () => {
    expect(parseToolArgs('  ')).toEqual({});
    expect(parseToolArgs('{"a":1}')).toEqual({ a: 1 });
    expect(parseToolArgs('{oops')).toBe('{oops');
  });
});

describe('tools wrapper edges', () => {
  beforeEach(() => forgetToolModes());

  it('reads JSON-protocol replies: strings inside, escaped quotes, string arguments, unknown tools', () => {
    expect(firstJsonObject('text {"a":"x}\\"y","b":{"c":1}} after')).toEqual({ a: 'x}"y', b: { c: 1 } });
    expect(firstJsonObject('{"never closed"')).toBeUndefined();
    expect(firstJsonObject('{bad json}')).toBeUndefined();
    let n = 0;
    const id = () => 'j' + ++n;
    expect(parseToolReply('{"tool_calls":[{"name":"add_note","arguments":"{\\"title\\":\\"s\\"}"}]}', [NOTE], id)).toEqual([
      { id: 'j1', name: 'add_note', args: { title: 's' } },
    ]);
    expect(parseToolReply('{"tool_calls":[{"name":"add_note","args":"plain"}]}', [NOTE], id)).toEqual([
      { id: 'j2', name: 'add_note', args: 'plain' },
    ]);
    expect(parseToolReply('{"tool_calls":[]}', [NOTE], id)).toBeNull();
    expect(parseToolReply('{"tool_calls":[{"name":"rm_rf"}]}', [NOTE], id)).toBeNull();
  });

  it('a refused key during the tool probe is reported, not taken as "no tools"', async () => {
    const p: Provider = { ...scripted([new LlmError('unauthorized', 'the model gateway refused the key', 401)]), nativeTools: true };
    await expect(toolModeFor(p, 'default', {})).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('any other probe failure means JSON', async () => {
    const p: Provider = { ...scripted([new Error('weird')]), nativeTools: true };
    expect(await toolModeFor(p, 'default', {})).toBe('json');
  });

  it('a fixed tool mode needs no probe; LLM_TOOL_MODE=json wins over everything', async () => {
    const fixed: Provider = { ...scripted([new Error('must not be called')]), fixedToolMode: 'native', nativeTools: true };
    expect(await toolModeFor(fixed, 'default', {})).toBe('native');
    expect(await toolModeFor(fixed, 'default', { LLM_TOOL_MODE: 'json' })).toBe('json');
  });

  it('wrapping twice wraps once', () => {
    const once = withTools(scripted([]), {});
    expect(withTools(once, {})).toBe(once);
  });

  it('a native error that is not a refusal of the tool fields is passed on', async () => {
    const p: Provider = { ...scripted([new LlmError('upstream', 'down')]), fixedToolMode: 'native', nativeTools: true };
    const e = await failure(withTools(p, {}).stream(ask({ tools: [NOTE] })));
    expect(e.code).toBe('upstream');
  });

  it('a JSON-mode model that ends with no done chunk still ends the stream', async () => {
    const p = scripted([{ type: 'delta', text: 'just text' }]);
    expect(await collect(withTools(p, {}).stream(ask({ tools: [NOTE] })))).toEqual([
      { type: 'delta', text: 'just text' },
      { type: 'done', truncated: false },
    ]);
  });
});

describe('AI SDK adapter edges', () => {
  const opts = (extra: Partial<LanguageModelV3CallOptions> = {}): LanguageModelV3CallOptions => ({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    ...extra,
  });
  const seen: ChatRequest[] = [];
  const recording = (chunks: Array<ChatChunk | Error>): Provider => {
    const inner = scripted(chunks);
    return { ...inner, stream: (r) => (seen.push(r), inner.stream(r)) };
  };
  beforeEach(() => void (seen.length = 0));

  async function parts(stream: ReadableStream<LanguageModelV3StreamPart>) {
    const out: LanguageModelV3StreamPart[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return out;
      out.push(value);
    }
  }

  it('maps tool choice and JSON output onto the gateway request', async () => {
    const m = toAiSdkModel('quick', () => recording([{ type: 'done', truncated: false }]));
    const tool = { type: 'function' as const, name: 'add_note', inputSchema: NOTE.parameters };
    await m.doGenerate(opts({ tools: [tool], toolChoice: { type: 'none' } }));
    await m.doGenerate(opts({ tools: [tool], toolChoice: { type: 'tool', toolName: 'add_note' } }));
    await m.doGenerate(opts({ tools: [tool] }));
    await m.doGenerate(opts({ responseFormat: { type: 'json' }, maxOutputTokens: 50 }));
    expect(seen.map((r) => r.toolChoice)).toEqual(['none', 'required', 'auto', undefined]);
    expect(seen[0].tools).toEqual([{ name: 'add_note', description: '', parameters: NOTE.parameters }]);
    expect(seen[3].messages[0]).toEqual({ role: 'system', content: 'Reply with one JSON object and nothing else.' });
    expect(seen[3]).toMatchObject({ tier: 'quick', maxTokens: 50, tools: undefined });
  });

  it('reports a cut-off answer, cached tokens and a tool call from doGenerate', async () => {
    const m = toAiSdkModel('default', () =>
      recording([
        { type: 'tool_call', call: { id: 'c1', name: 'add_note', args: { title: 'x' } } },
        { type: 'done', truncated: true, usage: { input: 10, output: 3, cacheRead: 100, cacheWrite: 5 } },
      ]),
    );
    const out = await m.doGenerate(opts());
    expect(out.content).toEqual([{ type: 'tool-call', toolCallId: 'c1', toolName: 'add_note', input: '{"title":"x"}' }]);
    expect(out.finishReason).toEqual({ unified: 'tool-calls', raw: 'tool_calls' });
    expect(out.usage.inputTokens).toEqual({ total: 115, noCache: 10, cacheRead: 100, cacheWrite: 5 });

    const cut = toAiSdkModel('default', () =>
      recording([
        { type: 'delta', text: 'half' },
        { type: 'done', truncated: true },
      ]),
    );
    expect((await cut.doGenerate(opts())).finishReason).toEqual({ unified: 'length', raw: 'length' });
  });

  it('streams an error part when the model fails part way, and closes', async () => {
    const m = toAiSdkModel('default', () => recording([{ type: 'delta', text: 'Hel' }, new LlmError('upstream', 'dropped')]));
    const { stream } = await m.doStream(opts());
    const out = await parts(stream);
    expect(out.map((p) => p.type)).toEqual(['stream-start', 'text-start', 'text-delta', 'error']);
  });

  it('closes cleanly when the model ends without a done chunk, and can be cancelled', async () => {
    const m = toAiSdkModel('default', () => recording([{ type: 'delta', text: 'x' }]));
    const out = await parts((await m.doStream(opts())).stream);
    expect(out.map((p) => p.type)).toEqual(['stream-start', 'text-start', 'text-delta']);

    let closed = false;
    const endless: Provider = {
      id: 'endless',
      model: () => 'endless-1',
      async *stream() {
        try {
          for (;;) yield { type: 'delta', text: '.' } as ChatChunk;
        } finally {
          closed = true;
        }
      },
    };
    const { stream } = await toAiSdkModel('default', () => endless).doStream(opts());
    const reader = stream.getReader();
    await reader.read();
    await reader.read();
    await reader.cancel();
    expect(closed).toBe(true);
  });

  it('a mid-stream failure reaches the AI SDK caller as an error', async () => {
    const m = toAiSdkModel('default', () => recording([new LlmError('budget', 'the model budget is used up', 429)]));
    await expect(generateText({ model: m, prompt: 'x' })).rejects.toThrow(/budget/);
    const errors: unknown[] = [];
    const result = streamText({ model: m, prompt: 'x', onError: ({ error }) => void errors.push(error) });
    for await (const _ of result.textStream) void _;
    expect(errors).toHaveLength(1);
  });

  it('converts every prompt part it may meet', () => {
    expect(
      fromAiSdkPrompt([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'a' },
            { type: 'file', data: 'x', mediaType: 'image/png' },
            { type: 'text', text: 'b' },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'tool-call', toolCallId: 's', toolName: 'add_note', input: '{"title":"t"}' },
            { type: 'tool-call', toolCallId: 'r', toolName: 'add_note', input: 'not json' },
            { type: 'tool-result', toolCallId: 's', toolName: 'add_note', output: { type: 'text', value: 'ok' } },
          ],
        },
        {
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: 'r', toolName: 'add_note', output: { type: 'error-text', value: 'bad' } }],
        },
      ]),
    ).toEqual([
      { role: 'user', content: 'ab' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 's', name: 'add_note', args: { title: 't' } },
          { id: 'r', name: 'add_note', args: 'not json' },
        ],
      },
      { role: 'tool', toolCallId: 's', content: 'ok' },
      { role: 'tool', toolCallId: 'r', content: 'bad' },
    ]);
  });

  it('names the model of the provider it was given', () => {
    expect(toAiSdkModel('default', () => scripted([])).modelId).toBe('scripted-1');
  });
});

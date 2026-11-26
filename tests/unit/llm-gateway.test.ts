import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { complete, resolveProvider, withTools, type ChatChunk, type ChatRequest, type Provider, type ToolDef } from '@/server/llm';
import { createPacer, retryAfterMs, scrub, withRetries } from '@/server/llm/http';
import { anthropic, toAnthropicMessages } from '@/server/llm/providers/anthropic';
import { claudeCli } from '@/server/llm/providers/claude-cli';
import { mockProvider, sampleArgs } from '@/server/llm/providers/mock';
import { openAiCompatible, toOpenAiMessages } from '@/server/llm/providers/openai-compatible';
import { firstJsonObject, forgetToolModes, parseToolReply, toJsonMessages } from '@/server/llm/tools';

const stream = (lines: string[], status = 200) =>
  new Response(new ReadableStream({ start: (c) => (lines.forEach((l) => c.enqueue(new TextEncoder().encode(l))), c.close()) }), { status });
const noWait = { sleep: async () => undefined };
const asFetch = (f: (url: string, init: RequestInit) => Promise<Response>) => f as unknown as typeof fetch;

const NOTE: ToolDef = {
  name: 'add_note',
  description: 'Add a note',
  parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
};

async function collect(source: AsyncIterable<ChatChunk>) {
  const out: ChatChunk[] = [];
  for await (const chunk of source) out.push(chunk);
  return out;
}

describe('retries and pacing', () => {
  it('retries a 429 and a 5xx, then returns the good answer', async () => {
    const answers = [429, 503, 200];
    const waits: number[] = [];
    const res = await withRetries(async () => new Response('x', { status: answers.shift()! }), {
      baseMs: 100,
      sleep: async (ms) => void waits.push(ms),
    });
    expect(res.status).toBe(200);
    expect(waits).toEqual([100, 200]);
  });
  it('stops after three tries and hands back the last refusal', async () => {
    let n = 0;
    const res = await withRetries(async () => (n++, new Response('', { status: 500 })), noWait);
    expect([n, res.status]).toEqual([3, 500]);
  });
  it('does not retry a request the model refused as wrong', async () => {
    let n = 0;
    const res = await withRetries(async () => (n++, new Response('', { status: 400 })), noWait);
    expect([n, res.status]).toEqual([1, 400]);
  });
  it('retries a dropped connection, and reports it if it keeps dropping', async () => {
    let n = 0;
    await expect(withRetries(async () => (n++, Promise.reject(new Error('socket hang up'))), noWait)).rejects.toThrow('socket hang up');
    expect(n).toBe(3);
  });
  it('honours Retry-After, in seconds and as a date', () => {
    expect(retryAfterMs(new Response('', { headers: { 'retry-after': '2' } }))).toBe(2000);
    expect(retryAfterMs(new Response('', { headers: { 'retry-after': new Date(10_000).toUTCString() } }), 4_000)).toBe(6000);
    expect(retryAfterMs(new Response(''))).toBeNull();
  });
  it('keeps calls under the per-minute limit, and refuses rather than hang', async () => {
    let t = 0;
    const waited: number[] = [];
    const pace = createPacer(2, { maxWaitMs: 120_000, now: () => t, sleep: async (ms) => void ((t += ms), waited.push(ms)) });
    await pace();
    await pace();
    await pace(); // the third has to wait for the first to leave the window
    expect(waited.length).toBe(1);
    expect(waited[0]).toBeGreaterThanOrEqual(60_000);
    const strict = createPacer(1, { now: () => 0, sleep: async () => undefined, maxWaitMs: 1000 });
    await strict();
    await expect(strict()).rejects.toMatchObject({ code: 'rate_limited' });
  });
  it('scrubs keys and addresses from text', () => {
    expect(scrub('bad key=' + 'sk-' + 'abcdef123456 at https://gw.example.com/v1?x=1 Bearer abc.def')).toBe(
      'bad key=sk-… at [address] Bearer …',
    );
  });
});

describe('openAiCompatible tool calls', () => {
  const recorded = [
    'data: {"choices":[{"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"add_note","arguments":""}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"title\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Hello\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\ndata: [DONE]\n\n',
  ];
  it('sends tools and assembles a call from streamed fragments', async () => {
    let body: Record<string, unknown> = {};
    const p = openAiCompatible({
      id: 'litellm',
      baseUrl: 'h/v1',
      apiKey: 'test-key',
      model: 'm',
      fetchImpl: asFetch(async (_u, init) => ((body = JSON.parse(String(init.body))), stream(recorded))),
    });
    const chunks = await collect(
      p.stream({ messages: [{ role: 'user', content: 'note' }], tier: 'default', tools: [NOTE], toolChoice: 'required' }),
    );
    expect(chunks).toEqual([
      { type: 'tool_call', call: { id: 'call_1', name: 'add_note', args: { title: 'Hello' } } },
      { type: 'done', truncated: false, usage: { input: 11, output: 7 } },
    ]);
    expect(body.tool_choice).toBe('required');
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'add_note', description: 'Add a note', parameters: NOTE.parameters } },
    ]);
  });
  it('writes tool turns the way the API expects', () => {
    expect(
      toOpenAiMessages([
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'add_note', args: { title: 'x' } }] },
        { role: 'tool', toolCallId: 'c1', content: 'ok' },
      ]),
    ).toEqual([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'add_note', arguments: '{"title":"x"}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'ok' },
    ]);
  });
  it('retries a 503 once and then streams', async () => {
    const answers = [() => new Response('busy', { status: 503 }), () => stream(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'])];
    const p = openAiCompatible({
      id: 'x',
      baseUrl: 'h',
      apiKey: 'k',
      model: 'm',
      retry: noWait,
      fetchImpl: asFetch(async () => answers.shift()!()),
    });
    expect(await complete(p, { messages: [{ role: 'user', content: 'a' }], tier: 'default' })).toMatchObject({ text: 'hi' });
  });
});

describe('anthropic provider', () => {
  const recorded = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":1}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Adding "}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"it."}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"add_note","input":{}}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"title\\": \\"Hi"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"}"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":42}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
  it('streams text and a tool call, and reports usage', async () => {
    let seen: { url: string; headers: Headers; body: Record<string, unknown> } | null = null;
    const p = anthropic({
      apiKey: 'test-key',
      model: 'claude-x',
      quickModel: 'claude-y',
      fetchImpl: asFetch(
        async (url, init) => ((seen = { url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) }), stream(recorded)),
      ),
    });
    const chunks = await collect(
      p.stream({
        messages: [
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: 'note' },
        ],
        tier: 'quick',
        tools: [NOTE],
        maxTokens: 100,
      }),
    );
    expect(chunks).toEqual([
      { type: 'delta', text: 'Adding ' },
      { type: 'delta', text: 'it.' },
      { type: 'tool_call', call: { id: 'toolu_1', name: 'add_note', args: { title: 'Hi' } } },
      { type: 'done', truncated: false, usage: { input: 25, output: 42 } },
    ]);
    expect(seen!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen!.headers.get('x-api-key')).toBe('test-key');
    expect(seen!.headers.get('anthropic-version')).toBe('2023-06-01');
    expect(seen!.body).toMatchObject({
      model: 'claude-y',
      max_tokens: 100,
      system: 'Be brief.',
      stream: true,
      tool_choice: { type: 'auto' },
    });
    expect((seen!.body.tools as { input_schema: unknown }[])[0].input_schema).toEqual(NOTE.parameters);
    expect(p.model('default')).toBe('claude-x');
  });
  it('reports a cut-off answer', async () => {
    const p = anthropic({
      apiKey: 'k',
      model: 'm',
      fetchImpl: asFetch(async () =>
        stream([
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"{"}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":3}}\n\n',
        ]),
      ),
    });
    expect(await complete(p, { messages: [{ role: 'user', content: 'a' }], tier: 'default' })).toMatchObject({
      text: '{',
      truncated: true,
    });
  });
  it('turns tool turns into Anthropic blocks and merges neighbours', () => {
    const { system, messages } = toAnthropicMessages([
      { role: 'system', content: 'S1' },
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: 'ok',
        toolCalls: [
          { id: 't1', name: 'add_note', args: { title: 'a' } },
          { id: 't2', name: 'add_note', args: { title: 'b' } },
        ],
      },
      { role: 'tool', toolCallId: 't1', content: 'done a' },
      { role: 'tool', toolCallId: 't2', content: 'done b' },
      { role: 'user', content: 'next' },
    ]);
    expect(system).toBe('S1');
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[2].content.map((b) => b.type)).toEqual(['tool_result', 'tool_result', 'text']);
  });
  it('maps refusals and mid-stream errors to codes, with no key in the message', async () => {
    const make = (res: () => Response) =>
      anthropic({ apiKey: 'test-key', model: 'm', retry: noWait, fetchImpl: asFetch(async () => res()) });
    const ask = (p: Provider) => collect(p.stream({ messages: [], tier: 'default' }));
    await expect(ask(make(() => new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 })))).rejects.toMatchObject({
      code: 'unauthorized',
    });
    await expect(ask(make(() => new Response('', { status: 429 })))).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(
      ask(make(() => stream(['data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n']))),
    ).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(ask(make(() => new Response('', { status: 400 })))).rejects.toMatchObject({ code: 'bad_request' });
  });
});

describe('Claude Code command provider', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fake = (script: string) => {
    const file = path.join(dir, 'claude');
    fs.writeFileSync(file, '#!/bin/sh\n' + script, { mode: 0o755 });
    return file;
  };
  const ask = (p: Provider, content = 'Say ok') =>
    complete(p, {
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content },
      ],
      tier: 'default',
    });

  it('runs `claude -p`, sends the prompt on standard input and reads the JSON result', async () => {
    const log = path.join(dir, 'args.txt');
    const cmd = fake(
      `echo "$@" > "${log}"\ncat > "${log}.stdin"\necho '{"type":"result","subtype":"success","is_error":false,"result":"ok then","usage":{"input_tokens":4,"output_tokens":2}}'`,
    );
    const out = await ask(claudeCli({ model: 'sonnet', quickModel: 'haiku', command: cmd, env: {} }), 'a secret prompt');
    expect(out).toMatchObject({ text: 'ok then', truncated: false, usage: { input: 4, output: 2 } });
    const args = fs.readFileSync(log, 'utf8');
    expect(args).toMatch(/-p --output-format json --model sonnet/);
    expect(args).toMatch(/--system-prompt Be brief\./);
    expect(args).not.toMatch(/secret/);
    expect(fs.readFileSync(log + '.stdin', 'utf8')).toBe('a secret prompt');
  });
  it('reports the failure the command gives (from here the API cannot be reached)', async () => {
    const cmd = fake(
      `cat >/dev/null\necho '{"type":"result","subtype":"error_during_execution","is_error":true,"terminal_reason":"api_error","result":"cannot reach the API"}'`,
    );
    await expect(ask(claudeCli({ model: 'sonnet', command: cmd, env: {} }))).rejects.toMatchObject({
      code: 'upstream',
      message: expect.stringContaining('api_error'),
    });
  });
  it('says so when the command is not installed or answers with something else', async () => {
    await expect(ask(claudeCli({ model: 'sonnet', command: path.join(dir, 'nope'), env: {} }))).rejects.toMatchObject({
      code: 'not_configured',
    });
    const cmd = fake('cat >/dev/null\necho not json');
    await expect(ask(claudeCli({ model: 'sonnet', command: cmd, env: {} }))).rejects.toMatchObject({ code: 'upstream' });
  });
  it('is refused on Vercel', () => {
    expect(() => claudeCli({ model: 'sonnet', env: { VERCEL: '1' } })).toThrow(/local testing only/);
    expect(resolveProvider({ LLM_PROVIDER: 'claude-cli', VERCEL: '1' })).toBeNull();
    expect(resolveProvider({ LLM_PROVIDER: 'claude-cli' })?.id).toBe('claude-cli');
  });
});

describe('resolveProvider', () => {
  it('takes an Anthropic key, but only picks it when nothing else is set', () => {
    const p = resolveProvider({ ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_MODEL_FAST: 'fast-1' });
    expect([p?.id, p?.model('default'), p?.model('quick')]).toEqual(['anthropic', 'claude-sonnet-5-5', 'fast-1']);
    expect(resolveProvider({ ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', OPENAI_MODEL: 'o' })?.id).toBe('openai');
    expect(resolveProvider({ LLM_PROVIDER: 'anthropic', OPENAI_API_KEY: 'k', OPENAI_MODEL: 'o' })).toBeNull();
  });
  it('never picks the Claude command or the mock by itself', () => {
    expect(resolveProvider({})).toBeNull();
  });
});

describe('tools by the JSON protocol', () => {
  /** A provider with no tool calling: it answers each request from a script and records what it was asked. */
  const plain = (answers: string[], seen: ChatRequest[] = []): Provider => ({
    id: 'plain',
    model: () => 'plain-model',
    async *stream(request) {
      seen.push(request);
      yield { type: 'delta', text: answers.shift() ?? '' };
      yield { type: 'done', truncated: false, usage: { input: 1, output: 1 } };
    },
  });
  beforeEach(() => forgetToolModes());

  it('describes the tools to the model and turns its JSON reply into a tool call', async () => {
    const seen: ChatRequest[] = [];
    const p = withTools(plain(['Sure.\n```json\n{"tool_calls":[{"name":"add_note","arguments":{"title":"Hello"}}]}\n```'], seen), {});
    const out = await complete(p, {
      messages: [
        { role: 'system', content: 'You help.' },
        { role: 'user', content: 'note' },
      ],
      tier: 'default',
      tools: [NOTE],
    });
    expect(out.toolCalls).toMatchObject([{ name: 'add_note', args: { title: 'Hello' } }]);
    expect(out.text).toBe('');
    expect(seen[0].tools).toBeUndefined();
    expect(seen[0].messages[0].content).toMatch(/You help\.[\s\S]*add_note[\s\S]*tool_calls/);
  });
  it('passes plain text through, and ignores calls to tools that do not exist', async () => {
    const p = withTools(plain(['All done.', '{"tool_calls":[{"name":"made_up","arguments":{}}]}']), {});
    const req = { messages: [{ role: 'user' as const, content: 'x' }], tier: 'default' as const, tools: [NOTE] };
    expect(await complete(p, req)).toMatchObject({ text: 'All done.', toolCalls: [] });
    expect((await complete(p, req)).toolCalls).toEqual([]);
  });
  it('writes earlier tool turns as text the model can follow', () => {
    const out = toJsonMessages(
      [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'add_note', args: { title: 'a' } }] },
        { role: 'tool', toolCallId: 'c1', content: 'saved' },
      ],
      [NOTE],
      'auto',
    );
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(out[2].content).toBe('{"tool_calls":[{"name":"add_note","arguments":{"title":"a"}}]}');
    expect(out[3].content).toBe('TOOL RESULT for add_note:\nsaved');
  });
  it('finds the first JSON object in a reply', () => {
    expect(firstJsonObject('x {"a":{"b":"}"}} y {"c":1}')).toEqual({ a: { b: '}' } });
    expect(firstJsonObject('no json')).toBeUndefined();
    expect(parseToolReply('{"tool_calls":[]}', [NOTE], () => 'id')).toBeNull();
  });
  it('probes a native provider once, remembers, and goes by JSON when the model does not call tools', async () => {
    let calls = 0;
    const seen: ChatRequest[] = [];
    const nativeButDumb: Provider = {
      id: 'dumb',
      nativeTools: true,
      model: () => 'dumb-model',
      async *stream(request) {
        calls++;
        seen.push(request);
        yield {
          type: 'delta',
          text: request.tools ? 'I will not call tools.' : '{"tool_calls":[{"name":"add_note","arguments":{"title":"via json"}}]}',
        };
        yield { type: 'done', truncated: false };
      },
    };
    const p = withTools(nativeButDumb, {});
    const req: ChatRequest = { messages: [{ role: 'user', content: 'x' }], tier: 'default', tools: [NOTE] };
    expect((await complete(p, req)).toolCalls[0]?.args).toEqual({ title: 'via json' });
    expect(await p.toolMode?.('default')).toBe('json');
    const before = calls;
    await complete(p, req);
    expect(calls - before).toBe(1); // no second probe
  });
  it('uses native calls when the probe shows they work, and when told to', async () => {
    const mock = mockProvider();
    const p = withTools(mock, {});
    expect(await p.toolMode?.('default')).toBe('native');
    const out = await complete(p, { messages: [{ role: 'user', content: 'x' }], tier: 'default', tools: [NOTE] });
    expect(out.toolCalls).toMatchObject([{ name: 'add_note', args: { title: 'sample' } }]);
    forgetToolModes();
    expect(await withTools(mock, { LLM_TOOL_MODE: 'json' }).toolMode?.('default')).toBe('json');
  });
  it('falls back to JSON when the gateway refuses the tool fields', async () => {
    const p = withTools(
      openAiCompatible({
        id: 'strict',
        baseUrl: 'h',
        apiKey: 'k',
        model: 'm',
        retry: noWait,
        fetchImpl: asFetch(async (_u, init) => {
          const body = JSON.parse(String(init.body));
          if (body.tools) return new Response('tools are not supported', { status: 400 });
          return stream([
            `data: {"choices":[{"delta":{"content":"{\\"tool_calls\\":[{\\"name\\":\\"add_note\\",\\"arguments\\":{\\"title\\":\\"ok\\"}}]}"}}]}\n\n`,
          ]);
        }),
      }),
      { LLM_TOOL_MODE: 'auto' },
    );
    expect((await complete(p, { messages: [{ role: 'user', content: 'x' }], tier: 'default', tools: [NOTE] })).toolCalls[0]?.args).toEqual({
      title: 'ok',
    });
  });
  it('lets requests without tools straight through', async () => {
    const seen: ChatRequest[] = [];
    const p = withTools(plain(['hello'], seen), {});
    expect((await complete(p, { messages: [{ role: 'user', content: 'x' }], tier: 'default' })).text).toBe('hello');
    expect(seen[0].messages).toHaveLength(1);
  });
});

describe('mock provider and complete()', () => {
  it('collects a stream into text, truncation and usage', async () => {
    const out = await complete(
      mockProvider(() => 'abcdef'),
      { messages: [{ role: 'user', content: 'x' }], tier: 'quick' },
    );
    expect(out).toMatchObject({ text: 'abcdef', truncated: false, toolCalls: [] });
    expect(out.usage?.output).toBeGreaterThan(0);
  });
  it('makes up arguments that fit a schema', () => {
    expect(
      sampleArgs({
        type: 'object',
        properties: { a: { type: 'string', enum: ['x'] }, n: { type: 'number' }, l: { type: 'array', items: { type: 'boolean' } } },
        required: ['a', 'n', 'l'],
      }),
    ).toEqual({ a: 'x', n: 1, l: [true] });
  });
  it('answers after a tool result with text', async () => {
    const out = await complete(mockProvider(), {
      messages: [
        { role: 'user', content: 'x' },
        { role: 'assistant', content: '', toolCalls: [{ id: '1', name: 'add_note', args: {} }] },
        { role: 'tool', toolCallId: '1', content: 'ok' },
      ],
      tier: 'default',
      tools: [NOTE],
    });
    expect(out).toMatchObject({ text: 'Done.', toolCalls: [] });
  });
});

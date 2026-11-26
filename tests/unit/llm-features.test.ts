/**
 * The Claude features in the gateway: effort per tier, prompt caching, no sampling settings, tool choice always
 * `auto`, and token and cost logging per call. No network: providers answer from recorded streams.
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { complete, resolveProvider, type ChatRequest, type ToolDef } from '@/server/llm';
import { costOf, effortFor, EFFORT_BY_TIER, isClaudeModel, priceOf, withRequiredNote, MUST_CALL_A_TOOL } from '@/server/llm/features';
import { anthropic } from '@/server/llm/providers/anthropic';
import { claudeCode, resultUsage, type SpawnFn } from '@/server/llm/providers/claude-code';
import { markCache, openAiCompatible, readUsage } from '@/server/llm/providers/openai-compatible';
import { forgetToolModes } from '@/server/llm/tools';
import { recordUsage, resetUsageTotals, usageLine, usageTotals, withUsage } from '@/server/llm/usage';
import { GET as health } from '@/app/api/health/route';

const sse = (lines: string[], status = 200) =>
  new Response(new ReadableStream({ start: (c) => (lines.forEach((l) => c.enqueue(new TextEncoder().encode(l))), c.close()) }), { status });
const asFetch = (f: (url: string, init: RequestInit) => Promise<Response>) => f as unknown as typeof fetch;
const noWait = { sleep: async () => undefined };

const NOTE: ToolDef = {
  name: 'add_note',
  description: 'Add a note',
  parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
};
const ASK: ChatRequest = {
  messages: [
    { role: 'system', content: 'You are the schema agent. Catalog: table, view, page.' },
    { role: 'user', content: 'Build a clinic app.' },
  ],
  tier: 'default',
};

const OPENAI_TEXT = [
  'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
  'data: {"choices":[],"usage":{"prompt_tokens":1200,"completion_tokens":40,"prompt_tokens_details":{"cached_tokens":1000}}}\n\ndata: [DONE]\n\n',
];

/** An OpenAI-compatible provider that records every request body and answers from `answers` in turn. */
function gateway(model = 'claude-sonnet-5-5', answers: (() => Response)[] = []) {
  const bodies: Record<string, unknown>[] = [];
  const provider = openAiCompatible({
    id: 'litellm',
    baseUrl: 'gateway.example.com/v1',
    apiKey: 'test-key',
    model,
    quickModel: 'claude-haiku',
    retry: noWait,
    fetchImpl: asFetch(async (_u, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return (answers.shift() ?? (() => sse(OPENAI_TEXT)))();
    }),
  });
  return { provider, bodies };
}

describe('effort per tier', () => {
  it('thinks at medium for planning and building, low for quick steps, and a request may ask for more', () => {
    expect(EFFORT_BY_TIER).toEqual({ default: 'medium', quick: 'low' });
    expect(effortFor({ tier: 'default' })).toBe('medium');
    expect(effortFor({ tier: 'quick' })).toBe('low');
    expect(effortFor({ tier: 'default', effort: 'high' })).toBe('high');
    expect(effortFor({ tier: 'quick', effort: 'nonsense' as never })).toBe('low');
  });
  it('LiteLLM: sends reasoning_effort for Claude models, by tier', async () => {
    const { provider, bodies } = gateway();
    await complete(provider, ASK);
    await complete(provider, { ...ASK, tier: 'quick' });
    await complete(provider, { ...ASK, effort: 'high' });
    expect(bodies.map((b) => [b.model, b.reasoning_effort])).toEqual([
      ['claude-sonnet-5-5', 'medium'],
      ['claude-haiku', 'low'],
      ['claude-sonnet-5-5', 'high'],
    ]);
  });
  it('LiteLLM: if the gateway refuses the effort setting, sends once more without it and remembers', async () => {
    const refusal = () => sse(['{"error":{"message":"reasoning_effort is not supported for this model"}}'], 400);
    const { provider, bodies } = gateway('claude-sonnet-5-5', [refusal]);
    const first = await complete(provider, ASK);
    const second = await complete(provider, ASK);
    expect([first.text, second.text]).toEqual(['ok', 'ok']);
    expect(bodies.map((b) => 'reasoning_effort' in b)).toEqual([true, false, false]);
  });
  it('LiteLLM: another 400 is reported as it is, without a second request', async () => {
    const refusal = () => sse(['{"error":{"message":"messages: field required"}}'], 400);
    const { provider, bodies } = gateway('claude-sonnet-5-5', [refusal]);
    await expect(complete(provider, ASK)).rejects.toMatchObject({ code: 'bad_request' });
    expect(bodies).toHaveLength(1);
  });
  it('Anthropic: sends output_config.effort by tier', async () => {
    const bodies: Record<string, unknown>[] = [];
    const p = anthropic({
      apiKey: 'test-key',
      model: 'claude-sonnet-5-5',
      quickModel: 'claude-haiku-5-5',
      fetchImpl: asFetch(async (_u, init) => (bodies.push(JSON.parse(String(init.body))), sse([]))),
    });
    await complete(p, ASK);
    await complete(p, { ...ASK, tier: 'quick' });
    expect(bodies.map((b) => b.output_config)).toEqual([{ effort: 'medium' }, { effort: 'low' }]);
  });
});

describe('prompt caching', () => {
  it('marks the end of the leading system prompt, and nothing after it', () => {
    const marked = markCache([
      { role: 'system', content: 'stable role prompt' },
      { role: 'system', content: 'stable catalog' },
      { role: 'user', content: 'changes every call' },
    ]);
    expect(marked[0]).toEqual({ role: 'system', content: 'stable role prompt' });
    expect(marked[1]).toEqual({
      role: 'system',
      content: [{ type: 'text', text: 'stable catalog', cache_control: { type: 'ephemeral' } }],
    });
    expect(marked[2]).toEqual({ role: 'user', content: 'changes every call' });
    expect(markCache([{ role: 'user', content: 'no system prompt' }])).toEqual([{ role: 'user', content: 'no system prompt' }]);
  });
  it('LiteLLM: Claude models get the cache mark; other models and cache:false do not', async () => {
    const claude = gateway();
    await complete(claude.provider, ASK);
    await complete(claude.provider, { ...ASK, cache: false });
    const sys = (b: Record<string, unknown>) => (b.messages as { content: unknown }[])[0].content;
    expect(sys(claude.bodies[0])).toEqual([
      { type: 'text', text: 'You are the schema agent. Catalog: table, view, page.', cache_control: { type: 'ephemeral' } },
    ]);
    expect(sys(claude.bodies[1])).toBe('You are the schema agent. Catalog: table, view, page.');

    const other = gateway('gpt-5-mini');
    await complete(other.provider, ASK);
    expect(sys(other.bodies[0])).toBe('You are the schema agent. Catalog: table, view, page.');
    expect(other.bodies[0]).not.toHaveProperty('reasoning_effort');
  });
  it('LiteLLM: reads cache hits, from either usage shape, and keeps them out of the uncached input', () => {
    expect(readUsage({ prompt_tokens: 1200, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 1000 } })).toEqual({
      input: 200,
      output: 40,
      cacheRead: 1000,
    });
    expect(
      readUsage({ prompt_tokens: 1500, completion_tokens: 9, cache_read_input_tokens: 1000, cache_creation_input_tokens: 300 }),
    ).toEqual({ input: 200, output: 9, cacheRead: 1000, cacheWrite: 300 });
    expect(readUsage({ prompt_tokens: 50, completion_tokens: 5 })).toEqual({ input: 50, output: 5 });
  });
  it('Anthropic: marks the system prompt and reads cache reads and writes', async () => {
    let body: Record<string, unknown> = {};
    const p = anthropic({
      apiKey: 'test-key',
      model: 'claude-sonnet-5-5',
      fetchImpl: asFetch(async (_u, init) => {
        body = JSON.parse(String(init.body));
        return sse([
          'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1,"cache_read_input_tokens":2048,"cache_creation_input_tokens":0}}}\n\n',
          'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}\n\n',
          'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":30}}\n\n',
        ]);
      }),
    });
    const done = await complete(p, ASK);
    expect(body.system).toEqual([
      { type: 'text', text: 'You are the schema agent. Catalog: table, view, page.', cache_control: { type: 'ephemeral' } },
    ]);
    expect(done.usage).toEqual({ input: 12, output: 30, cacheRead: 2048 });
  });
});

describe('request shape for current Claude models', () => {
  it('never sends a sampling setting, on any provider', async () => {
    const { provider, bodies } = gateway();
    await complete(provider, { ...ASK, tools: [NOTE] });
    const seen: Record<string, unknown>[] = [];
    const a = anthropic({
      apiKey: 'k',
      model: 'claude-sonnet-5-5',
      fetchImpl: asFetch(async (_u, i) => (seen.push(JSON.parse(String(i.body))), sse([]))),
    });
    await complete(a, { ...ASK, tools: [NOTE] });
    for (const b of [...bodies, ...seen]) for (const key of ['temperature', 'top_p', 'top_k']) expect(b).not.toHaveProperty(key);
  });
  it('never forces a tool: `required` is said in the system prompt and the choice stays auto', async () => {
    const { provider, bodies } = gateway();
    await complete(provider, { ...ASK, tools: [NOTE], toolChoice: 'required' });
    expect(bodies[0].tool_choice).toBe('auto');
    const system = (bodies[0].messages as { content: { text: string }[] }[])[0].content[0].text;
    expect(system).toContain(MUST_CALL_A_TOOL);

    const seen: Record<string, unknown>[] = [];
    const a = anthropic({
      apiKey: 'k',
      model: 'claude-sonnet-5-5',
      fetchImpl: asFetch(async (_u, i) => (seen.push(JSON.parse(String(i.body))), sse([]))),
    });
    await complete(a, { ...ASK, tools: [NOTE], toolChoice: 'required' });
    expect(seen[0].tool_choice).toEqual({ type: 'auto' });
    expect((seen[0].system as { text: string }[])[0].text).toContain(MUST_CALL_A_TOOL);
  });
  it('adds the note only when a tool is required, and adds a system prompt if there is none', () => {
    const msgs = [{ role: 'user' as const, content: 'hi' }];
    expect(withRequiredNote(msgs, 'auto')).toBe(msgs);
    expect(withRequiredNote(msgs, 'required')).toEqual([{ role: 'system', content: MUST_CALL_A_TOOL }, ...msgs]);
  });
  it('knows Claude model names in every spelling the gateways use', () => {
    for (const m of ['claude-sonnet-5-5', 'claude-haiku', 'anthropic/claude-opus-5-5', 'sonnet', 'haiku', 'opus'])
      expect([m, isClaudeModel(m)]).toEqual([m, true]);
    for (const m of ['gpt-5-mini', 'llama3', 'mock-default']) expect([m, isClaudeModel(m)]).toEqual([m, false]);
  });
});

describe('token and cost logging', () => {
  beforeEach(() => resetUsageTotals());

  it('prices the current models, including cache reads and writes', () => {
    expect(priceOf('claude-sonnet-5-5')).toMatchObject({ input: 2, output: 10, cacheRead: 0.1 });
    expect(priceOf('claude-haiku')).toMatchObject({ input: 0.1, output: 0.5 });
    expect(priceOf('anthropic/claude-opus-5-5')).toMatchObject({ input: 4, output: 20 });
    expect(priceOf('sonnet')).toEqual(priceOf('claude-sonnet-5-5'));
    expect(priceOf('gpt-5-mini')).toBeNull();
    // 1M uncached in at $2, 100k out at $10, 1M cache reads at $0.10, 100k cache writes at $2.50
    expect(costOf('claude-sonnet-5-5', { input: 1_000_000, output: 100_000, cacheRead: 1_000_000, cacheWrite: 100_000 })).toBeCloseTo(
      2 + 1 + 0.1 + 0.25,
      8,
    );
    expect(costOf('gpt-5-mini', { input: 10 })).toBeNull();
  });
  it('logs one line per call with tokens, cache and cost, and never the prompt or the key', async () => {
    const lines: string[] = [];
    const { provider } = gateway();
    const p = withUsage(provider, { LLM_LOG_USAGE: '1' }, (l) => lines.push(l));
    const done = await complete(p, ASK);
    expect(done.usage).toMatchObject({ input: 200, output: 40, cacheRead: 1000 });
    expect(done.usage?.costUsd).toBeCloseTo((200 * 2 + 40 * 10 + 1000 * 0.1) / 1e6, 10);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^\[llm\] litellm claude-sonnet-5-5 default\/medium in=200 out=40 cache_read=1000 cache_write=0 \$0\.000900 \d+ms$/,
    );
    expect(lines[0]).not.toMatch(/clinic|schema agent|test-key|gateway\.example/);
  });
  it('keeps running totals against the budget, and counts calls it cannot price', () => {
    recordUsage(
      { provider: 'litellm', model: 'claude-haiku', tier: 'quick', effort: 'low', usage: { input: 10, output: 5, costUsd: 0.25 }, ms: 1 },
      { LLM_LOG_USAGE: '0' },
    );
    recordUsage(
      { provider: 'openai', model: 'gpt', tier: 'default', effort: 'medium', usage: { input: 3, cacheRead: 7 }, ms: 1 },
      { LLM_LOG_USAGE: '0' },
    );
    expect(usageTotals({ LLM_BUDGET_USD: '10' })).toMatchObject({
      calls: 2,
      input: 13,
      output: 5,
      cacheRead: 7,
      costUsd: 0.25,
      unpriced: 1,
      budgetUsd: 10,
    });
    expect(usageTotals({}).budgetUsd).toBe(25);
    expect(usageLine({ provider: 'x', model: 'm', tier: 'quick', effort: 'low', usage: {}, ms: 3 })).toContain('$?');
  });
  it('every provider from resolveProvider is counted, the tool probe included', async () => {
    forgetToolModes();
    const p = resolveProvider({ LLM_PROVIDER: 'mock', NODE_ENV: 'test', LLM_LOG_USAGE: '0' })!;
    await complete(p, { ...ASK, tools: [NOTE] });
    expect(usageTotals().calls).toBeGreaterThanOrEqual(1);
    expect(usageTotals().costUsd).toBe(0);
  });
});

describe('Claude Code command', () => {
  /** A fake `spawn` that answers every call with one result line and records the arguments. */
  function fake(resultLine: Record<string, unknown>) {
    const calls: string[][] = [];
    const spawnImpl: SpawnFn = (_command, args) => {
      calls.push(args);
      const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams & EventEmitter;
      const stdout = new PassThrough();
      const stdin = new PassThrough();
      Object.assign(child, { stdout, stderr: new PassThrough(), stdin, kill: () => true });
      stdin.on('finish', () =>
        setImmediate(() => {
          stdout.end(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, ...resultLine }) + '\n');
          child.emit('close', 0);
        }),
      );
      stdin.resume();
      return child;
    };
    return { calls, spawnImpl };
  }
  const effortArg = (args: string[]) => args[args.indexOf('--effort') + 1];

  it('passes the tier effort on the command line, or the request own, or the configured one', async () => {
    const f = fake({ result: 'ok' });
    const p = claudeCode({ model: 'sonnet', quickModel: 'haiku', env: {}, spawnImpl: f.spawnImpl });
    await complete(p, ASK);
    await complete(p, { ...ASK, tier: 'quick' });
    await complete(p, { ...ASK, effort: 'high' });
    expect(f.calls.map(effortArg)).toEqual(['medium', 'low', 'high']);
    const fixed = fake({ result: 'ok' });
    await complete(claudeCode({ model: 'sonnet', env: {}, effort: 'max', spawnImpl: fixed.spawnImpl }), ASK);
    expect(effortArg(fixed.calls[0])).toBe('max');
  });
  it('reports cache hits and the command own cost', async () => {
    const usage = { input_tokens: 2, output_tokens: 47, cache_read_input_tokens: 10677, cache_creation_input_tokens: 907 };
    const f = fake({ result: 'ok', usage, total_cost_usd: 0.00031187 });
    const done = await complete(claudeCode({ model: 'haiku', env: {}, spawnImpl: f.spawnImpl }), ASK);
    expect(done.usage).toEqual({ input: 2, output: 47, cacheRead: 10677, cacheWrite: 907, costUsd: 0.00031187 });
    expect(resultUsage({})).toBeUndefined();
  });
});

describe('/api/health', () => {
  let saved: string | undefined;
  beforeEach(() => ((saved = process.env.LLM_PROVIDER), (process.env.LLM_PROVIDER = 'mock'), resetUsageTotals()));
  afterEach(() => (saved === undefined ? delete process.env.LLM_PROVIDER : (process.env.LLM_PROVIDER = saved)));

  it('shows the effort of each tier and the spend so far against the budget', async () => {
    const body = await (await health(new Request('http://localhost/api/health'))).json();
    expect(body.effort).toEqual({ default: 'medium', quick: 'low' });
    expect(body.spend).toMatchObject({ calls: 0, costUsd: 0, budgetUsd: 25 });
  });
});

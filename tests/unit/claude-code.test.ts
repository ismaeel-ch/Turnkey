import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { complete, resolveProvider, type ChatChunk, type Provider, type ToolDef } from '@/server/llm';
import {
  buildArgs,
  claudeCode,
  readLine,
  renderPrompt,
  toolInstructions,
  toolReplySchema,
  type SpawnFn,
} from '@/server/llm/providers/claude-code';
import { forgetToolModes } from '@/server/llm/tools';

const NOTE: ToolDef = {
  name: 'add_note',
  description: 'Add a note',
  parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
};

type Script = { lines?: string[]; stdoutBlob?: string; error?: boolean; hang?: boolean };

/** A fake `spawn`: each call plays the next script and records the arguments and what was written to stdin. */
function fakeSpawn(scripts: Script[]) {
  const calls: { command: string; args: string[]; stdin: string }[] = [];
  const spawnImpl: SpawnFn = (command, args) => {
    const script = scripts.shift() ?? {};
    const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams & EventEmitter;
    const stdout = new PassThrough();
    const stdin = new PassThrough();
    Object.assign(child, { stdout, stderr: new PassThrough(), stdin, kill: () => true });
    const call = { command, args, stdin: '' };
    calls.push(call);
    stdin.on('data', (d: Buffer) => (call.stdin += d.toString()));
    stdin.on('end', () => {
      setImmediate(() => {
        if (script.hang) return;
        if (script.error) return child.emit('error', new Error('ENOENT'));
        stdout.write(script.stdoutBlob ?? (script.lines ?? []).join('\n') + '\n');
        stdout.end();
        child.emit('close', 0);
      });
    });
    return child;
  };
  return { spawnImpl, calls };
}

const delta = (text: string) =>
  JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
const result = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, usage: { input_tokens: 4, output_tokens: 2 }, ...extra });

const make = (scripts: Script[], extra: Partial<Parameters<typeof claudeCode>[0]> = {}) => {
  const fake = fakeSpawn(scripts);
  const provider = claudeCode({
    model: 'sonnet',
    quickModel: 'haiku',
    env: {},
    spawnImpl: fake.spawnImpl,
    sleep: async () => undefined,
    ...extra,
  });
  return { provider, calls: fake.calls };
};
const collect = async (it: AsyncIterable<ChatChunk>) => {
  const out: ChatChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
};

describe('Claude Code command line', () => {
  it('builds the arguments: stream-json, low effort, a budget, no tools, schema only when asked', () => {
    const args = buildArgs({ model: 'sonnet', system: 'Be brief.', bare: true, maxBudgetUsd: 0.5, effort: 'low' });
    expect(args.slice(0, 3)).toEqual(['-p', '--bare', '--no-session-persistence']);
    expect(args).toEqual(expect.arrayContaining(['--output-format', 'stream-json', '--include-partial-messages', '--effort', 'low']));
    expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('0.5');
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('Be brief.');
    expect(args).not.toContain('--json-schema');
    const withSchema = buildArgs({ model: 'haiku', schema: { type: 'object' }, bare: false, maxBudgetUsd: 1, effort: 'low' });
    expect(withSchema).not.toContain('--bare');
    expect(withSchema).not.toContain('--system-prompt');
    expect(withSchema[withSchema.indexOf('--json-schema') + 1]).toBe('{"type":"object"}');
  });
  it('describes tools in the system prompt and in the schema, never as real tools', () => {
    const schema = JSON.stringify(toolReplySchema([NOTE]));
    expect(schema).toContain('"enum":["add_note"]');
    const text = toolInstructions([NOTE], 'auto');
    expect(text).toMatch(/NOT tools you can call directly/);
    expect(text).toMatch(/add_note: Add a note/);
    expect(toolInstructions([NOTE], 'required')).toMatch(/must call/);
  });
  it('writes the conversation with tool turns, changing part last', () => {
    expect(
      renderPrompt([
        { role: 'system', content: 's' },
        { role: 'user', content: 'one' },
      ]),
    ).toBe('one');
    const text = renderPrompt([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'add_note', args: { title: 'a' } }] },
      { role: 'tool', toolCallId: 'c1', content: 'saved' },
    ]);
    expect(text).toBe(
      'User: go\n\nAssistant: {"tool_calls":[{"name":"add_note","arguments":{"title":"a"}}]}\n\nTOOL RESULT for add_note:\nsaved\n\nAssistant:',
    );
  });
  it('reads stream lines', () => {
    expect(readLine(delta('hi'))).toEqual({ delta: 'hi' });
    expect(readLine('{"type":"system"}')).toBeNull();
    expect(readLine('garbage')).toBeNull();
    expect(readLine(result({ result: 'x' }))).toMatchObject({ result: { result: 'x' } });
  });
});

describe('Claude Code provider', () => {
  const ask = (p: Provider, content = 'a secret prompt') =>
    complete(p, {
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content },
      ],
      tier: 'default',
    });

  it('streams text as it arrives and sends the prompt on standard input only', async () => {
    const { provider, calls } = make([{ lines: [delta('ok'), delta(' then'), result({ result: 'ok then' })] }]);
    const chunks = await collect(provider.stream({ messages: [{ role: 'user', content: 'a secret prompt' }], tier: 'quick' }));
    expect(chunks.filter((c) => c.type === 'delta').map((c) => (c as { text: string }).text)).toEqual(['ok', ' then']);
    expect(chunks.at(-1)).toMatchObject({ type: 'done', truncated: false, usage: { input: 4, output: 2 } });
    expect(calls[0].command).toBe('claude');
    expect(calls[0].args[calls[0].args.indexOf('--model') + 1]).toBe('haiku');
    expect(calls[0].args.join(' ')).not.toMatch(/secret/);
    expect(calls[0].stdin).toBe('a secret prompt');
  });
  it('uses the final text when no deltas were streamed', async () => {
    const { provider } = make([{ lines: [result({ result: 'whole answer' })] }]);
    expect((await ask(provider)).text).toBe('whole answer');
  });
  it('turns a structured answer into tool calls', async () => {
    const { provider, calls } = make([
      { lines: [result({ result: '', structured_output: { tool_calls: [{ name: 'add_note', arguments: { title: 'Hello' } }] } })] },
    ]);
    const out = await complete(provider, { messages: [{ role: 'user', content: 'note' }], tier: 'default', tools: [NOTE] });
    expect(out.toolCalls).toMatchObject([{ name: 'add_note', args: { title: 'Hello' } }]);
    expect(out.text).toBe('');
    expect(calls[0].args).toContain('--json-schema');
    expect(calls[0].args[calls[0].args.indexOf('--system-prompt') + 1]).toMatch(/add_note/);
  });
  it('reads tool calls from a JSON string result, and plain text from {text}', async () => {
    const { provider } = make([
      { lines: [result({ result: '{"tool_calls":[{"name":"add_note","arguments":{"title":"x"}}]}' })] },
      { lines: [result({ result: '{"text":"No tool needed."}' })] },
      { lines: [result({ result: '{"tool_calls":[{"name":"made_up","arguments":{}}],"text":"Fine."}' })] },
    ]);
    const req = { messages: [{ role: 'user' as const, content: 'x' }], tier: 'default' as const, tools: [NOTE] };
    expect((await complete(provider, req)).toolCalls).toHaveLength(1);
    expect(await complete(provider, req)).toMatchObject({ text: 'No tool needed.', toolCalls: [] });
    expect(await complete(provider, req)).toMatchObject({ text: 'Fine.', toolCalls: [] });
  });
  it('does not probe for tool support: it goes straight to the structured answer', async () => {
    forgetToolModes();
    const p = resolveProvider({ LLM_PROVIDER: 'claude-code' });
    expect(p?.id).toBe('claude-code');
    expect(await p?.toolMode?.('default')).toBe('native');
  });
  it('tries again after a crash, at most three times in all', async () => {
    const bad = { lines: [result({ is_error: true, subtype: 'error_during_execution', terminal_reason: 'api_error' })] };
    const ok = { lines: [result({ result: 'fine' })] };
    const retried = make([bad, bad, ok]);
    expect((await ask(retried.provider)).text).toBe('fine');
    expect(retried.calls).toHaveLength(3);
    const failing = make([bad, bad, bad, ok]);
    await expect(ask(failing.provider)).rejects.toMatchObject({ code: 'upstream', message: expect.stringContaining('api_error') });
    expect(failing.calls).toHaveLength(3);
  });
  it('does not retry a missing command, a sign-in problem or a spent budget', async () => {
    const missing = make([{ error: true }, {}]);
    await expect(ask(missing.provider)).rejects.toMatchObject({ code: 'not_configured' });
    expect(missing.calls).toHaveLength(1);
    const login = make([{ lines: [result({ is_error: true, result: 'Please run /login' })] }, {}]);
    await expect(ask(login.provider)).rejects.toMatchObject({ code: 'unauthorized' });
    const budget = make([{ lines: [result({ is_error: true, subtype: 'error_max_budget_usd' })] }, {}]);
    await expect(ask(budget.provider)).rejects.toMatchObject({ code: 'budget' });
    expect(budget.calls).toHaveLength(1);
  });
  it('gives up on a hung command', async () => {
    const { provider, calls } = make([{ hang: true }, { hang: true }, { hang: true }], { timeoutMs: 20 });
    await expect(ask(provider)).rejects.toMatchObject({ code: 'upstream', message: expect.stringContaining('too long') });
    expect(calls).toHaveLength(3);
  });
  it('stops when the caller aborts', async () => {
    const { provider } = make([{ hang: true }]);
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 10);
    await expect(
      complete(provider, { messages: [{ role: 'user', content: 'x' }], tier: 'default', signal: ctl.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
  it('uses --bare only when an API key is set', async () => {
    const withKey = make([{ lines: [result({ result: 'a' })] }], { env: { ANTHROPIC_API_KEY: 'test-key' } });
    await ask(withKey.provider);
    expect(withKey.calls[0].args).toContain('--bare');
    const without = make([{ lines: [result({ result: 'a' })] }]);
    await ask(without.provider);
    expect(without.calls[0].args).not.toContain('--bare');
  });
  it('is refused in production and on Vercel', () => {
    expect(() => claudeCode({ model: 'sonnet', env: { VERCEL: '1' } })).toThrow(/development only/);
    expect(() => claudeCode({ model: 'sonnet', env: { NODE_ENV: 'production' } })).toThrow(/development only/);
    expect(resolveProvider({ LLM_PROVIDER: 'claude-code', VERCEL: '1' })).toBeNull();
    expect(resolveProvider({ LLM_PROVIDER: 'claude-code', NODE_ENV: 'production' })).toBeNull();
  });
});

describe('provider selection', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bin-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const withClaude = () => {
    fs.writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\n', { mode: 0o755 });
    return dir;
  };
  const LITELLM = { LITELLM_BASE_URL: 'https://gw.example/v1', LITELLM_API_KEY: 'k', LITELLM_MODEL: 'claude-sonnet-5-5' };
  const pick = (env: Record<string, string>) => {
    const p = resolveProvider(env);
    return p ? [p.id, p.model('default'), p.model('quick')] : null;
  };

  it('uses LiteLLM when its three settings are set, with Sonnet and Haiku as the two tiers', () => {
    expect(pick({ ...LITELLM, PATH: withClaude() })).toEqual(['litellm', 'claude-sonnet-5-5', 'claude-haiku']);
    expect(pick({ ...LITELLM, LITELLM_MODEL_FAST: 'my-fast' })?.[2]).toBe('my-fast');
  });
  it('falls back to the Claude Code command in development when it is installed, else the stand-in', () => {
    expect(pick({ PATH: withClaude() })).toEqual(['claude-code', 'sonnet', 'haiku']);
    expect(pick({ PATH: '/nonexistent' })?.[0]).toBe('mock');
    expect(pick({})?.[0]).toBe('mock');
  });
  it('never invents a provider in production: no model is shown as no model', () => {
    expect(resolveProvider({ NODE_ENV: 'production', PATH: withClaude() })).toBeNull();
    expect(resolveProvider({ VERCEL: '1', PATH: withClaude() })).toBeNull();
  });
  it('LLM_PROVIDER wins, and an unusable choice gives none instead of a crash', () => {
    expect(pick({ ...LITELLM, LLM_PROVIDER: 'mock' })?.[0]).toBe('mock');
    expect(pick({ ...LITELLM, LLM_PROVIDER: 'claude-code' })?.[0]).toBe('claude-code');
    expect(pick({ ...LITELLM, LLM_PROVIDER: 'claude-cli' })?.[0]).toBe('claude-code');
    expect(resolveProvider({ LLM_PROVIDER: 'openai', ...LITELLM })).toBeNull();
    expect(resolveProvider({ LLM_PROVIDER: 'litellm' })).toBeNull();
    expect(resolveProvider({ LLM_PROVIDER: 'nonsense' })).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { tool } from '@langchain/core/tools';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { streamText, generateText, tool as aiTool, stepCountIs } from 'ai';
import { toAiSdkModel, fromAiSdkPrompt } from '@/server/llm/ai-sdk';
import { GatewayChatModel, toChatModel, toGatewayMessages } from '@/server/llm/chat-model';
import { mockProvider } from '@/server/llm/providers/mock';
import { withTools } from '@/server/llm';
import { forgetToolModes } from '@/server/llm/tools';
import { GET as health } from '@/app/api/health/route';
import { POST as llm } from '@/app/api/llm/route';
import { litellmModel } from '@/lib/model';

const withEnv = (vars: Record<string, string | undefined>) => {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  Object.assign(process.env, vars);
  for (const k of Object.keys(vars)) if (vars[k] === undefined) delete process.env[k];
  return () => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
};

describe('toChatModel (LangChain)', () => {
  beforeEach(() => forgetToolModes());
  it('is null with no model, and a chat model otherwise', () => {
    expect(toChatModel('default', { provider: null })).toBeNull();
    expect(toChatModel('default', { provider: withTools(mockProvider(), {}) })).toBeInstanceOf(GatewayChatModel);
  });
  it('invokes, streams, and calls tools through bindTools', async () => {
    const model = toChatModel('default', { provider: withTools(mockProvider(), {}) })!;
    const reply = await model.invoke([new SystemMessage('You help.'), new HumanMessage('hi')]);
    expect(String(reply.content)).toContain('mock');
    let streamed = '';
    for await (const part of await model.stream('hi')) streamed += part.content;
    expect(streamed).toContain('mock');

    const addNote = tool(async ({ title }: { title: string }) => 'added ' + title, {
      name: 'add_note',
      description: 'Add a note',
      schema: z.object({ title: z.string() }),
    });
    const bound = model.bindTools!([addNote]);
    const called = (await bound.invoke('Add a note')) as AIMessage;
    expect(called.tool_calls?.[0]).toMatchObject({ name: 'add_note', args: { title: 'sample' } });
    const chunks = [];
    for await (const part of await bound.stream('Add a note')) chunks.push(part);
    const merged = chunks.reduce((a, b) => a.concat(b));
    expect(merged.tool_calls?.[0]).toMatchObject({ name: 'add_note', args: { title: 'sample' } });
    expect(called.usage_metadata?.total_tokens).toBeGreaterThan(0);
  });
  it('sends tool results back as tool turns', () => {
    const out = toGatewayMessages([
      new HumanMessage('go'),
      new AIMessage({ content: '', tool_calls: [{ id: 'c1', name: 'add_note', args: { title: 'a' }, type: 'tool_call' }] }),
      new ToolMessage({ content: 'added', tool_call_id: 'c1' }),
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'add_note', args: { title: 'a' } }] },
      { role: 'tool', content: 'added', toolCallId: 'c1' },
    ]);
  });
});

describe('toAiSdkModel (AI SDK)', () => {
  beforeEach(() => forgetToolModes());
  const model = toAiSdkModel('default', () => withTools(mockProvider(), {}));
  it('generates text', async () => {
    const out = await generateText({ model, prompt: 'hello' });
    expect(out.text).toContain('mock');
  });
  it('streams a tool call that the SDK runs, the way the spike agent does', async () => {
    const run: unknown[] = [];
    const result = streamText({
      model,
      prompt: 'Add a note',
      stopWhen: stepCountIs(3),
      tools: {
        add_note: aiTool({
          description: 'Add a note',
          inputSchema: z.object({ title: z.string() }),
          execute: async (input) => (run.push(input), 'added'),
        }),
      },
    });
    let text = '';
    for await (const part of result.textStream) text += part;
    expect(run).toEqual([{ title: 'sample' }]);
    expect(text).toBe('Done.');
  });
  it('turns an AI SDK prompt into gateway messages', () => {
    expect(
      fromAiSdkPrompt([
        { role: 'system', content: 'S' },
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'ok' },
            { type: 'tool-call', toolCallId: 'c', toolName: 'add_note', input: { title: 'a' } },
          ],
        },
        {
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: 'c', toolName: 'add_note', output: { type: 'json', value: { n: 1 } } }],
        },
      ]),
    ).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok', toolCalls: [{ id: 'c', name: 'add_note', args: { title: 'a' } }] },
      { role: 'tool', toolCallId: 'c', content: '{"n":1}' },
    ]);
  });
  it('can be built with nothing configured, and says so only when it is called', async () => {
    const restore = withEnv({
      LLM_PROVIDER: undefined,
      LITELLM_API_KEY: undefined,
      LITELLM_BASE_URL: undefined,
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      NODE_ENV: 'production',
    });
    try {
      const m = litellmModel();
      expect(m.modelId).toBe('not-configured');
      await expect(generateText({ model: m, prompt: 'x' })).rejects.toThrow(/No model is configured/);
    } finally {
      restore();
    }
  });
});

describe('routes follow LLM_PROVIDER', () => {
  let restore: () => void;
  beforeEach(() => {
    forgetToolModes();
    restore = withEnv({ LLM_PROVIDER: 'mock', LITELLM_API_KEY: 'test-key', LITELLM_BASE_URL: 'gateway.example.com/v1' });
  });
  afterEach(() => restore());

  it('/api/health reports the provider and models, and leaks neither address nor key', async () => {
    const res = await health(new Request('http://localhost/api/health'));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, live: true, provider: 'mock', models: { default: 'mock-default', quick: 'mock-quick' } });
    expect(JSON.stringify(body)).not.toMatch(/gateway\.example|test-key/);
  });
  it('/api/health?probe=1 makes one tool call and reports pass or fail', async () => {
    const body = await (
      await health(new Request('http://localhost/api/health?probe=1', { headers: { 'x-forwarded-for': '10.0.0.1' } }))
    ).json();
    expect(body.probe).toMatchObject({ ok: true, provider: 'mock', model: 'mock-quick', toolCalling: 'works' });
  });
  it('/api/health?probe=tools is the same probe under its older name', async () => {
    const body = await (
      await health(new Request('http://localhost/api/health?probe=tools', { headers: { 'x-forwarded-for': '10.0.0.2' } }))
    ).json();
    expect(body.probe).toMatchObject({
      ok: true,
      mode: 'native',
      toolCalling: 'works',
      toolCall: { name: 'add_canvas_node', args: { kind: 'note', title: 'sample' } },
    });
    expect(JSON.stringify(body)).not.toMatch(/gateway\.example|test-key/);
  });
  it('/api/health?probe reports a plain error with no model configured', async () => {
    restore();
    restore = withEnv({
      LLM_PROVIDER: undefined,
      LITELLM_API_KEY: undefined,
      LITELLM_BASE_URL: undefined,
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      NODE_ENV: 'production', // in development the stand-in or the Claude Code command would answer
    });
    const body = await (
      await health(new Request('http://localhost/api/health?probe=tools', { headers: { 'x-forwarded-for': '10.0.0.3' } }))
    ).json();
    expect(body).toMatchObject({ live: false, provider: null, probe: { ok: false } });
  });
  it('/api/llm streams a role-aware answer from the mock', async () => {
    const prompt =
      'You are the Researcher agent on Turnkey, a line of agents that builds small record-keeping web apps (tables, roles, one status workflow, screens) from one sentence. Code checks your answer and sends it back if it fails, so follow the format exactly. Reply with ONE JSON object and nothing else: no prose, no code fences.\n\nREQUEST: "Track tickets"\n\nWrite the brief.';
    const res = await llm(
      new Request('http://localhost/api/llm', {
        method: 'POST',
        headers: { 'x-forwarded-for': '10.0.0.4' },
        body: JSON.stringify({ prompt }),
      }),
    );
    const events = (await res.text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const text = events
      .filter((e) => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(events.at(-1)).toMatchObject({ type: 'done', truncated: false });
    expect(JSON.parse(text)).toMatchObject({ roles: expect.any(Array), process: { states: expect.any(Array) } });
  });
});

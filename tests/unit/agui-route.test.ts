import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/copilotkit/[[...slug]]/route';
import { registerAgent, resolveAgents, unregisterAgent } from '@/server/agui/registry';
import { graphAgent } from '@/server/agui/graph-agent';
import { runAgent } from '@/platform/agui/client';

const origin = 'http://localhost:3108';
const runBody = (extra: Record<string, unknown> = {}) => ({
  threadId: 't-1',
  runId: 'r-1',
  messages: [{ id: 'm1', role: 'user', content: 'hello brave world' }],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
  ...extra,
});
const post = (agent: string, body: unknown) =>
  POST(
    new Request(`${origin}/api/copilotkit/agent/${agent}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}` },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => vi.stubEnv('LLM_PROVIDER', 'mock'));
afterEach(() => vi.unstubAllEnvs());

describe('registry', () => {
  it('has default always, and echo only with the mock provider', async () => {
    expect(Object.keys(await resolveAgents({ LLM_PROVIDER: 'mock' })).sort()).toEqual(['default', 'echo', 'step']);
    expect(Object.keys(await resolveAgents({})).sort()).toEqual(['default', 'step']);
  });

  it('registers an agent lazily and survives a loader that throws', async () => {
    let calls = 0;
    registerAgent('late', () => (calls++, graphAgent(() => {})));
    registerAgent('broken', () => {
      throw new Error('nope');
    });
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = await resolveAgents({});
    await resolveAgents({});
    expect(Object.keys(first).sort()).toEqual(['default', 'late', 'step']);
    expect(calls).toBe(1);
    quiet.mockRestore();
    unregisterAgent('late');
    unregisterAgent('broken');
  });
});

describe('/api/copilotkit route', () => {
  it('lists the agents at /info', async () => {
    const res = await GET(new Request(`${origin}/api/copilotkit/info`));
    expect(res.status).toBe(200);
    const info = (await res.json()) as { agents: Record<string, unknown> };
    expect(Object.keys(info.agents)).toEqual(expect.arrayContaining(['default', 'echo']));
  });

  it('streams the echo agent as server-sent events from RUN_STARTED to RUN_FINISHED', async () => {
    const res = await post('echo', runBody());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    const types = [...text.matchAll(/"type":"([A-Z_]+)"/g)].map((m) => m[1]);
    expect(types[0]).toBe('RUN_STARTED');
    expect(types.at(-1)).toBe('RUN_FINISHED');
    expect(types).toEqual(expect.arrayContaining(['STEP_STARTED', 'TEXT_MESSAGE_CONTENT', 'TOOL_CALL_RESULT', 'STATE_DELTA']));
  });

  it('answers 404 for an agent that is not registered', async () => {
    expect((await post('nobody', runBody())).status).toBe(404);
  });

  it('does not offer echo without the mock provider', async () => {
    vi.stubEnv('LLM_PROVIDER', '');
    expect((await post('echo', runBody())).status).toBe(404);
  });

  it('the browser client runs echo through the route and gets callbacks and a result', async () => {
    const steps: string[] = [];
    let text = '';
    const tools: string[] = [];
    let last: unknown;
    const res = await runAgent('echo', {
      messages: 'hello brave world',
      fetch: ((url: string, init: RequestInit) => POST(new Request(new URL(url, origin), init))) as typeof fetch,
      onStepStarted: (n) => steps.push(n),
      onText: (d) => (text += d),
      onToolCall: (c) => tools.push(c.name),
      onState: (s) => (last = s),
    });
    expect(res).toMatchObject({ ok: true, result: { echo: 'hello brave world', words: 3 } });
    expect(steps).toEqual(['listen', 'reply']);
    expect(text.trim()).toBe('hello brave world');
    expect(tools).toEqual(['count_words']);
    expect(last).toMatchObject({ echo: { heard: 3 } });
  });

  it('the client reports an error run as a failure with its code', async () => {
    const res = await runAgent('echo', {
      messages: 'x',
      forwardedProps: { mode: 'fail' },
      fetch: ((url: string, init: RequestInit) => POST(new Request(new URL(url, origin), init))) as typeof fetch,
    });
    expect(res).toMatchObject({ ok: false, aborted: false, error: { code: 'echo_failed' } });
  });

  it('the client stops a slow run when aborted', async () => {
    const ctl = new AbortController();
    const started = Date.now();
    const pending = runAgent('echo', {
      messages: 'x',
      forwardedProps: { mode: 'slow' },
      signal: ctl.signal,
      fetch: ((url: string, init: RequestInit) => POST(new Request(new URL(url, origin), init))) as typeof fetch,
      onStepStarted: () => setTimeout(() => ctl.abort(), 20),
    });
    const res = await pending;
    expect(res).toMatchObject({ ok: false, aborted: true });
    expect(Date.now() - started).toBeLessThan(1500);
  });
});

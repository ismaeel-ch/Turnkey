import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setEnv } from './helpers/fakes';

// The health route keeps its limiter in module state, so each test loads a fresh copy.
async function freshRoute() {
  vi.resetModules();
  return import('@/app/api/health/route');
}

const restore: Array<() => void> = [];
const get = (query = '') => new Request(`http://localhost/api/health${query}`);

beforeEach(() => {
  restore.push(
    setEnv({
      LITELLM_BASE_URL: undefined,
      LITELLM_API_KEY: undefined,
      LITELLM_MODEL: undefined,
      LITELLM_MODEL_FAST: undefined,
      OPENAI_API_KEY: undefined,
      OPENAI_MODEL: undefined,
      LLM_PROVIDER: undefined,
      LIVE_MODE: undefined,
      LLM_DAILY_CALL_CAP: '1000',
      LLM_GLOBAL_PER_MINUTE: '1000',
      LLM_RATE_PER_MINUTE: '100',
      VERCEL_GIT_COMMIT_SHA: 'abcdef1234567890',
    }),
  );
});

afterEach(() => {
  while (restore.length) restore.pop()?.();
});

describe('GET /api/health with no model configured', () => {
  it('reports the app as up, with live off and no provider', async () => {
    const { GET } = await freshRoute();
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, name: 'turnkey', live: false, provider: null, models: null });
    expect(body.usage).toEqual({ today: 0, thisMinute: 0 });
    expect(typeof body.version).toBe('string');
    expect(body.commit).toBe('abcdef1');
    expect(new Date(body.time).toString()).not.toBe('Invalid Date');
  });

  it('never includes a key or a gateway address', async () => {
    restore.push(setEnv({ LITELLM_BASE_URL: 'gateway.example/v1', LITELLM_API_KEY: 'kx-made-up', LITELLM_MODEL: 'model-a' }));
    const { GET } = await freshRoute();
    const text = await (await GET(get())).text();
    expect(text).not.toContain('gateway.example');
    expect(text).not.toContain('kx-made-up');
  });

  it('reports no commit when Vercel has not set one', async () => {
    restore.push(setEnv({ VERCEL_GIT_COMMIT_SHA: undefined }));
    const { GET } = await freshRoute();
    await expect((await GET(get())).json()).resolves.toMatchObject({ commit: null });
  });

  it('does not make a model call for probe=1, and says nothing about a probe', async () => {
    const { GET } = await freshRoute();
    const body = await (await GET(get('?probe=1'))).json();
    expect(body).not.toHaveProperty('probe');
  });

  it('reports the tool probe as not ready, naming what is missing, without calling a gateway', async () => {
    const { GET } = await freshRoute();
    const body = await (await GET(get('?probe=tools'))).json();
    expect(body.tools).toEqual({ ok: false, missing: ['LITELLM_BASE_URL', 'LITELLM_API_KEY', 'LITELLM_MODEL'] });
  });
});

describe('GET /api/health with the mock provider', () => {
  beforeEach(() => {
    restore.push(setEnv({ LLM_PROVIDER: 'mock' }));
  });

  it('reports live with the mock provider and its model names', async () => {
    const { GET } = await freshRoute();
    const body = await (await GET(get())).json();
    expect(body).toMatchObject({
      ok: true,
      live: true,
      provider: 'mock',
      models: { default: 'mock-default', quick: 'mock-quick' },
    });
  });

  it('answers a probe with the reply of a quick call', async () => {
    const { GET } = await freshRoute();
    const body = await (await GET(get('?probe=1'))).json();
    expect(body.probe).toMatchObject({ ok: true, model: 'mock-quick' });
    expect(body.probe.reply.length).toBeGreaterThan(0);
    expect(body.probe.reply.length).toBeLessThanOrEqual(40);
    expect(typeof body.probe.ms).toBe('number');
  });

  it('refuses a probe once the daily allowance is used up', async () => {
    restore.push(setEnv({ LLM_DAILY_CALL_CAP: '1' }));
    const { GET } = await freshRoute();
    await (await GET(get('?probe=1'))).json(); // uses the one call the day allows
    const body = await (await GET(get('?probe=1'))).json();
    expect(body.probe).toMatchObject({ ok: false });
    expect(body.probe.error).toMatch(/allowance/);
  });
});

describe('GET /api/health?probe=tools', () => {
  // The gateway is stood in for by a fake fetch: nothing leaves the test.
  const gateway = (answer: (url: string) => Response) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => answer(String(input instanceof Request ? input.url : input))),
    );
  const litellm = () =>
    restore.push(setEnv({ LITELLM_BASE_URL: 'gateway.example/v1', LITELLM_API_KEY: 'kx-made-up', LITELLM_MODEL: 'model-a' }));

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports that tool calls work when the model makes one', async () => {
    litellm();
    gateway((url) => {
      if (url.endsWith('/models')) return Response.json({ object: 'list', data: [{ id: 'model-a', object: 'model' }] });
      return Response.json({
        id: 'x',
        object: 'chat.completion',
        created: 0,
        model: 'model-a',
        choices: [
          {
            index: 0,
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                { id: 'c1', type: 'function', function: { name: 'add_canvas_node', arguments: '{"kind":"note","title":"Hello"}' } },
              ],
            },
          },
        ],
      });
    });
    const { GET } = await freshRoute();
    const body = await (await GET(get('?probe=tools'))).json();
    expect(body.tools).toMatchObject({
      ok: true,
      model: 'model-a',
      toolCalling: 'works',
      toolCall: { name: 'add_canvas_node', arguments: '{"kind":"note","title":"Hello"}' },
      availableModels: ['model-a'],
    });
  });

  it('reports a plain answer with no tool call as not ready', async () => {
    litellm();
    gateway((url) =>
      url.endsWith('/models')
        ? new Response('no', { status: 403 })
        : Response.json({
            id: 'x',
            object: 'chat.completion',
            created: 0,
            model: 'model-a',
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'Hello' } }],
          }),
    );
    const { GET } = await freshRoute();
    const body = await (await GET(get('?probe=tools'))).json();
    expect(body.tools).toMatchObject({ ok: false, toolCalling: 'model answered without a tool call', availableModels: [] });
  });

  it('hides the gateway error text, which can carry the address', async () => {
    litellm();
    gateway(() => new Response('upstream at gateway.example said no', { status: 500 }));
    const { GET } = await freshRoute();
    const text = await (await GET(get('?probe=tools'))).text();
    const body = JSON.parse(text);
    expect(body.tools).toMatchObject({ ok: false, model: 'model-a', error: 'the tool-call probe failed; see the server log' });
    expect(text).not.toContain('gateway.example');
  });
});

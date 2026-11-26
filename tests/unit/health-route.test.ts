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
      NODE_ENV: 'production', // outside production an unset provider becomes a stand-in
      VERCEL: undefined,
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

  it('says plainly that there is no model when asked for a probe, and calls nothing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { GET } = await freshRoute();
    const body = await (await GET(get('?probe=1'))).json();
    expect(body.probe).toEqual({ ok: false, error: 'No model is configured on this deployment.' });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
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

  it('answers a probe with a tool call made on the quick model', async () => {
    const { GET } = await freshRoute();
    const body = await (await GET(get('?probe=1'))).json();
    expect(body.probe).toMatchObject({
      ok: true,
      provider: 'mock',
      model: 'mock-quick',
      mode: 'native',
      toolCalling: 'works',
      toolCall: { name: 'add_canvas_node', args: { kind: 'note', title: 'sample' } },
    });
    expect(typeof body.probe.ms).toBe('number');
  });

  it('treats probe=tools as the same probe', async () => {
    const { GET } = await freshRoute();
    const body = await (await GET(get('?probe=tools'))).json();
    expect(body.probe).toMatchObject({ ok: true, toolCalling: 'works' });
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

describe('GET /api/health?probe with a provider that does not behave', () => {
  const withProvider = async (stream: () => AsyncIterable<unknown>) => {
    vi.resetModules();
    const real = await vi.importActual<typeof import('@/server/llm')>('@/server/llm');
    vi.doMock('@/server/llm', () => ({
      ...real,
      resolveProvider: () => ({ id: 'fake', model: (t: string) => 'fake-' + t, stream }),
    }));
    return { ...(await import('@/app/api/health/route')), LlmError: real.LlmError };
  };
  afterEach(() => {
    vi.doUnmock('@/server/llm');
  });

  it('reports a plain answer with no tool call as not ready', async () => {
    const { GET } = await withProvider(async function* () {
      yield { type: 'delta', text: 'Hello' };
      yield { type: 'done', truncated: false };
    });
    const body = await (await GET(get('?probe=1'))).json();
    expect(body.probe).toMatchObject({ ok: false, provider: 'fake', model: 'fake-quick', mode: 'native', toolCall: null });
    expect(body.probe.toolCalling).toBe('model answered without a tool call');
  });

  it('passes on the code and message of a gateway error, never the raw error', async () => {
    let fail: () => never = () => {
      throw new Error('not set');
    };
    const { GET, LlmError } = await withProvider(async function* () {
      yield* [];
      fail();
    });
    fail = () => {
      throw new LlmError('rate_limited', 'The model is busy.', 429);
    };
    const body = await (await GET(get('?probe=1'))).json();
    expect(body.probe).toMatchObject({ ok: false, model: 'fake-quick', code: 'rate_limited', error: 'The model is busy.' });
  });

  it('hides the text of any other failure, which can carry the gateway address', async () => {
    const { GET } = await withProvider(async function* () {
      yield* [];
      throw new Error('upstream at gateway.example said no');
    });
    const text = await (await GET(get('?probe=1'))).text();
    expect(JSON.parse(text).probe).toMatchObject({ ok: false, code: 'upstream', error: 'the tool-call probe failed' });
    expect(text).not.toContain('gateway.example');
  });
});

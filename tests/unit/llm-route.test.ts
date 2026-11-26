import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatChunk } from '@/server/llm/types';
import { ndjson, setEnv } from './helpers/fakes';

// The route keeps its rate limiter in module state, so every test loads a fresh copy of the route.
type Route = typeof import('@/app/api/llm/route');
async function freshRoute(): Promise<Route> {
  vi.resetModules();
  return import('@/app/api/llm/route');
}

let visitor = 0;
const restore: Array<() => void> = [];
function env(vars: Record<string, string | undefined>) {
  restore.push(setEnv(vars));
}
function postRequest(body: BodyInit | null, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/llm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `visitor-${++visitor}`, ...headers },
    body,
  });
}
const json = (value: unknown) => postRequest(JSON.stringify(value));
// The route relays only prompts shaped like Turnkey's own agents' (src/server/guard/prompt.ts): this is HEAD() from
// src/workspace/line.ts for the Researcher.
const HEAD =
  'You are the Researcher agent on Turnkey, a line of agents that builds small record-keeping web apps (tables, roles, one status workflow, screens) from one sentence. Code checks your answer and sends it back if it fails, so follow the format exactly. Reply with ONE JSON object and nothing else: no prose, no code fences.\n\n';
const ask = (text: string) => HEAD + text;

beforeEach(() => {
  // Generous limits unless a test sets its own. No real key anywhere.
  env({
    LITELLM_API_KEY: undefined,
    LITELLM_BASE_URL: undefined,
    OPENAI_API_KEY: undefined,
    OPENAI_MODEL: undefined,
    LLM_PROVIDER: 'mock',
    LLM_RATE_PER_MINUTE: '100',
    LLM_GLOBAL_PER_MINUTE: '1000',
    LLM_DAILY_CALL_CAP: '1000',
    LLM_MAX_PROMPT_CHARS: undefined,
    LIVE_MODE: undefined,
  });
});

afterEach(() => {
  vi.doUnmock('@/server/llm');
  vi.restoreAllMocks();
  while (restore.length) restore.pop()?.();
});

describe('POST /api/llm with the mock provider', () => {
  it('streams the mock answer as newline-delimited JSON and ends with done', async () => {
    const { POST } = await freshRoute();
    const res = await POST(json({ prompt: ask('REQUEST: "Build a library app"'), tier: 'quick' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-ndjson');
    expect(res.headers.get('cache-control')).toContain('no-store');
    const events = await ndjson(res);
    const text = events.map((e) => (e.type === 'delta' ? String(e.text) : '')).join('');
    expect(typeof JSON.parse(text)).toBe('object');
    expect(events.at(-1)).toMatchObject({ type: 'done', truncated: false });
  });

  it('accepts a request with no tier', async () => {
    const { POST } = await freshRoute();
    const res = await POST(json({ prompt: ask('hi') }));
    expect(res.status).toBe(200);
    await res.text();
  });

  it('refuses a body that is not JSON with 400', async () => {
    const { POST } = await freshRoute();
    const res = await POST(postRequest('not json at all'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'bad_request', message: 'The request body must be JSON.' });
  });

  it('refuses a missing or blank prompt with 400', async () => {
    const { POST } = await freshRoute();
    for (const body of [{}, { prompt: '' }, { prompt: 42 }]) {
      const res = await POST(json(body));
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ code: 'bad_request' });
    }
    const blank = await POST(json({ prompt: '   ' }));
    expect(blank.status).toBe(400);
    await expect(blank.json()).resolves.toMatchObject({ code: 'bad_request', message: 'A prompt is required.' });
  });

  it('refuses a prompt longer than the limit with 413', async () => {
    env({ LLM_MAX_PROMPT_CHARS: String(HEAD.length + 10) });
    const { POST } = await freshRoute();
    const res = await POST(json({ prompt: ask('x'.repeat(11)) }));
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toMatchObject({ code: 'too_large', message: 'The prompt is too long.' });
    const ok = await POST(json({ prompt: ask('x'.repeat(10)) }));
    expect(ok.status).toBe(200);
    await ok.text();
  });

  it('refuses the visitor who is over the per-minute limit with 429 and a retry-after', async () => {
    env({ LLM_RATE_PER_MINUTE: '2' });
    const { POST } = await freshRoute();
    const headers = { 'x-forwarded-for': 'same-visitor' };
    for (let i = 0; i < 2; i++) (await POST(postRequest(JSON.stringify({ prompt: ask('x') }), headers))).body?.cancel();
    const res = await POST(postRequest(JSON.stringify({ prompt: ask('x') }), headers));
    expect(res.status).toBe(429);
    const retry = Number(res.headers.get('retry-after'));
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    await expect(res.json()).resolves.toMatchObject({ code: 'rate_limited', message: 'Too many model calls in one minute.' });
  });

  it('refuses everyone once the daily cap is used up, with code budget', async () => {
    env({ LLM_DAILY_CALL_CAP: '1' });
    const { POST } = await freshRoute();
    (await POST(json({ prompt: ask('first') }))).body?.cancel();
    const res = await POST(json({ prompt: ask('second') }));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({ code: 'budget' });
  });

  it('answers 503 not_configured when LIVE_MODE is off', async () => {
    env({ LIVE_MODE: 'off' });
    const { POST } = await freshRoute();
    const res = await POST(json({ prompt: ask('x') }));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ code: 'not_configured' });
  });
});

describe('POST /api/llm with no model configured', () => {
  it('answers 503 not_configured and says so in plain words', async () => {
    env({ LLM_PROVIDER: undefined, NODE_ENV: 'production' }); // outside production the route would fall back to a stand-in
    const { POST } = await freshRoute();
    const res = await POST(json({ prompt: ask('x') }));
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toContain('no-store');
    await expect(res.json()).resolves.toEqual({ code: 'not_configured', message: 'No model is configured on this deployment.' });
  });

  it('answers 503 even for a body that is not JSON, because the provider is checked first', async () => {
    env({ LLM_PROVIDER: undefined, NODE_ENV: 'production' }); // outside production the route would fall back to a stand-in
    const { POST } = await freshRoute();
    const res = await POST(postRequest('{'));
    expect(res.status).toBe(503);
  });
});

describe('POST /api/llm when the provider fails midway', () => {
  /** Loads the route with a provider whose stream yields `text` (if any) and then fails with what `fail` makes. */
  async function routeWithFailure(text: string, fail: (E: typeof import('@/server/llm/types').LlmError) => unknown) {
    vi.resetModules();
    // The error class must come from the same module graph as the route, or the route will not recognise it.
    const { LlmError: E } = await import('@/server/llm/types');
    vi.doMock('@/server/llm', async (original) => ({
      ...(await original<typeof import('@/server/llm')>()),
      resolveProvider: () => ({
        id: 'fake',
        model: (tier: string) => tier,
        async *stream(): AsyncGenerator<ChatChunk> {
          if (text) yield { type: 'delta', text };
          throw fail(E);
        },
      }),
    }));
    return (await import('@/app/api/llm/route')) as Route;
  }

  it('sends the error as an event after what was already sent', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await routeWithFailure('partial', (E) => new E('rate_limited', 'Slow down a little'));
    const events = await ndjson(await POST(json({ prompt: ask('x') })));
    expect(events).toEqual([
      { type: 'delta', text: 'partial' },
      { type: 'error', code: 'rate_limited', message: 'Slow down a little' },
    ]);
  });

  it('passes an unauthorized provider error on as not_configured, so the browser stops asking', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await routeWithFailure('', (E) => new E('unauthorized', 'The key was refused'));
    const events = await ndjson(await POST(json({ prompt: ask('x') })));
    expect(events).toEqual([{ type: 'error', code: 'not_configured', message: 'The key was refused' }]);
  });

  it('hides an unknown failure behind a generic upstream message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await routeWithFailure('', () => new Error('connect ECONNREFUSED 10.0.0.1:4000 with key sk-live'));
    const events = await ndjson(await POST(json({ prompt: ask('x') })));
    expect(events).toEqual([{ type: 'error', code: 'upstream', message: 'the model call failed' }]);
    expect(JSON.stringify(events)).not.toContain('ECONNREFUSED');
  });
});

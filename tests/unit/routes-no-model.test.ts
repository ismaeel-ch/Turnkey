/**
 * Rule 6 of the project: with no model configured, nothing crashes and every model route says so plainly. Each route
 * is called directly with a Request, in production mode (where neither the stand-in nor the Claude Code command is
 * picked), with every provider variable cleared.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NO_MODEL = {
  NODE_ENV: 'production',
  LLM_PROVIDER: '',
  ANTHROPIC_API_KEY: '',
  LITELLM_API_KEY: '',
  LITELLM_BASE_URL: '',
  OPENAI_API_KEY: '',
  OPENAI_MODEL: '',
};

let n = 0;
const json = (url: string, body: unknown) =>
  new Request('http://localhost' + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.51.100.${(n++ % 250) + 1}` },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  for (const [k, v] of Object.entries(NO_MODEL)) vi.stubEnv(k, v);
});
afterEach(() => vi.unstubAllEnvs());

describe('with no model configured', () => {
  it('/api/agent/step answers 503 not_configured before reading the body', async () => {
    const { POST } = await import('@/app/api/agent/step/route');
    const res = await POST(json('/api/agent/step', 'not even a valid body'));
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ code: 'not_configured', message: 'No model is configured on this deployment.' });
  });

  it('/api/llm answers 503 not_configured', async () => {
    const { POST } = await import('@/app/api/llm/route');
    const res = await POST(json('/api/llm', { messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'not_configured' });
  });

  it('/api/health answers 200 and says no model is connected, without a key or an address', async () => {
    const { GET } = await import('@/app/api/health/route');
    const res = await GET(new Request('http://localhost/api/health', { headers: { 'x-forwarded-for': '198.51.100.250' } }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ ok: true, live: false, provider: null, models: null });
    expect(text).not.toMatch(/https?:\/\//);
  });

  it('/api/share still works: it needs no model', async () => {
    const { GET } = await import('@/app/api/share/route');
    const res = GET(new Request('http://localhost/api/share', { headers: { 'x-forwarded-for': '198.51.100.249' } }));
    expect(res.status).toBe(200);
  });
});

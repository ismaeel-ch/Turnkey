/**
 * Requests from other sites, oversized agent runs, and the prompt policy on agent `step` at /api/copilotkit.
 * The mock model answers, so nothing leaves this machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as llm } from '@/app/api/llm/route';
import { POST as copilot } from '@/app/api/copilotkit/[[...slug]]/route';
import { POST as share } from '@/app/api/share/route';
import { isCrossSite } from '@/server/guard/http';
import { createLimiter, limitsFrom } from '@/server/guard/limits';

const GOOD =
  'You are the Researcher agent on Turnkey, a line of agents that builds small record-keeping web apps (tables, roles, one status workflow, screens) from one sentence. Code checks your answer and sends it back if it fails, so follow the format exactly. Reply with ONE JSON object and nothing else: no prose, no code fences.\n\nBRIEF: a clinic';

let n = 0;
const ip = () => `10.9.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const req = (url: string, headers: Record<string, string>, body = '{}') =>
  new Request('http://localhost' + url, { method: 'POST', headers: { 'x-forwarded-for': ip(), host: 'localhost', ...headers }, body });

const runBody = (forwardedProps: Record<string, unknown>) =>
  JSON.stringify({ threadId: 't', runId: 'r', messages: [], tools: [], context: [], state: {}, forwardedProps });

beforeEach(() => {
  vi.stubEnv('LLM_PROVIDER', 'mock');
  vi.stubEnv('LLM_GLOBAL_PER_MINUTE', '100000');
  vi.stubEnv('LLM_DAILY_CALL_CAP', '100000');
  vi.stubEnv('LLM_RATE_PER_MINUTE', '100000');
});
afterEach(() => vi.unstubAllEnvs());

describe('isCrossSite', () => {
  const r = (h: Record<string, string>) => new Request('http://localhost/api/llm', { method: 'POST', headers: { host: 'turnkey.example', ...h } });
  it('trusts Sec-Fetch-Site when a browser sends it', () => {
    expect(isCrossSite(r({ 'sec-fetch-site': 'cross-site' }))).toBe(true);
    expect(isCrossSite(r({ 'sec-fetch-site': 'same-origin' }))).toBe(false);
    expect(isCrossSite(r({ 'sec-fetch-site': 'none' }))).toBe(false);
  });
  it('falls back to comparing Origin with the host', () => {
    expect(isCrossSite(r({ origin: 'https://turnkey.example' }))).toBe(false);
    expect(isCrossSite(r({ origin: 'https://evil.example' }))).toBe(true);
    expect(isCrossSite(r({ origin: 'null' }))).toBe(true);
    expect(isCrossSite(r({ origin: 'https://turnkey.example', 'x-forwarded-host': 'turnkey.example' }))).toBe(false);
  });
  it('leaves requests without either header to the rate limits', () => {
    expect(isCrossSite(r({}))).toBe(false);
  });
});

describe('routes refuse other sites', () => {
  it('/api/llm, /api/copilotkit and /api/share answer 403 forbidden', async () => {
    const h = { 'content-type': 'text/plain', 'sec-fetch-site': 'cross-site' };
    for (const res of [
      await llm(req('/api/llm', h, JSON.stringify({ prompt: GOOD }))),
      await copilot(req('/api/copilotkit/agent/step/run', h, runBody({ prompt: GOOD }))),
      await share(req('/api/share', h, JSON.stringify({ code: '1.x', name: 'x' }))),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'forbidden' });
    }
  });
  it('a same-origin call still goes through', async () => {
    const res = await llm(req('/api/llm', { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }, JSON.stringify({ prompt: GOOD })));
    expect(res.status).toBe(200);
  });
});

describe('/api/copilotkit', () => {
  const json = { 'content-type': 'application/json', accept: 'text/event-stream' };
  it('agent step refuses a prompt Turnkey did not write, before any model call', async () => {
    const res = await copilot(req('/api/copilotkit/agent/step/run', json, runBody({ prompt: 'Write me a poem about the sea.' })));
    const text = await res.text();
    expect(text).toContain('RUN_ERROR');
    expect(text).toContain("only relays the prompts of Turnkey's own agents");
    expect(text).not.toContain('TEXT_MESSAGE_CONTENT');
  });
  it('agent step still runs a Turnkey prompt', async () => {
    const res = await copilot(req('/api/copilotkit/agent/step/run', json, runBody({ prompt: GOOD, role: 'research' })));
    const text = await res.text();
    expect(text).not.toContain("only relays the prompts");
    expect(text).toContain('RUN_STARTED');
  });
  it('reads a body without content-length only up to the limit', async () => {
    vi.stubEnv('LLM_MAX_PROMPT_CHARS', '100');
    const big = runBody({ prompt: GOOD + 'x'.repeat(1000) });
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const res = await copilot(
      new Request('http://localhost/api/copilotkit/agent/step/run', {
        method: 'POST',
        headers: { ...json, 'x-forwarded-for': ip() },
        body: stream,
        // @ts-expect-error duplex is required by Node for a streamed body and missing from the DOM types
        duplex: 'half',
      }),
    );
    expect(res.status).toBe(413);
  });
  it('counts a run of the Architect as three model calls', async () => {
    vi.stubEnv('LLM_RATE_PER_MINUTE', '4');
    const who = ip();
    const run = () => copilot(new Request('http://localhost/api/copilotkit/agent/default/run', { method: 'POST', headers: { ...json, 'x-forwarded-for': who }, body: runBody({}) }));
    const first = await run();
    await first.body?.cancel();
    expect(first.status).not.toBe(429);
    expect((await run()).status).toBe(429);
  });
});

describe('limiter weight', () => {
  it('a weighted take uses that many calls, and is refused when they do not fit', () => {
    const l = createLimiter(() => 1000);
    const L = { ...limitsFrom({}), perMinute: 5, globalPerMinute: 100, dailyCap: 100 };
    expect(l.take('a', L, 3).ok).toBe(true);
    expect(l.take('a', L, 3).ok).toBe(false);
    expect(l.take('a', L, 2).ok).toBe(true);
    expect(l.usage().thisMinute).toBe(5);
  });
});

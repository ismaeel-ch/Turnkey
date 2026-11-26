import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { answerMeter, createLimiter, limitsFrom } from '@/server/guard/limits';
import { parseBody, refuse, visitorKey } from '@/server/guard/http';

describe('limitsFrom', () => {
  it('has safe defaults and reads the environment', () => {
    const d = limitsFrom({});
    expect(d).toMatchObject({
      perMinute: 20,
      globalPerMinute: 50,
      dailyCap: 600,
      maxPromptChars: 120000,
      maxOutputTokens: 8000,
      off: false,
    });
    expect(d.maxAnswerChars).toBe(32000);
    const e = limitsFrom({ LLM_RATE_PER_MINUTE: '3', LLM_MAX_ANSWER_CHARS: '100', LIVE_MODE: ' OFF ' });
    expect(e.perMinute).toBe(3);
    expect(e.maxAnswerChars).toBe(100);
    expect(e.off).toBe(true);
  });
  it('ignores values that are not positive numbers', () => {
    const d = limitsFrom({ LLM_RATE_PER_MINUTE: '-1', LLM_DAILY_CALL_CAP: 'lots', LLM_GLOBAL_PER_MINUTE: '0' });
    expect([d.perMinute, d.dailyCap, d.globalPerMinute]).toEqual([20, 600, 50]);
  });
});

describe('limiter', () => {
  const lim = (o: Record<string, string> = {}) => limitsFrom(o);
  it('limits one visitor per minute, then lets them back in', () => {
    let t = 1000;
    const l = createLimiter(() => t);
    const L = lim({ LLM_RATE_PER_MINUTE: '2' });
    expect(l.take('a', L).ok).toBe(true);
    expect(l.take('a', L).ok).toBe(true);
    const v = l.take('a', L);
    expect(v).toMatchObject({ ok: false, code: 'rate_limited' });
    expect(l.take('b', L).ok).toBe(true);
    t += 60_001;
    expect(l.take('a', L).ok).toBe(true);
  });
  it('limits everyone together per minute', () => {
    const l = createLimiter(() => 5);
    const L = lim({ LLM_GLOBAL_PER_MINUTE: '3' });
    for (const who of ['a', 'b', 'c']) expect(l.take(who, L).ok).toBe(true);
    expect(l.take('d', L)).toMatchObject({ ok: false, code: 'rate_limited' });
  });
  it('stops at the daily cap and does not count refused calls', () => {
    let t = 0;
    const l = createLimiter(() => t);
    const L = lim({ LLM_DAILY_CALL_CAP: '2', LLM_GLOBAL_PER_MINUTE: '100' });
    expect(l.take('a', L).ok).toBe(true);
    t += 61_000;
    expect(l.take('b', L).ok).toBe(true);
    t += 61_000;
    expect(l.take('c', L)).toMatchObject({ ok: false, code: 'budget' });
    expect(l.usage().today).toBe(2);
    t += 86_400_000;
    expect(l.take('c', L).ok).toBe(true);
  });
  it('refuses everything when LIVE_MODE is off', () => {
    expect(createLimiter().take('a', lim({ LIVE_MODE: 'off' }))).toMatchObject({ ok: false, code: 'off' });
  });
  it('cannot be dodged by many different visitors: the global limit still holds', () => {
    const l = createLimiter(() => 1);
    const L = lim({ LLM_GLOBAL_PER_MINUTE: '10' });
    let ok = 0;
    for (let i = 0; i < 100; i++) if (l.take('v' + i, L).ok) ok++;
    expect(ok).toBe(10);
  });
});

describe('answerMeter', () => {
  it('cuts a stream at the size limit', () => {
    const m = answerMeter(10);
    expect(m.take('hello')).toEqual({ text: 'hello', done: false });
    expect(m.take('world!!')).toEqual({ text: 'world', done: true });
    expect(m.take('more')).toEqual({ text: '', done: true });
  });
});

describe('route helpers', () => {
  const post = (body: string, headers: Record<string, string> = {}) => new Request('http://x/api', { method: 'POST', body, headers });
  const schema = z.object({ prompt: z.string().min(1) });
  it('parses a valid body', async () => {
    const r = await parseBody(post('{"prompt":"hi"}'), schema);
    expect(r).toEqual({ ok: true, data: { prompt: 'hi' } });
  });
  it('answers bad JSON and bad shapes with a code', async () => {
    for (const body of ['{nope', '{"prompt":5}', '[]', '']) {
      const r = await parseBody(post(body), schema);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.response.status).toBe(400);
        expect((await r.response.json()).code).toBe('bad_request');
      }
    }
  });
  it('refuses a body over the size limit, declared or not', async () => {
    const big = JSON.stringify({ prompt: 'x'.repeat(200) });
    for (const req of [post(big), post(big, { 'content-length': '999999' })]) {
      const r = await parseBody(req, schema, 100);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(413);
    }
  });
  it('builds uniform errors', async () => {
    const r = refuse(429, 'rate_limited', 'slow down', { 'retry-after': '5' });
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('5');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toEqual({ code: 'rate_limited', message: 'slow down' });
  });
  it('names the visitor, and shortens a forged header', () => {
    expect(visitorKey(new Request('http://x', { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }))).toBe('1.2.3.4');
    expect(visitorKey(new Request('http://x', { headers: { 'x-forwarded-for': 'a'.repeat(500) } })).length).toBe(64);
    expect(visitorKey(new Request('http://x'))).toBe('local');
  });
});

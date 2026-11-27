/**
 * One visitor's share of the daily dollar cap: every model route charges its calls to the visitor that asked, and the
 * limiter refuses that visitor (and only that visitor) once their share is spent. The mock model answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as llm } from '@/app/api/llm/route';
import { POST as step } from '@/app/api/agent/step/route';
import { POST as copilot } from '@/app/api/copilotkit/[[...slug]]/route';
import { createLimiter, limitsFrom, VISITOR_CAP_MESSAGE } from '@/server/guard/limits';
import { chargeTo, chargedTo, recordUsage, resetUsageTotals, spentToday, spentTodayBy, usageTodayBy } from '@/server/llm/usage';

const GOOD =
  'You are the Researcher agent on Turnkey, a line of agents that builds small record-keeping web apps (tables, roles, one status workflow, screens) from one sentence. Code checks your answer and sends it back if it fails, so follow the format exactly. Reply with ONE JSON object and nothing else: no prose, no code fences.\n\nREQUEST: "a clinic"';

let n = 0;
const ip = () => `10.77.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const req = (url: string, who: string, body: unknown) =>
  new Request('http://localhost' + url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': who, host: 'localhost' },
    body: JSON.stringify(body),
  });
const runBody = (forwardedProps: Record<string, unknown>) => ({
  threadId: 't',
  runId: 'r',
  messages: [],
  tools: [],
  context: [],
  state: {},
  forwardedProps,
});

beforeEach(() => {
  resetUsageTotals();
  vi.stubEnv('LLM_PROVIDER', 'mock');
  vi.stubEnv('LLM_LOG_USAGE', '0');
  vi.stubEnv('LLM_GLOBAL_PER_MINUTE', '100000');
  vi.stubEnv('LLM_DAILY_CALL_CAP', '100000');
  vi.stubEnv('LLM_RATE_PER_MINUTE', '100000');
});
afterEach(() => vi.unstubAllEnvs());

const call = (usd: number) =>
  recordUsage(
    { provider: 't', model: 'm', tier: 'default', effort: 'low', usage: { input: 1, output: 1, costUsd: usd }, ms: 1 },
    { LLM_LOG_USAGE: '0' },
  );

describe('charging calls to a visitor', () => {
  it('adds a call to the visitor it runs under, and to nobody outside chargeTo', async () => {
    expect(chargedTo()).toBeUndefined();
    await chargeTo('a', async () => {
      await Promise.resolve();
      expect(chargedTo()).toBe('a');
      call(0.5);
    });
    call(0.25);
    expect(spentTodayBy('a')).toBeCloseTo(0.5);
    expect(spentTodayBy('b')).toBe(0);
    expect(spentToday()).toBeCloseTo(0.75);
  });
});

describe('the limiter', () => {
  it('refuses a visitor whose share is spent, and lets everyone else through', () => {
    const mine: Record<string, number> = { greedy: 2 };
    const l = createLimiter(
      () => 1000,
      () => 2,
      (who) => mine[who] ?? 0,
    );
    const L = limitsFrom({ LLM_DAILY_SPEND_USD: '5' });
    expect(L.visitorDailySpendUsd).toBe(2);
    expect(l.take('greedy', L)).toMatchObject({ ok: false, code: 'budget', message: VISITOR_CAP_MESSAGE });
    expect(l.take('someone', L).ok).toBe(true);
    expect(limitsFrom({ LLM_VISITOR_DAILY_SPEND_USD: '0.5' }).visitorDailySpendUsd).toBe(0.5);
  });
});

describe('every model route charges the visitor', () => {
  it('/api/llm', async () => {
    const who = ip();
    const res = await llm(req('/api/llm', who, { prompt: GOOD }));
    await res.text();
    expect(usageTodayBy(who).calls).toBeGreaterThan(0);
  });
  it('/api/agent/step', async () => {
    const who = ip();
    const res = await step(req('/api/agent/step', who, { prompt: GOOD }));
    await res.text();
    expect(usageTodayBy(who).calls).toBeGreaterThan(0);
  });
  it('agent step at /api/copilotkit, where Live builds run', async () => {
    const who = ip();
    const res = await copilot(req('/api/copilotkit/agent/step/run', who, runBody({ prompt: GOOD })));
    expect(res.status).toBe(200);
    await res.text();
    expect(usageTodayBy(who).calls).toBeGreaterThan(0);
  });
  it('a visitor over their share gets 429 budget on the next call', async () => {
    const who = ip();
    vi.stubEnv('LLM_VISITOR_DAILY_SPEND_USD', '1');
    chargeTo(who, () => call(1)); // the mock model costs nothing, so the spend is put in directly
    const res = await step(req('/api/agent/step', who, { prompt: GOOD }));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: 'budget', message: VISITOR_CAP_MESSAGE });
    expect((await step(req('/api/agent/step', ip(), { prompt: GOOD }))).status).toBe(200);
  });
});

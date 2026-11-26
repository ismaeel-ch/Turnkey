/**
 * The daily dollar cap, the per-role model mix and the repair loop working together, with a stand-in provider at the
 * network boundary and the real pieces in between: withUsage prices each call, spentToday() adds it up, the limiter
 * reads it, and the step graph asks the limiter before every attempt.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStepAgent } from '@/server/graph/step';
import { CAP_MESSAGE, createLimiter, limitsFrom } from '@/server/guard/limits';
import { recordUsage, resetUsageTotals, spentToday, usageTotals, withUsage } from '@/server/llm/usage';
import type { ChatChunk, ChatRequest, Provider } from '@/server/llm';
import { setLogSink } from '@/server/log';
import { POST as stepPOST } from '@/app/api/agent/step/route';
import { POST as teamPOST } from '@/app/api/agent/team/route';
import { factRequest } from './team/fixtures';

/** Answers every call with text that is not JSON, and reports `inputTokens` of usage. Records each request. */
function fakeGateway(inputTokens: number) {
  const requests: ChatRequest[] = [];
  const inner: Provider = {
    id: 'fake',
    model: (tier) => (tier === 'quick' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5'),
    async *stream(request): AsyncGenerator<ChatChunk> {
      requests.push(request);
      yield { type: 'delta', text: 'not json at all' };
      yield { type: 'done', truncated: false, usage: { input: inputTokens, output: 0 } };
    },
  };
  return { provider: withUsage(inner, { LLM_LOG_USAGE: '0' }), requests };
}

/** A step agent held to the real limiter, as the route builds it. */
function guardedAgent(provider: Provider, env: Record<string, string> = {}) {
  const limiter = createLimiter();
  const limits = limitsFrom(env);
  return createStepAgent({
    provider,
    admit: () => {
      const v = limiter.take('visitor', limits);
      return v.ok ? null : { code: v.code === 'off' ? 'not_configured' : v.code, message: v.message };
    },
  });
}

const PROMPT = 'You are the Researcher agent on Turnkey, a line of agents that builds small record-keeping web apps.\n\nREQUEST: "x"';

beforeEach(() => resetUsageTotals());
afterEach(() => {
  resetUsageTotals();
  vi.unstubAllEnvs();
});

describe('the dollar cap inside a repair loop', () => {
  it('stops a design role mid-loop once the day has cost the cap, and says what still works', async () => {
    // 1.5M input tokens on Sonnet 5.5 cost $3: attempt 1 brings the day to $3, attempt 2 to $6, so attempt 3 is refused
    const { provider, requests } = fakeGateway(1_500_000);
    const out = await guardedAgent(provider, { LLM_DAILY_SPEND_USD: '5' }).run({ prompt: PROMPT, role: 'research' });
    expect(requests.map((r) => r.tier)).toEqual(['default', 'default']);
    expect('error' in out && out.error).toMatchObject({ code: 'budget', message: CAP_MESSAGE, attempts: 2 });
    expect(spentToday()).toBeCloseTo(6, 6);
    expect(usageTotals({}).calls).toBe(2);
  });

  it('a role sent to the quick tier costs a fraction and gets all three attempts under the same cap', async () => {
    // the same tokens on Haiku 5.5 cost $0.15 a call
    const { provider, requests } = fakeGateway(1_500_000);
    const out = await guardedAgent(provider, { LLM_DAILY_SPEND_USD: '5' }).run({ prompt: PROMPT, role: 'views' });
    expect(requests.map((r) => r.tier)).toEqual(['quick', 'quick', 'quick']);
    expect('error' in out && out.error.code).toBe('invalid_output');
    expect(spentToday()).toBeCloseTo(0.45, 6);
  });

  it('LLM_QUICK_ROLES=none keeps the role on the default tier, and the cap then bites', async () => {
    vi.stubEnv('LLM_QUICK_ROLES', 'none');
    const { provider, requests } = fakeGateway(1_500_000);
    const out = await guardedAgent(provider, { LLM_DAILY_SPEND_USD: '5' }).run({ prompt: PROMPT, role: 'views' });
    expect(requests.map((r) => r.tier)).toEqual(['default', 'default']);
    expect('error' in out && out.error.code).toBe('budget');
  });

  it('a repair attempt counts toward the per-minute limit like the first call', async () => {
    const { provider, requests } = fakeGateway(10);
    const out = await guardedAgent(provider, { LLM_RATE_PER_MINUTE: '2' }).run({ prompt: PROMPT, role: 'research' });
    expect(requests).toHaveLength(2);
    expect('error' in out && out.error).toMatchObject({ code: 'rate_limited', attempts: 2 });
  });

  it('each repair sends back the first prompt, the failed answer and the reason, never a growing transcript', async () => {
    const { provider, requests } = fakeGateway(10);
    await guardedAgent(provider).run({ prompt: PROMPT, role: 'research' });
    expect(requests).toHaveLength(3);
    for (const r of requests.slice(1)) {
      expect(r.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
      expect(r.messages[0].content).toBe(PROMPT);
      expect(r.messages[1].content).toBe('not json at all');
    }
  });
});

// A prompt exactly as the workspace builds it, so the prompt policy lets it through.
const ROUTE_PROMPT =
  'You are the Researcher agent on Turnkey, a line of agents that builds small record-keeping web apps (tables, roles, one status workflow, screens) from one sentence. Code checks your answer and sends it back if it fails, so follow the format exactly. Reply with ONE JSON object and nothing else: no prose, no code fences.\n\nREQUEST: "a clinic"';

describe('model routes once the day has cost the cap', () => {
  let restore: () => void = () => {};
  beforeEach(() => {
    restore = setLogSink(() => {});
    vi.stubEnv('LLM_PROVIDER', 'mock');
    vi.stubEnv('LLM_DAILY_SPEND_USD', '1');
    // the day has already cost $1.20
    recordUsage(
      {
        provider: 'fake',
        model: 'claude-sonnet-5-5',
        tier: 'default',
        effort: 'medium',
        usage: { input: 1, output: 1, costUsd: 1.2 },
        ms: 1,
      },
      { LLM_LOG_USAGE: '0' },
    );
  });
  afterEach(() => restore());

  const request = (path: string, body: unknown, who: string) =>
    new Request('http://localhost' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': who },
      body: JSON.stringify(body),
    });

  it('/api/agent/step answers 429 budget before any model call', async () => {
    const res = await stepPOST(request('/api/agent/step', { prompt: ROUTE_PROMPT }, '192.0.2.10'));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: 'budget', message: CAP_MESSAGE });
    expect(usageTotals({}).calls).toBe(1);
  });

  it('/api/agent/team answers 429 budget before any model call', async () => {
    const res = await teamPOST(request('/api/agent/team', factRequest(), '192.0.2.11'));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: 'budget' });
    expect(usageTotals({}).calls).toBe(1);
  });

  it('the total starts again at midnight UTC, the same moment the limiter starts its day', () => {
    const midnight = Math.ceil((Date.now() + 1) / 86_400_000) * 86_400_000;
    expect(spentToday(midnight - 1)).toBeCloseTo(1.2, 6);
    expect(spentToday(midnight)).toBe(0);
  });
});

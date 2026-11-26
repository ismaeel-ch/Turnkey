import { describe, expect, it } from 'vitest';
import { deriveActivity, type RawAgentEvent } from '@/platform/agui/activity';
import { addUsage, cacheRate, emptyUsage, fmtTokens, fmtUsd, readCallUsage, usageLine } from '@/platform/agui/usage';

const call = (over: Record<string, unknown> = {}) => ({
  model: 'claude-sonnet-5-5',
  tier: 'default',
  input: 800,
  output: 200,
  cacheRead: 3000,
  cacheWrite: 200,
  costUsd: 0.0042,
  ms: 1200,
  estimated: false,
  ...over,
});

describe('readCallUsage', () => {
  it('reads a well-formed event value', () => {
    expect(readCallUsage(call())).toEqual(call());
  });
  it('refuses what is not a usage value and cleans bad numbers', () => {
    expect(readCallUsage(null)).toBeNull();
    expect(readCallUsage([1])).toBeNull();
    expect(readCallUsage({ input: 3 })).toBeNull();
    expect(readCallUsage(call({ input: -5, output: 'x', costUsd: Infinity, tier: 'odd' }))).toMatchObject({
      input: 0,
      output: 0,
      costUsd: null,
      tier: 'default',
    });
  });
});

describe('adding up and wording', () => {
  it('sums calls, keeps unpriced calls out of the cost, and words the result', () => {
    const sum = emptyUsage();
    addUsage(sum, readCallUsage(call())!);
    addUsage(sum, readCallUsage(call({ costUsd: null, estimated: true }))!);
    expect(sum).toMatchObject({ calls: 2, input: 1600, output: 400, cacheRead: 6000, costUsd: 0.0042, unpriced: 1, estimated: 1 });
    expect(cacheRate(sum)).toBeCloseTo(0.75);
    expect(usageLine(sum)).toBe('8.4k tokens · 75% from cache · ~$0.0042');
  });
  it('formats dollars and tokens briefly', () => {
    expect(fmtUsd(0)).toBe('$0');
    expect(fmtUsd(0.00423)).toBe('$0.0042');
    expect(fmtUsd(0.125)).toBe('$0.13');
    expect(fmtUsd(0.1)).toBe('$0.10');
    expect(fmtUsd(0.0421)).toBe('$0.042');
    expect(fmtUsd(3.4)).toBe('$3.40');
    expect(fmtTokens(820)).toBe('820');
    expect(fmtTokens(12400)).toBe('12k');
    expect(fmtTokens(1500)).toBe('1.5k');
    expect(fmtTokens(1_200_000)).toBe('1.2M');
    expect(cacheRate(emptyUsage())).toBeNull();
  });
});

describe('deriveActivity usage', () => {
  it('adds each usage event to its agent and to the total, and shows it in the feed', () => {
    const ev = (type: string, extra: Record<string, unknown>): RawAgentEvent => ({ type, server: true, app: 'a1', ...extra });
    const model = deriveActivity([
      ev('RUN_STARTED', { agent: 'database', runId: 'r1' }),
      ev('CUSTOM', { agent: 'database', runId: 'r1', name: 'usage', value: call() }),
      ev('CUSTOM', { agent: 'database', runId: 'r1', name: 'usage', value: call({ costUsd: 0.001 }) }),
      ev('CUSTOM', { agent: 'backend', runId: 'r2', name: 'usage', value: call({ costUsd: 0.002 }) }),
      ev('CUSTOM', { agent: 'backend', runId: 'r2', name: 'usage', value: { nonsense: true } }),
    ]);
    expect(model.agents.database.usage).toMatchObject({ calls: 2, costUsd: 0.0052 });
    expect(model.agents.backend.usage).toMatchObject({ calls: 1, costUsd: 0.002 });
    expect(model.usage.calls).toBe(3);
    expect(model.usage.costUsd).toBeCloseTo(0.0072);
    expect(model.items.filter((i) => i.kind === 'usage')).toHaveLength(3);
  });
});

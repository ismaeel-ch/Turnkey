import { describe, expect, it } from 'vitest';
import { modelGoneForToday, modelOutage, modelProblem, parseApiError } from '@/shared/api-error';

describe('parseApiError', () => {
  it('reads the uniform error body and keeps unknown codes', () => {
    expect(parseApiError({ code: 'internal', message: 'x', requestId: 'r1' })).toEqual({ code: 'internal', message: 'x', requestId: 'r1' });
    expect(parseApiError({ code: 'something_new', message: 'y' })).toEqual({ code: 'something_new', message: 'y' });
  });
  it('refuses values that are not error bodies', () => {
    expect(parseApiError(null)).toBeNull();
    expect(parseApiError({ message: 'no code' })).toBeNull();
    expect(parseApiError('text')).toBeNull();
  });
});

describe('modelProblem', () => {
  it('says plainly when no model is connected', () => {
    for (const code of ['not_granted', 'not_configured', 'unauthorized']) expect(modelProblem(code)).toContain('No model is connected');
  });
  it('says when the allowance is used up and when to wait', () => {
    expect(modelProblem('budget')).toContain('allowance');
    expect(modelProblem('spend_cap')).toContain('allowance');
    expect(modelProblem('rate_limited')).toContain('Wait a minute');
  });
  it("tells one visitor's share apart from the whole day's allowance, and points to Demo either way", () => {
    const mine = modelProblem('budget', { detail: "You have used your share of today's live model calls" });
    const all = modelProblem('budget', { detail: "Today's allowance for live model calls is used up" });
    expect(mine).toContain('your share');
    expect(all).not.toContain('your share');
    for (const t of [mine, all]) expect(t).toMatch(/midnight UTC.*Demo/);
  });
  it('says the model is busy or down in plain words, with no service text', () => {
    expect(modelProblem('rate_limited')).toContain('busy');
    expect(modelProblem('upstream', { detail: 'the model gateway answered 529: overloaded' })).not.toContain('529');
  });
  it('puts being offline first, and keeps the detail of anything else', () => {
    expect(modelProblem('rate_limited', { offline: true })).toContain('back online');
    expect(modelProblem('invalid_output', { detail: 'the answer was not valid JSON' })).toBe(
      'The model call failed: the answer was not valid JSON',
    );
  });
});

describe('modelOutage and modelGoneForToday', () => {
  it('offer Demo when the model cannot be used, and drop Run again only when it cannot help today', () => {
    for (const c of ['budget', 'rate_limited', 'upstream', 'network', 'not_granted']) expect(modelOutage(c)).toBe(true);
    for (const c of [undefined, '', 'invalid_output', 'aborted']) expect(modelOutage(c)).toBe(false);
    expect(modelGoneForToday('budget')).toBe(true);
    expect(modelGoneForToday('not_granted')).toBe(true);
    expect(modelGoneForToday('rate_limited')).toBe(false);
    expect(modelGoneForToday('network')).toBe(false);
  });
});

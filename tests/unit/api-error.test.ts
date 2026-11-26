import { describe, expect, it } from 'vitest';
import { modelProblem, parseApiError } from '@/shared/api-error';

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
  it('puts being offline first, and keeps the detail of anything else', () => {
    expect(modelProblem('rate_limited', { offline: true })).toContain('back online');
    expect(modelProblem('upstream', { detail: 'the gateway answered 502' })).toBe('The model call failed: the gateway answered 502');
  });
});

import { describe, expect, it } from 'vitest';
import { createShareQuota, shareQuotaFrom } from '@/server/share/quota';

describe('share quota', () => {
  it('has defaults and reads the environment', () => {
    expect(shareQuotaFrom({})).toEqual({ saves: 300, perVisitor: 30, bytes: 100_000_000 });
    expect(shareQuotaFrom({ SHARE_DAILY_SAVES: '5', SHARE_SAVES_PER_DAY: '2', SHARE_DAILY_MB: '1' })).toEqual({
      saves: 5,
      perVisitor: 2,
      bytes: 1_000_000,
    });
  });

  it('limits one visitor, everyone, and the bytes saved, and starts again the next day', () => {
    let t = Date.parse('2026-11-27T10:00:00Z');
    const q = createShareQuota(() => t);
    const L = { saves: 3, perVisitor: 2, bytes: 1000 };
    expect(q.take('a', 10, L).ok).toBe(true);
    expect(q.take('a', 10, L).ok).toBe(true);
    expect(q.take('a', 10, L)).toMatchObject({ ok: false, message: expect.stringContaining('many short links') });
    expect(q.take('b', 10, L).ok).toBe(true);
    expect(q.take('c', 10, L)).toMatchObject({ ok: false, message: expect.stringContaining('limit for today') });
    t += 86_400_000;
    expect(q.take('c', 2000, L).ok).toBe(false);
    expect(q.take('c', 900, L).ok).toBe(true);
    expect(q.take('d', 200, L).ok).toBe(false);
  });
});

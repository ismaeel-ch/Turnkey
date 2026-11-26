/**
 * Spend protection for the model route.
 *
 * The app is public and has no login, and the model budget is small and does not refill. These limits keep one
 * visitor, or one loop, from using it up. Counters live in memory: a serverless instance keeps them while it is
 * warm, so they are a brake, not an exact meter. The gateway's own budget is the hard stop.
 *
 *   LLM_RATE_PER_MINUTE     calls per visitor per minute            (default 20)
 *   LLM_GLOBAL_PER_MINUTE   calls from everyone per minute          (default 50; the gateway allows 60)
 *   LLM_DAILY_CALL_CAP      calls from everyone per day             (default 600)
 *   LLM_MAX_PROMPT_CHARS    longest prompt accepted                 (default 120000)
 *   LLM_MAX_OUTPUT_TOKENS   most tokens one answer may use          (default 8000)
 *   LIVE_MODE               set to `off` to refuse every model call (saved builds keep working)
 */
type Env = Record<string, string | undefined>;

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function limitsFrom(env: Env = process.env) {
  return {
    perMinute: num(env.LLM_RATE_PER_MINUTE, 20),
    globalPerMinute: num(env.LLM_GLOBAL_PER_MINUTE, 50),
    dailyCap: num(env.LLM_DAILY_CALL_CAP, 600),
    maxPromptChars: num(env.LLM_MAX_PROMPT_CHARS, 120000),
    maxOutputTokens: num(env.LLM_MAX_OUTPUT_TOKENS, 8000),
    off: (env.LIVE_MODE || '').trim().toLowerCase() === 'off',
  };
}

export type Verdict = { ok: true } | { ok: false; code: 'rate_limited' | 'budget' | 'off'; message: string; retryAfter?: number };

type Window = { start: number; count: number };

export function createLimiter(now: () => number = Date.now) {
  const visitors = new Map<string, Window>();
  let minute: Window = { start: 0, count: 0 };
  let day: Window = { start: 0, count: 0 };

  const roll = (w: Window, span: number, t: number) => (t - w.start >= span ? { start: t, count: 0 } : w);

  return {
    /** Counts one call for `who` and says whether it may go ahead. */
    take(who: string, limits = limitsFrom()): Verdict {
      if (limits.off)
        return { ok: false, code: 'off', message: 'Live builds are switched off on this deployment. Saved builds still run.' };
      const t = now();
      day = roll(day, 86_400_000, t);
      if (day.count >= limits.dailyCap)
        return { ok: false, code: 'budget', message: "Today's allowance for live model calls is used up. Saved builds still run." };
      minute = roll(minute, 60_000, t);
      const retryAfter = Math.ceil((60_000 - (t - minute.start)) / 1000);
      if (minute.count >= limits.globalPerMinute)
        return { ok: false, code: 'rate_limited', message: 'Many builds are running right now.', retryAfter };
      const mine = roll(visitors.get(who) ?? { start: 0, count: 0 }, 60_000, t);
      if (mine.count >= limits.perMinute) {
        visitors.set(who, mine);
        return {
          ok: false,
          code: 'rate_limited',
          message: 'Too many model calls in one minute.',
          retryAfter: Math.ceil((60_000 - (t - mine.start)) / 1000),
        };
      }
      mine.count++;
      minute.count++;
      day.count++;
      visitors.set(who, mine);
      if (visitors.size > 5000) for (const [k, w] of visitors) if (t - w.start >= 60_000) visitors.delete(k);
      return { ok: true };
    },
    usage: () => ({ today: day.count, thisMinute: minute.count }),
  };
}

/** One limiter per server instance. */
export const limiter = createLimiter();

export function visitorOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return (forwarded ? forwarded.split(',')[0] : request.headers.get('x-real-ip') || 'local').trim();
}

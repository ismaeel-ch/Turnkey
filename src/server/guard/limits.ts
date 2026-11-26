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
 *   LLM_MAX_ANSWER_CHARS    longest answer relayed, in characters   (default 4 x the output token cap)
 *   LIGHT_RATE_PER_MINUTE   cheap routes (connectors, health) per visitor per minute   (default 60)
 *   LIGHT_GLOBAL_PER_MINUTE the same, from everyone                  (default 600)
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
    maxAnswerChars: num(env.LLM_MAX_ANSWER_CHARS, num(env.LLM_MAX_OUTPUT_TOKENS, 8000) * 4),
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
    /**
     * Counts `weight` calls for `who` (one request that may make several model calls, such as a tool loop, counts as
     * all of them up front) and says whether it may go ahead.
     */
    take(who: string, limits = limitsFrom(), weight = 1): Verdict {
      const w = Math.max(1, Math.floor(weight));
      if (limits.off)
        return { ok: false, code: 'off', message: 'Live builds are switched off on this deployment. Saved builds still run.' };
      const t = now();
      day = roll(day, 86_400_000, t);
      if (day.count + w > limits.dailyCap)
        return { ok: false, code: 'budget', message: "Today's allowance for live model calls is used up. Saved builds still run." };
      minute = roll(minute, 60_000, t);
      const retryAfter = Math.ceil((60_000 - (t - minute.start)) / 1000);
      if (minute.count + w > limits.globalPerMinute)
        return { ok: false, code: 'rate_limited', message: 'Many builds are running right now.', retryAfter };
      const mine = roll(visitors.get(who) ?? { start: 0, count: 0 }, 60_000, t);
      if (mine.count + w > limits.perMinute) {
        visitors.set(who, mine);
        return {
          ok: false,
          code: 'rate_limited',
          message: 'Too many model calls in one minute.',
          retryAfter: Math.ceil((60_000 - (t - mine.start)) / 1000),
        };
      }
      mine.count += w;
      minute.count += w;
      day.count += w;
      visitors.set(who, mine);
      if (visitors.size > 5000) for (const [k, w] of visitors) if (t - w.start >= 60_000) visitors.delete(k);
      return { ok: true };
    },
    usage: () => ({ today: day.count, thisMinute: minute.count }),
  };
}

/** One limiter per server instance. */
export const limiter = createLimiter();

/**
 * Routes that cost no model budget (public-data connectors, health) have their own, looser counters, so they can
 * neither use up the model allowance nor be hammered without end. LIVE_MODE=off does not apply to them.
 */
export function lightLimitsFrom(env: Env = process.env) {
  const base = limitsFrom(env);
  return {
    ...base,
    perMinute: num(env.LIGHT_RATE_PER_MINUTE, 60),
    globalPerMinute: num(env.LIGHT_GLOBAL_PER_MINUTE, 600),
    dailyCap: 1_000_000,
    off: false,
  };
}
export const lightLimiter = createLimiter();

export function visitorOf(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return (forwarded ? forwarded.split(',')[0] : request.headers.get('x-real-ip') || 'local').trim();
}

/** Stops a streamed answer at the size limit. Feed it each chunk; it says how much of the chunk may be sent. */
export function answerMeter(maxChars: number) {
  let sent = 0;
  return {
    /** The part of `text` that fits. `done` is true once the limit is reached. */
    take(text: string): { text: string; done: boolean } {
      const room = Math.max(0, maxChars - sent);
      const part = text.length > room ? text.slice(0, room) : text;
      sent += part.length;
      return { text: part, done: sent >= maxChars };
    },
  };
}

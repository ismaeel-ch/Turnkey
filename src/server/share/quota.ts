/**
 * Daily limits on saving short links, so a script cannot fill the free Blob store or take every common short name.
 * The per-minute limit in the route stops bursts; these stop a slow, steady stream. Counters live in this server
 * instance's memory and start again at midnight UTC.
 *
 *   SHARE_DAILY_SAVES       saves from everyone per day           (default 300)
 *   SHARE_SAVES_PER_DAY     saves from one visitor per day        (default 30)
 *   SHARE_DAILY_MB          megabytes of share codes saved per day (default 100)
 */
type Env = Record<string, string | undefined>;

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function shareQuotaFrom(env: Env = process.env) {
  return {
    saves: num(env.SHARE_DAILY_SAVES, 300),
    perVisitor: num(env.SHARE_SAVES_PER_DAY, 30),
    bytes: num(env.SHARE_DAILY_MB, 100) * 1_000_000,
  };
}

export type QuotaVerdict = { ok: true } | { ok: false; message: string };

export function createShareQuota(now: () => number = Date.now) {
  let day = '';
  let saves = 0;
  let bytes = 0;
  let visitors = new Map<string, number>();
  const roll = () => {
    const d = new Date(now()).toISOString().slice(0, 10);
    if (d !== day) {
      day = d;
      saves = 0;
      bytes = 0;
      visitors = new Map();
    }
  };
  return {
    /** Counts one save of `size` bytes for `who`, or says why it may not go ahead. */
    take(who: string, size: number, q = shareQuotaFrom()): QuotaVerdict {
      roll();
      if (saves >= q.saves || bytes + size > q.bytes)
        return { ok: false, message: 'Short links have reached their limit for today. The long link works.' };
      const mine = visitors.get(who) ?? 0;
      if (mine >= q.perVisitor) return { ok: false, message: 'You have made many short links today. The long link works.' };
      saves++;
      bytes += size;
      visitors.set(who, mine + 1);
      if (visitors.size > 20_000) visitors.clear(); // a flood of forged addresses must not grow memory without end
      return { ok: true };
    },
    /**
     * Gives back one save that `take` counted but that wrote nothing (the store was down, the token was wrong, every
     * name was taken), so a short outage does not use up the day's allowance. Only within the same day.
     */
    refund(who: string, size: number) {
      roll();
      const mine = visitors.get(who) ?? 0;
      if (saves <= 0 || mine <= 0) return;
      saves--;
      bytes = Math.max(0, bytes - size);
      if (mine === 1) visitors.delete(who);
      else visitors.set(who, mine - 1);
    },
  };
}

/** One quota per server instance. */
export const shareQuota = createShareQuota();

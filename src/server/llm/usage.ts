/**
 * Token and cost logging for every model call, so the $25 budget stays visible. Server only.
 *
 * `withUsage(provider)` wraps a provider: when a call ends it fills in `usage.costUsd` (from the price table when the
 * provider did not report a cost), logs one line, and adds the call to running totals that `/api/health` shows.
 *
 * The line is a structured `model_call` event (src/server/log.ts) with the provider, model, tier, effort, token
 * counts, cache hits, cost and time. Never the prompt, the answer, a key or an address. A caller that passes its own
 * `log` gets the short text form instead:
 *
 *   [llm] litellm claude-sonnet-5-5 default/medium in=812 out=240 cache_read=3100 cache_write=0 $0.004290 1820ms
 *
 *   LLM_LOG_USAGE   `0` turns the line off (the totals still count). Off by default under vitest.
 *   LLM_BUDGET_USD  the budget shown next to the totals (default 25, the hackathon's).
 *
 * A call that stops before the provider reports its usage (the visitor left, or the answer hit the size limit) is
 * still paid for, so it is counted from an estimate: about four characters to a token, for the prompt and for the
 * text that came back. So is a call whose provider finished without reporting usage at all.
 *
 * The totals live in this server instance's memory: on Vercel each instance counts its own calls since it started.
 * `spentToday()` is what src/server/guard/limits.ts checks against LLM_DAILY_SPEND_USD.
 */
import { log as serverLog, noteModelCall } from '../log';
import { costOf, effortFor } from './features';
import type { ChatChunk, ChatRequest, Provider, Usage } from './types';

type Env = Record<string, string | undefined>;

export type UsageTotals = {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
  /** Calls whose cost could not be worked out (a model missing from the price table). */
  unpriced: number;
  budgetUsd: number;
  since: string;
};

export type UsageRecord = {
  provider: string;
  model: string;
  tier: ChatRequest['tier'];
  effort: string;
  usage: Usage;
  ms: number;
};

const fresh = () => ({
  calls: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costUsd: 0,
  unpriced: 0,
  since: new Date().toISOString(),
});
let totals = fresh();
/** Cost of this instance's calls since midnight UTC. */
let today = { day: '', costUsd: 0 };
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);

export function resetUsageTotals() {
  totals = fresh();
  today = { day: '', costUsd: 0 };
}

/** Dollars this server instance has spent on model calls since midnight UTC. */
export function spentToday(now: number = Date.now()): number {
  return today.day === dayOf(now) ? today.costUsd : 0;
}

/** Tokens of a call that ended before the provider said, from the text sizes: about four characters to a token. */
export function estimateUsage(request: ChatRequest, outputChars: number): Usage {
  const inputChars = request.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  return { input: Math.ceil(inputChars / 4), output: Math.ceil(outputChars / 4) };
}

export function usageTotals(env: Env = process.env): UsageTotals {
  const budget = Number(env.LLM_BUDGET_USD);
  return {
    ...totals,
    costUsd: Math.round(totals.costUsd * 1e6) / 1e6,
    budgetUsd: Number.isFinite(budget) && budget > 0 ? budget : 25,
  };
}

/** One log line. Exported for tests. */
export function usageLine(r: UsageRecord): string {
  const u = r.usage;
  return (
    `[llm] ${r.provider} ${r.model} ${r.tier}/${r.effort} in=${u.input ?? 0} out=${u.output ?? 0} ` +
    `cache_read=${u.cacheRead ?? 0} cache_write=${u.cacheWrite ?? 0} ` +
    (u.costUsd === undefined ? '$?' : '$' + u.costUsd.toFixed(6)) +
    ` ${r.ms}ms`
  );
}

function shouldLog(env: Env): boolean {
  if (env.LLM_LOG_USAGE !== undefined) return env.LLM_LOG_USAGE.trim() !== '0';
  return !env.VITEST;
}

/** Adds one finished call to the totals and logs it. */
export function recordUsage(r: UsageRecord, env: Env = process.env, log?: (line: string) => void) {
  noteModelCall(r.usage); // the request's own log line (src/server/log.ts) carries its calls' tokens and cost
  totals.calls += 1;
  totals.input += r.usage.input ?? 0;
  totals.output += r.usage.output ?? 0;
  totals.cacheRead += r.usage.cacheRead ?? 0;
  totals.cacheWrite += r.usage.cacheWrite ?? 0;
  if (r.usage.costUsd === undefined) totals.unpriced += 1;
  else {
    totals.costUsd += r.usage.costUsd;
    const day = dayOf(Date.now());
    if (today.day !== day) today = { day, costUsd: 0 };
    today.costUsd += r.usage.costUsd;
  }
  if (!shouldLog(env)) return;
  if (log) log(usageLine(r));
  else
    serverLog('info', 'model_call', {
      provider: r.provider,
      model: r.model,
      tier: r.tier,
      effort: r.effort,
      inputTokens: r.usage.input ?? 0,
      outputTokens: r.usage.output ?? 0,
      cacheReadTokens: r.usage.cacheRead ?? 0,
      cacheWriteTokens: r.usage.cacheWrite ?? 0,
      costUsd: r.usage.costUsd ?? null,
      ms: r.ms,
    });
}

/** Wraps a provider so every call that ends is priced, logged and counted. Keeps every property the gateway reads. */
export function withUsage(inner: Provider, env: Env = process.env, log?: (line: string) => void): Provider {
  return {
    id: inner.id,
    fixedToolMode: inner.fixedToolMode,
    nativeTools: inner.nativeTools,
    model: (tier) => inner.model(tier),
    async *stream(request: ChatRequest): AsyncGenerator<ChatChunk> {
      const started = Date.now();
      const model = inner.model(request.tier);
      let settled = false;
      let outChars = 0;
      let failed = false;
      try {
        for await (const chunk of inner.stream(request)) {
          if (chunk.type !== 'done') {
            if (chunk.type === 'delta') outChars += chunk.text.length;
            else outChars += JSON.stringify(chunk.call.args ?? '').length + chunk.call.name.length;
            yield chunk;
            continue;
          }
          settled = true;
          // A gateway that leaves usage out of its stream still bills the call: estimate it, as for a call cut short,
          // so the daily dollar cap does not go blind.
          const usage: Usage = chunk.usage ? { ...chunk.usage } : estimateUsage(request, outChars);
          if (usage.costUsd === undefined) {
            const cost = costOf(model, usage);
            if (cost !== null) usage.costUsd = cost;
          }
          recordUsage(
            { provider: inner.id, model, tier: request.tier, effort: effortFor(request), usage, ms: Date.now() - started },
            env,
            log,
          );
          yield { ...chunk, usage: chunk.usage ? usage : undefined };
        }
      } catch (e) {
        failed = true;
        throw e;
      } finally {
        // Stopped early (the caller left the loop, the visitor went away, or the call failed): the tokens sent and
        // received so far are still billed, so they are counted from an estimate.
        // A call that failed before any answer came back is not billed, so it is not counted.
        if (!settled && (!failed || outChars > 0)) {
          const usage = estimateUsage(request, outChars);
          const cost = costOf(model, usage);
          if (cost !== null) usage.costUsd = cost;
          recordUsage(
            { provider: inner.id, model, tier: request.tier, effort: effortFor(request), usage, ms: Date.now() - started },
            env,
            log,
          );
        }
      }
    },
  };
}

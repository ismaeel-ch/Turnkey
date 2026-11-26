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
 * The totals live in this server instance's memory: on Vercel each instance counts its own calls since it started.
 * They are for watching spend, not for enforcing it (src/server/guard does that).
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

export function resetUsageTotals() {
  totals = fresh();
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
  else totals.costUsd += r.usage.costUsd;
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
      for await (const chunk of inner.stream(request)) {
        if (chunk.type !== 'done') {
          yield chunk;
          continue;
        }
        const usage: Usage = { ...chunk.usage };
        if (usage.costUsd === undefined) {
          const cost = costOf(model, usage);
          if (cost !== null && chunk.usage) usage.costUsd = cost;
        }
        recordUsage(
          { provider: inner.id, model, tier: request.tier, effort: effortFor(request), usage, ms: Date.now() - started },
          env,
          log,
        );
        yield { ...chunk, usage: chunk.usage ? usage : undefined };
      }
    },
  };
}

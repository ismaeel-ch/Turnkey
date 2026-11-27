/**
 * What model calls cost, as the browser sees it. Every agent run on the server ends each model call with a CUSTOM
 * `usage` AG-UI event (src/server/llm/usage.ts `CallUsage`); this file reads those events, adds them up and words them.
 *
 * Pure and browser-safe: no React, nothing from src/server.
 */
import type { UsageSum } from '@/shared/types/workspace';

export type { UsageSum };

/** One model call: the model, its tokens, cache hits and cost. `costUsd` is null when the server could not price it. */
export interface CallUsage {
  model: string;
  tier: 'default' | 'quick';
  /** Prompt tokens read fresh (not from the cache). */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number | null;
  ms: number;
  /** The call stopped before the provider reported its usage, so the tokens are an estimate. */
  estimated: boolean;
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

/** Reads the value of a CUSTOM `usage` event. Anything that is not the right shape gives null. */
export function readCallUsage(v: unknown): CallUsage | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.model !== 'string' || !o.model) return null;
  const cost = typeof o.costUsd === 'number' && Number.isFinite(o.costUsd) && o.costUsd >= 0 ? o.costUsd : null;
  return {
    model: o.model.slice(0, 80),
    tier: o.tier === 'quick' ? 'quick' : 'default',
    input: count(o.input),
    output: count(o.output),
    cacheRead: count(o.cacheRead),
    cacheWrite: count(o.cacheWrite),
    costUsd: cost,
    ms: count(o.ms),
    estimated: o.estimated === true,
  };
}

export const emptyUsage = (): UsageSum => ({
  calls: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  costUsd: 0,
  unpriced: 0,
  estimated: 0,
});

/** Adds one call to a sum, in place, and returns the sum. */
export function addUsage(sum: UsageSum, call: CallUsage): UsageSum {
  sum.calls += 1;
  sum.input += call.input;
  sum.output += call.output;
  sum.cacheRead += call.cacheRead;
  sum.cacheWrite += call.cacheWrite;
  if (call.costUsd === null) sum.unpriced += 1;
  else sum.costUsd += call.costUsd;
  if (call.estimated) sum.estimated += 1;
  return sum;
}

/** Every prompt token, fresh or from the cache. */
export const promptTokens = (u: Pick<UsageSum, 'input' | 'cacheRead' | 'cacheWrite'>): number => u.input + u.cacheRead + u.cacheWrite;

/** Share of prompt tokens read from the cache, 0 to 1. Null when there were none. */
export function cacheRate(u: Pick<UsageSum, 'input' | 'cacheRead' | 'cacheWrite'>): number | null {
  const all = promptTokens(u);
  return all > 0 ? u.cacheRead / all : null;
}

/** Dollars, briefly: $0.0042, $0.042, $0.12, $3.40. */
export function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0';
  if (n >= 0.1) return '$' + n.toFixed(2);
  if (n >= 0.01) return '$' + n.toFixed(3);
  return '$' + n.toPrecision(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** Token counts: 820, 12.4k, 1.2M. */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'k';
  return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
}

/** "12.4k tokens · 63% from cache · $0.0042", the parts that apply. Calls the server could not price are named. */
export function usageLine(u: UsageSum): string {
  const parts = [fmtTokens(promptTokens(u) + u.output) + ' tokens'];
  const rate = cacheRate(u);
  if (rate !== null && u.cacheRead > 0) parts.push(Math.round(rate * 100) + '% from cache');
  parts.push((u.estimated ? '~' : '') + fmtUsd(u.costUsd));
  if (u.unpriced > 0) parts.push(u.unpriced + (u.unpriced === 1 ? ' call' : ' calls') + ' not priced');
  return parts.join(' · ');
}

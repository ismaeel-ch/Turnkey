/**
 * The Claude features the gateway uses, in one place. Server only.
 *
 * - Effort per tier: `default` (planning and building) thinks at `medium`, `quick` (fast steps, validators) at `low`.
 *   A caller may ask for another level on one request (`ChatRequest.effort`), for example `high` for the planner.
 * - Prompt caching: the stable start of the prompt (system prompt, tool list) is marked so the provider caches it.
 * - No sampling settings: `temperature`, `top_p` and `top_k` are never sent (current Claude models refuse them).
 * - Tools are always `auto`: Opus 5.5 and Sonnet 5.5 refuse a forced tool choice, so "you must call a tool" is said
 *   in the system prompt instead.
 * - Prices per model, so every call's cost can be logged against the $25 budget.
 */
import type { ChatMessage, ChatRequest, Effort, Tier, Usage } from './types';

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/** How hard each tier thinks unless the request says otherwise. */
export const EFFORT_BY_TIER: Record<Tier, Effort> = { default: 'medium', quick: 'low' };

export const isEffort = (v: unknown): v is Effort => typeof v === 'string' && (EFFORTS as readonly string[]).includes(v);

/** The effort for one request: its own, else its tier's. */
export function effortFor(request: Pick<ChatRequest, 'tier' | 'effort'>): Effort {
  return isEffort(request.effort) ? request.effort : (EFFORT_BY_TIER[request.tier] ?? 'medium');
}

/**
 * Is this a Claude model name? Gateways name them in several ways: `claude-sonnet-5-5`, `anthropic/claude-haiku`,
 * `us.anthropic.claude-opus-5-5`, or the bare aliases the Claude Code command takes (`sonnet`, `haiku`, `opus`).
 */
export function isClaudeModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  return /claude|anthropic/.test(m) || /^(sonnet|haiku|opus|fable)(\b|$)/.test(m);
}

/** Said in the system prompt when a caller needs a tool call: the tool choice itself stays `auto`. */
export const MUST_CALL_A_TOOL = 'You must answer by calling one of the tools. Do not answer in plain text.';

/** Adds the "must call a tool" line to the system prompt when the request asked for `required`. */
export function withRequiredNote(messages: ChatMessage[], choice: ChatRequest['toolChoice']): ChatMessage[] {
  if (choice !== 'required') return messages;
  const at = messages.findIndex((m) => m.role === 'system');
  if (at < 0) return [{ role: 'system', content: MUST_CALL_A_TOOL }, ...messages];
  const out = messages.slice();
  out[at] = { ...out[at], content: out[at].content + '\n\n' + MUST_CALL_A_TOOL };
  return out;
}

/** US dollars per million tokens. Cache writes are priced at the 5-minute rate (1.25x input). */
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };

const price = (input: number, output: number, cacheRead: number): Price => ({ input, output, cacheRead, cacheWrite: input * 1.25 });

/** Checked in order: the first pattern that matches the model name wins. Bare family names mean the current model. */
const PRICES: [RegExp, Price][] = [
  [/fable-5-2|fable$/, price(8, 40, 0.2)],
  [/fable/, price(10, 50, 1)],
  [/opus-5-5|^opus$|claude-opus$/, price(4, 20, 0.2)],
  [/opus/, price(5, 25, 0.5)],
  [/sonnet-5-5|^sonnet$|claude-sonnet$/, price(2, 10, 0.1)],
  [/sonnet-5/, price(2, 10, 0.2)],
  [/sonnet/, price(3, 15, 0.3)],
  [/haiku-5-5|^haiku$|claude-haiku$/, price(0.1, 0.5, 0.01)],
  [/haiku/, price(1, 5, 0.1)],
];

/** The price of a model, or null when it is not a Claude model this table knows. */
export function priceOf(model: string): Price | null {
  const m = model
    .trim()
    .toLowerCase()
    .replace(/^.*[/.](?=claude)/, ''); // `anthropic/claude-…`, `us.anthropic.claude-…`
  for (const [pattern, p] of PRICES) if (pattern.test(m)) return p;
  return null;
}

/**
 * The price the daily dollar cap assumes for a model missing from the table: the dearest one listed, so a model nobody
 * priced can only make the cap stop early, never late.
 */
export const FALLBACK_PRICE: Price = price(10, 50, 1);

/** What one call cost in US dollars, from its token counts. Null when the model's price is not known. */
export function costOf(model: string, usage: Usage | undefined): number | null {
  if (!usage) return null;
  const p = priceOf(model);
  return p ? priced(p, usage) : null;
}

/** What the daily dollar cap counts for a call of a model with no listed price: its tokens at FALLBACK_PRICE. */
export function fallbackCostOf(usage: Usage | undefined): number {
  return usage ? priced(FALLBACK_PRICE, usage) : 0;
}

function priced(p: Price, usage: Usage): number {
  const usd =
    ((usage.input ?? 0) * p.input +
      (usage.output ?? 0) * p.output +
      (usage.cacheRead ?? 0) * p.cacheRead +
      (usage.cacheWrite ?? 0) * p.cacheWrite) /
    1_000_000;
  return Math.round(usd * 1e8) / 1e8;
}

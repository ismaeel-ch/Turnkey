/**
 * A real run on the Claude Code command, skipped unless asked for: it spends a little real money.
 *
 *   LLM_LIVE=1 npx vitest run tests/unit/llm-live.test.ts
 *
 * Two calls with the same long system prompt on the quick tier. The second must read the prompt from the cache.
 * Prints the usage line of each call (tokens, cache, cost) and nothing of the prompt or the answer.
 */
import { describe, expect, it } from 'vitest';
import { complete } from '@/server/llm';
import { onPath } from '@/server/llm/local';
import { claudeCode } from '@/server/llm/providers/claude-code';
import { resetUsageTotals, usageTotals, withUsage } from '@/server/llm/usage';

const live = process.env.LLM_LIVE === '1' && onPath('claude', process.env);

// A stable prompt long enough to be cached (well above the smallest cacheable prefix). Made-up rules only.
const RULES = Array.from(
  { length: 200 },
  (_, i) => `Rule ${i + 1}: every table name is plural snake_case, and every column has a type and a short plain description.`,
).join('\n');

describe.skipIf(!live)('Claude Code command, for real', () => {
  it('reads the stable system prompt from the cache on the second call', { timeout: 240_000 }, async () => {
    resetUsageTotals();
    const run = Date.now().toString(36); // a fresh prefix, so the first call writes the cache and the second reads it
    const lines: string[] = [];
    const provider = withUsage(claudeCode({ model: 'sonnet', quickModel: 'haiku' }), { LLM_LOG_USAGE: '1' }, (l) => {
      lines.push(l);
      console.info(l);
    });
    const ask = (q: string) =>
      complete(provider, {
        tier: 'quick',
        messages: [
          { role: 'system', content: `Run ${run}. You are the schema agent of an app builder. Answer in one short sentence.\n` + RULES },
          { role: 'user', content: q },
        ],
      });
    const first = await ask('Name one table for a clinic app.');
    const second = await ask('Name one table for a library app.');
    expect(first.text.length).toBeGreaterThan(0);
    expect(first.usage?.cacheWrite ?? 0).toBeGreaterThan(1000);
    expect(second.usage?.cacheRead ?? 0).toBeGreaterThan((first.usage?.cacheRead ?? 0) + 1000);
    expect(lines).toHaveLength(2);
    expect(usageTotals().costUsd).toBeGreaterThan(0);
  });
});

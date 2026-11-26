// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { createStepAgent } from '@/server/graph/step';
import { resolveProvider } from '@/server/llm';
import { startLine } from './helpers/workspace-line';

// The browser loads sql.js as a script from /vendor; here it comes straight from node_modules.
vi.mock('@/platform/sqlite', () => ({ loadSqlite: () => createRequire(import.meta.url)('sql.js')() }));

/** A whole Live build where every model call goes through the step graph, checked by the workspace's own checks. */
describe('a whole build through the step graph', () => {
  it('detects every builder prompt, and every answer passes its role schema first time', async () => {
    const agent = createStepAgent({ provider: resolveProvider({ LLM_PROVIDER: 'mock' }) });
    const roles: string[] = [];
    const ask = async (prompt: string) => {
      const out = await agent.run({ prompt });
      if (!('result' in out)) throw new Error(out.error.message);
      roles.push(out.result.role + (out.result.attempts > 1 ? '*' : ''));
      return out.result.text;
    };
    const world = await startLine(ask);
    const app = await world.build('A gym tracks members, class bookings and trainers');
    await new Promise((r) => setTimeout(r, 50));
    expect(app.status).toBe('ready');
    expect(roles.slice(0, 5)).toEqual(['research', 'database', 'backend', 'views', 'screens']);
    expect(roles.filter((r) => r.endsWith('*'))).toEqual([]);
    expect(roles).not.toContain('any');
  }, 60_000);
});

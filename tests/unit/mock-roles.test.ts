// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { complete, resolveProvider } from '@/server/llm';
import { roleAnswer, roleOf } from '@/server/llm/providers/mock-roles';
import { startLine } from './helpers/workspace-line';

// The browser loads sql.js as a script from /vendor; here it comes straight from node_modules.
vi.mock('@/platform/sqlite', () => ({ loadSqlite: () => createRequire(import.meta.url)('sql.js')() }));

const mock = resolveProvider({ LLM_PROVIDER: 'mock' })!;
const ask = async (prompt: string) => (await complete(mock, { messages: [{ role: 'user', content: prompt }], tier: 'default' })).text;

describe('mock provider, role aware', () => {
  it('recognises the prompts of Turnkey agents and nothing else', () => {
    expect(roleOf('You are the Researcher agent on Turnkey, a line of agents that builds')).toBe('Researcher');
    expect(roleOf('You are Extractor, one of 3 agents inside the app "X". About')).toBe('team');
    expect(roleOf('Say hello')).toBeNull();
    expect(roleAnswer('Say hello')).toBeNull();
  });
  it('answers an ordinary prompt with an echo, as before', async () => {
    expect(JSON.parse(await ask('hello there'))).toEqual({ mock: true, echo: 'hello there' });
  });
  it.each([
    'A gym tracks members, class bookings and trainers',
    'Help desk tickets for an IT team, with agents and requesters',
    'Leave requests that a manager approves',
  ])(
    'runs a whole Live build through the real checks: %s',
    async (request) => {
      const world = await startLine(ask);
      const app = await world.build(request);
      await new Promise((r) => setTimeout(r, 50));
      const failed = Object.entries(app.line).filter(([, v]) => v.status !== 'ok');
      expect({ status: app.status, failed, chat: app.chat.slice(-3).map((m) => m.text) }).toMatchObject({ status: 'ready', failed: [] });
      expect(world.calls.slice(0, 5)).toEqual(['Researcher', 'Database', 'Backend', 'View advisor', 'UI']);
      expect(world.calls.length).toBeLessThanOrEqual(7);
      const tests = app.tests as { total: number; failed: number };
      expect(tests.failed).toBe(0);
      expect(tests.total).toBeGreaterThan(20);
      expect((app.qa as { by: string }).by).toBe('model');
    },
    60_000,
  );

  it('turns a chat request into a change the app accepts', async () => {
    const world = await startLine(ask);
    const app = await world.build('A gym tracks members, class bookings and trainers');
    const table = app.def.tables[1].name;
    await world.say(app, 'Add an emergency contact field to ' + table);
    expect(app.def.tables[1].columns.map((c) => c.name)).toContain('emergency_contact');
  }, 60_000);
});

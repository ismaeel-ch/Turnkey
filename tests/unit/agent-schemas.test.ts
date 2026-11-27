import { describe, expect, it } from 'vitest';
import { parseJSONLoose } from '@/server/agents/json';
import { detectRole } from '@/server/agents/registry';
import { issuesOf } from '@/server/agents/schemas';
import type { StepRole } from '@/shared/agent-contract';
import saved from './fixtures/saved-builds.json';

// Saved answers from src/workspace/builds.ts and quests.ts (the REC objects), written out by running those modules.
// They are known to pass the browser's checks, so every schema must accept them.
const builds = saved as unknown as Record<string, Record<string, unknown>>;
const ROLE_OF: Record<string, StepRole> = {
  research: 'research',
  database: 'database',
  database2: 'database',
  backend: 'backend',
  views: 'views',
  ui: 'screens',
  tester: 'tester',
};

describe('schemas accept every saved build', () => {
  for (const [id, rec] of Object.entries(builds)) {
    for (const [key, role] of Object.entries(ROLE_OF)) {
      if (rec[key] === undefined) continue;
      it(`${id}: ${key} passes the ${role} schema`, () => {
        expect(issuesOf(role, rec[key])).toEqual([]);
      });
    }
  }
  it('has the fixtures it claims to have', () => {
    expect(Object.keys(builds).length).toBeGreaterThanOrEqual(7);
  });
});

describe('schemas are as lenient as the browser normalisers', () => {
  it('accepts strings for roles, entities and states, and a workflow written under another key', () => {
    const brief = {
      name: 'A',
      summary: 'b',
      roles: ['clerk', 'boss'],
      entities: ['orders', 'items'],
      process: { entity: 'orders', states: [{ label: 'new' }, 'packed', 'sent'] },
      stories: [{ want: 'x' }, { want: 'y' }],
      extra: 1,
    };
    expect(issuesOf('research', brief)).toEqual([]);
    const be = { workflow: { states: ['a'], transitions: [{ from: 'a', to: 'b' }] }, access: { orders: { clerk: { list: 'all' } } } };
    expect(issuesOf('backend', be)).toEqual([]);
  });
  it('accepts an empty list of review findings and a team answer with only a sentence', () => {
    expect(issuesOf('review', { findings: [] })).toEqual([]);
    expect(issuesOf('team', { say: 'Nothing to add.' })).toEqual([]);
  });
  it('accepts a change that only answers a question', () => {
    expect(issuesOf('change', { reply: 'Two roles.' })).toEqual([]);
  });
});

describe('schemas refuse what the browser would refuse', () => {
  it('names the problem for a brief with one role and no stories', () => {
    const issues = issuesOf('research', {
      name: 'A',
      summary: 'b',
      roles: [{ id: 'a' }],
      entities: ['x', 'y'],
      process: { entity: 'x', states: ['a', 'b', 'c'] },
      stories: [],
    });
    expect(issues.join(' ')).toMatch(/roles/);
    expect(issues.join(' ')).toMatch(/stories/);
  });
  it('refuses a backend with no workflow and a dashboard with no widgets', () => {
    expect(issuesOf('backend', { access: [] }).length).toBeGreaterThan(0);
    expect(issuesOf('views', { views: [], dashboard: { widgets: [] } }).join(' ')).toMatch(/widgets/);
  });
  it('refuses an array where one object is needed', () => {
    expect(issuesOf('any', [])).not.toEqual([]);
  });
});

describe('parseJSONLoose', () => {
  it('reads the object out of fences and prose, as the browser does', () => {
    const r = parseJSONLoose('Here you go:\n```json\n{"a":1}\n```\nHope it helps.');
    expect(r).toEqual({ ok: true, value: { a: 1 } });
  });
  it('says why it failed', () => {
    expect(parseJSONLoose('no json here').ok).toBe(false);
    expect(parseJSONLoose('{"a":').ok).toBe(false);
    expect(parseJSONLoose('').ok).toBe(false);
  });
});

describe('detectRole', () => {
  const head = (who: string) => `You are the ${who} agent on Turnkey, a line of agents that builds small record-keeping web apps.\n\n`;
  it('names the builder agents', () => {
    expect(detectRole(head('Researcher') + 'REQUEST: "x"')).toBe('research');
    expect(detectRole(head('Planner') + 'REQUEST: "x"\n\nWrite the questions to ask the owner')).toBe('questions');
    expect(detectRole(head('Planner') + 'REQUEST: "x"\n\nANSWERS: []\n\nWrite the final plan.\n- ...')).toBe('plan');
    expect(detectRole(head('Database') + 'BRIEF')).toBe('database');
    expect(detectRole(head('Backend') + 'BRIEF')).toBe('backend');
    expect(detectRole(head('View advisor') + 'TABLES')).toBe('views');
    expect(detectRole(head('UI') + 'FORMAT: {"theme":{}}')).toBe('screens');
    expect(detectRole(head('UI') + 'FORMAT: {"tour":[]}')).toBe('walkthrough');
    expect(detectRole(head('Tester') + 'BRIEF')).toBe('tester');
    expect(detectRole(head('Orchestrator') + 'The owner wrote')).toBe('change');
  });
  it('names the repair, review and app agents', () => {
    expect(detectRole(head('Backend') + 'FAILING TESTS:\n- x\n\nFORMAT: {"say":"","fixes":[]}')).toBe('qa_repair');
    expect(detectRole(head('Security reviewer') + 'List at most 4 findings')).toBe('review');
    expect(detectRole('You are Scout, one of 3 agents inside the app "Fact desk". About.')).toBe('team');
  });
  it('leaves anything else as any', () => {
    expect(detectRole('Say hello')).toBe('any');
  });
});

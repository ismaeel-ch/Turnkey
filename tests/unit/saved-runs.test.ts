// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Migration } from '@/shared/types/app';
import type { AppRecord, SavedCase } from '@/shared/types/workspace';
import { followRenames, renameKeys, renamesOf } from '@/workspace/saved-runs';

vi.mock('@/platform/sqlite', () => ({ loadSqlite: () => createRequire(import.meta.url)('sql.js')() }));

/* Saved runs of an app's own agents follow the owner's field renames. They are written with the names the saved build
   started with; the app's migration log says what was renamed since. */

const ren = (table: string, from: string, to: string, n = 1): Migration =>
  ({ n, at: n, by: 'database', sql: '', note: '', step: { op: 'rename_field', table, from, to } }) as Migration;
const team = {
  input: { table: 'tenders', column: 'description' },
  agents: [
    { id: 'qualifier', writes: 'score_lines', updates: null },
    { id: 'red_team', writes: 'risks', updates: 'score_lines' },
  ],
} as unknown as Parameters<typeof followRenames>[1];

describe('followRenames', () => {
  it('reads only rename steps from the log, in order', () => {
    const log = [
      ren('tenders', 'client', 'customer', 1),
      { n: 2, at: 2, by: 'database', sql: '', note: '', step: { op: 'add_field', table: 'tenders', column: 'x' } } as Migration,
      { n: 3, at: 3, by: 'database', sql: '', note: '' } as Migration,
      ren('tenders', 'customer', 'buyer', 4),
    ];
    expect(renamesOf(log).map((s) => s.to)).toEqual(['customer', 'buyer']);
    expect(renamesOf(null)).toEqual([]);
  });

  it('follows a chain of renames on the right table only, and never overwrites a field that is there', () => {
    const steps = renamesOf([ren('tenders', 'client', 'customer'), ren('tenders', 'customer', 'buyer'), ren('risks', 'title', 'heading')]);
    expect(renameKeys({ client: 'A', title: 'T' }, 'tenders', steps)).toEqual({ buyer: 'A', title: 'T' });
    expect(renameKeys({ client: 'A', buyer: 'B' }, 'tenders', steps)).toEqual({ customer: 'A', buyer: 'B' });
  });

  it('moves the input values, each agent’s rows, updates and summary to their current names', () => {
    const c: SavedCase = {
      label: 'Port',
      values: { client: 'Harbour', description: 'Fleet' },
      script: [
        { agent: 'qualifier', rows: [{ criterion: 'Fit', score: 5 }] },
        { agent: 'red_team', rows: [{ risk: 'Price' }], update: [{ row: 1, score: 4 }], summary: { client: 'x', win_chance: 40 } },
        { agent: 'gone', rows: [{ score: 1 }] },
      ],
    };
    const steps = renamesOf([
      ren('tenders', 'client', 'customer'),
      ren('tenders', 'description', 'scope'),
      ren('score_lines', 'score', 'points'),
      ren('risks', 'risk', 'concern'),
    ]);
    const out = followRenames(c, team, steps);
    expect(out.values).toEqual({ customer: 'Harbour', scope: 'Fleet' });
    expect(out.script).toEqual([
      { agent: 'qualifier', rows: [{ criterion: 'Fit', points: 5 }] },
      { agent: 'red_team', rows: [{ concern: 'Price' }], update: [{ row: 1, points: 4 }], summary: { customer: 'x', win_chance: 40 } },
      { agent: 'gone', rows: [{ score: 1 }] },
    ]);
    // the saved case itself is left alone
    expect(c.values).toEqual({ client: 'Harbour', description: 'Fleet' });
    expect(followRenames(c, team, [])).toBe(c);
  });
});

/* The real thing: the bidding desk, built from its saved build, with fields renamed on the input table, on a table an
   agent writes, and the team's own input field. Every "Saved run replays" test still passes, and Demo still finds the
   saved run for a sample. */
type Mods = {
  core: typeof import('@/workspace/core');
  db: typeof import('@/workspace/db');
  line: typeof import('@/workspace/line');
  changes: typeof import('@/workspace/changes');
  tests: typeof import('@/workspace/tests');
  team: typeof import('@/workspace/team');
};
let M: Mods;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function build(tpl: string): Promise<AppRecord> {
  const app = M.line.newApp({ request: 'A bidding desk', tpl, mode: 'demo' });
  const done = M.line.runBuild(app as Parameters<Mods['line']['runBuild']>[0], undefined);
  for (let i = 0; i < 400 && app.status !== 'ready' && app.status !== 'failed'; i++) {
    const r = M.line.RUNS[app.id];
    if (r && r.answer) M.line.answerQuestion(app, 0);
    await sleep(10);
  }
  await done;
  expect(app.status).toBe('ready');
  return app;
}
const say = (app: AppRecord, text: string) =>
  M.changes.handleChat(app as Parameters<Mods['changes']['handleChat']>[0], text, { rules: true });
const teamResults = (app: AppRecord) => {
  M.tests.runTestsSync(app);
  return Object.entries(M.tests.TESTS[app.id].res).filter(([id]) => id.startsWith('team:'));
};

beforeAll(async () => {
  M = {
    core: await import('@/workspace/core'),
    db: await import('@/workspace/db'),
    line: await import('@/workspace/line'),
    changes: await import('@/workspace/changes'),
    tests: await import('@/workspace/tests'),
    team: await import('@/workspace/team'),
  };
  M.core.S.settings.demo = true;
  M.core.S.settings.speed = 'instant';
  await M.db.initSqlite();
});

describe('saved runs after a rename', () => {
  it('the bidding desk keeps every saved-run test green when its fields are renamed', async () => {
    const app = await build('biddesk');
    const before = teamResults(app);
    expect(before.length).toBeGreaterThan(1);
    expect(before.filter(([, r]) => !r.ok)).toEqual([]);

    await say(app, 'Rename the client field in tenders to customer');
    await say(app, 'Rename the description field in tenders to scope');
    await say(app, 'Rename the criterion field in score_lines to factor');
    const cols = (t: string) => (app.def.tables.find((x) => x.name === t)?.columns || []).map((c) => c.name);
    expect(cols('tenders')).toEqual(expect.arrayContaining(['customer', 'scope']));
    expect(cols('score_lines')).toContain('factor');
    expect(app.def.team?.input.column).toBe('scope');
    expect(app.def.team?.samples[0].values.scope).toBeTruthy();

    const after = teamResults(app);
    expect(after.length).toBe(before.length);
    expect(after.filter(([, r]) => !r.ok)).toEqual([]);
    // Demo finds the saved run for a sample by its renamed input field
    const sample = app.def.team!.samples[0];
    const found = M.team.teamCase(app as Parameters<Mods['team']['teamCase']>[0], String(sample.values.scope));
    expect(found?.label).toBe(sample.label);
    expect(found?.values.customer).toBeTruthy();
  }, 60000);
});

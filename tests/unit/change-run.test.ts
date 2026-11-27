// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppRecord, ChangePlan, ChatCard } from '@/shared/types/workspace';
// Builds replay saved recordings, which the page loads once the first screen has painted.
import '@/workspace/saved';

// The browser loads sql.js as a script from /vendor; here it comes straight from node_modules.
vi.mock('@/platform/sqlite', () => ({ loadSqlite: () => createRequire(import.meta.url)('sql.js')() }));

/* A change to a built app: the plan card says who works on it and what happens to the records, and only the stations
   the change needs run again. Runs the real workspace modules on a saved build with a real database. */

type Mods = {
  core: typeof import('@/workspace/core');
  db: typeof import('@/workspace/db');
  line: typeof import('@/workspace/line');
  changes: typeof import('@/workspace/changes');
  release: typeof import('@/workspace/release');
};
let M: Mods;
type BuildApp = Parameters<Mods['line']['runBuild']>[0];
type ChangeApp = Parameters<Mods['changes']['handleChat']>[0];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function build(): Promise<AppRecord> {
  const app = M.line.newApp({ request: 'A clinic front desk', tpl: 'clinic', mode: 'demo' });
  const done = M.line.runBuild(app as BuildApp, undefined);
  for (let i = 0; i < 400 && app.status !== 'ready' && app.status !== 'failed'; i++) {
    const r = M.line.RUNS[app.id];
    if (r && r.answer) M.line.answerQuestion(app, 0);
    await sleep(10);
  }
  await done;
  expect(app.status).toBe('ready');
  return app;
}
const say = (app: AppRecord, text: string) => M.changes.handleChat(app as ChangeApp, text, { rules: true });
const lastCard = (app: AppRecord, type: string) =>
  app.chat
    .map((m) => m.card)
    .filter((c): c is ChatCard => !!c && c.type === type)
    .pop();

beforeAll(async () => {
  M = {
    core: await import('@/workspace/core'),
    db: await import('@/workspace/db'),
    line: await import('@/workspace/line'),
    changes: await import('@/workspace/changes'),
    release: await import('@/workspace/release'),
  };
  M.core.S.settings.demo = true;
  M.core.S.settings.speed = 'instant';
  await M.db.initSqlite();
});

describe('a change after the app is built', () => {
  it('a new field: the plan names the team and the records, and it becomes a new feature', async () => {
    const app = await build();
    const records = app.def.tables.reduce((n, t) => n + Number(M.db.dbCount(app.id, t.name)), 0);
    await say(app, 'Add an allergies field to patients');
    const plan = lastCard(app, 'plan')?.plan as ChangePlan;
    expect(plan.kind).toBe('feature');
    expect(plan.becomes).toBe(''); // nothing is released yet, so no number is promised
    expect(plan.changes).toEqual(['Add Allergies (text) to Patients']);
    expect(plan.team.map((w) => w.who)).toEqual(['List builder', 'Rules builder', 'View advisor', 'Screen designer', 'Tester']);
    expect(plan.notNeeded.map((w) => w.who)).toEqual(['Planner']);
    expect(plan.records.label).toBe('Nothing is lost');
    expect(plan.records.text).toContain('All ' + records + ' records stay as they are');
    expect(lastCard(app, 'changed')?.reran).toEqual(['Database', 'Backend', 'Views', 'Screens', 'Walkthrough']);

    // after a release the same kind of change says which version it becomes
    await M.release.releaseApp(app, 'first', ['First release']);
    await say(app, 'Add a nickname field to patients');
    expect((lastCard(app, 'plan')?.plan as ChangePlan).becomes).toBe('1.1');
    expect(M.release.suggestKind(app)).toBe('feature');
  }, 120_000);

  it('a rule about who may do what runs only the rules, the pages and the tests, and says who gains access', async () => {
    const app = await build();
    await M.release.releaseApp(app, 'first', ['First release']);
    // something one kind of person may not do yet
    let pick: { role: string; roleId: string; table: string; label: string } | null = null;
    for (const t of app.def.tables)
      for (const r of app.def.brief!.roles) {
        const a = (app.def.access as Record<string, Record<string, { delete?: boolean }>>)[t.name]?.[r.id];
        if (!pick && a && a.delete === false) pick = { role: r.name, roleId: r.id, table: t.name, label: t.label };
      }
    expect(pick).not.toBeNull();
    const people = app.def.users.filter((u) => u.role === pick!.roleId).length;
    const untouched = ['database', 'views'].map((id) => ({ id, t1: app.line[id].t1, checks: app.line[id].checks }));

    await say(app, 'Let ' + pick!.role + ' delete ' + pick!.label.toLowerCase());
    const card = lastCard(app, 'plan')!,
      plan = card.plan as ChangePlan;
    expect(plan.kind).toBe('fix');
    expect(plan.becomes).toBe('1.0.1');
    expect(plan.team.map((w) => w.who)).toEqual(['Rules builder', 'Screen designer', 'Tester']);
    expect(plan.notNeeded.map((w) => w.who)).toEqual(['Planner', 'List builder', 'View advisor']);
    expect(plan.records).toEqual({
      level: 'safe',
      label: 'Nothing is changed',
      text: 'No record is touched. Only who may see or change them.',
    });
    expect(plan.access.gains).toEqual([
      pick!.role + ' (' + people + (people === 1 ? ' person' : ' people') + ') will be able to delete ' + pick!.label.toLowerCase() + '.',
    ]);
    expect(plan.access.loses).toEqual([]);
    expect(card.rerun).toEqual(['Backend', 'Screens', 'Walkthrough']);
    expect(card.skip).toEqual(['Research', 'Database', 'Views']);

    // it ran, the rule is in force, and the stations that were not needed were left exactly as they were
    const done = lastCard(app, 'changed')!;
    expect(done.reran).toEqual(['Backend', 'Screens', 'Walkthrough']);
    expect(done.skipped).toEqual(['Research', 'Database', 'Views']);
    expect((app.def.access as Record<string, Record<string, { delete?: boolean }>>)[pick!.table][pick!.roleId].delete).toBe(true);
    untouched.forEach((u) => {
      expect(app.line[u.id].checks).toBe(u.checks);
      expect(app.line[u.id].note).toBe('No change');
    });
    expect(app.tests?.failed).toBe(0);
    expect(M.release.suggestKind(app)).toBe('fix');

    // taking it away again names who loses it
    await say(app, 'Stop ' + pick!.role + ' from deleting ' + pick!.label.toLowerCase());
    const back = lastCard(app, 'plan')!.plan as ChangePlan;
    expect(back.access.gains).toEqual([]);
    expect(back.access.loses).toEqual([
      pick!.role +
        ' (' +
        people +
        (people === 1 ? ' person' : ' people') +
        ') will no longer be able to delete ' +
        pick!.label.toLowerCase() +
        '.',
    ]);
  }, 120_000);
});

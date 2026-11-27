// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppRecord, ChangePlan, ChatCard, PlanCard, TryCard, UnderstandCard } from '@/shared/types/workspace';
// Builds replay saved recordings, which the page loads once the first screen has painted.
import '@/workspace/saved';

// The browser loads sql.js as a script from /vendor; here it comes straight from node_modules.
vi.mock('@/platform/sqlite', () => ({ loadSqlite: () => createRequire(import.meta.url)('sql.js')() }));

/* Improving an app after it is built: a sentence becomes questions, a plan that waits for a go-ahead, a change in the
   draft, and a before and after to try. Runs the real workspace modules on a saved build with a real database. */

type Mods = {
  core: typeof import('@/workspace/core');
  db: typeof import('@/workspace/db');
  line: typeof import('@/workspace/line');
  release: typeof import('@/workspace/release');
  improve: typeof import('@/workspace/improve');
};
let M: Mods;
type BuildApp = Parameters<Mods['line']['runBuild']>[0];
type Access = Record<string, Record<string, { list: string; create: boolean; update: string; delete: boolean }>>;

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
const last = <C>(app: AppRecord, type: string) =>
  app.chat
    .map((m) => m.card)
    .filter((c): c is ChatCard => !!c && c.type === type)
    .pop() as unknown as C | undefined;
const one = (app: AppRecord, sql: string) => (M.db.sqlRun(app.id, sql, null, 'test') as Record<string, unknown>[])[0];
const cols = (app: AppRecord, table: string) => (app.def.tables.find((t) => t.name === table)?.columns || []).map((c) => c.name);
const access = (app: AppRecord) => app.def.access as Access;
/** Something one kind of person may not do yet: delete the records of some list. */
function refused(app: AppRecord) {
  for (const t of app.def.tables)
    for (const r of app.def.brief!.roles) if (access(app)[t.name]?.[r.id]?.delete === false) return { role: r, table: t };
  throw new Error('every role may delete everything');
}

beforeAll(async () => {
  M = {
    core: await import('@/workspace/core'),
    db: await import('@/workspace/db'),
    line: await import('@/workspace/line'),
    release: await import('@/workspace/release'),
    improve: await import('@/workspace/improve'),
  };
  M.core.S.settings.demo = true;
  M.core.S.settings.speed = 'instant';
  await M.db.initSqlite();
});

describe('improving an app after it is built', () => {
  it('a reported problem: the Tester sees it, the plan waits, go ahead fixes it in the draft only', async () => {
    const app = await build();
    await M.release.releaseApp(app, 'first', ['First release']);
    const { role, table } = refused(app),
      said = role.name + 's cannot delete ' + table.label.toLowerCase();
    expect(M.improve.soundsLikeProblem(said)).toBe(true);
    expect(M.improve.problemOps(app as never, said)).toEqual([
      { op: 'set_access', table: table.name, role: role.id, action: 'delete', value: 'all' },
    ]);

    await M.improve.startImprove(app, said);
    const u = last<UnderstandCard>(app, 'understand')!;
    expect(u.kind).toBe('fix');
    expect(u.seen?.ok).toBe(true);
    expect(u.seen?.text).toMatch(/^I see it too\. Signed in as .+ \(.+\), the rules do not allow them to delete /);
    expect(u.questions).toEqual([]);
    const p = last<PlanCard>(app, 'plan')!,
      plan = p.plan as ChangePlan;
    expect(p.decided).toBeNull();
    expect(plan.kind).toBe('fix');
    expect(plan.becomes).toBe('1.0.1');
    expect(plan.team.map((w) => w.who)).toEqual(['Rules builder', 'Screen designer', 'Tester']);
    expect(plan.access.gains).toHaveLength(1);
    // nothing has changed yet: the plan waits for the owner
    expect(access(app)[table.name][role.id].delete).toBe(false);
    expect(M.release.isDirty(app)).toBe(false);

    await M.improve.goAhead(app, p.flow!);
    expect(p.decided).toBe('go');
    expect(access(app)[table.name][role.id].delete).toBe(true);
    expect(app.tests?.failed).toBe(0);
    // it is in the draft, and people still have 1.0
    expect(M.release.isDirty(app)).toBe(true);
    expect(M.release.relOf(app)?.v).toBe('1.0');
    const t = last<TryCard>(app, 'tryit')!;
    expect(t).toMatchObject({ kind: 'fix', role: role.id, table: table.name, state: null, said });

    M.improve.tryVerdict(app, t.flow, true);
    expect(t.state).toBe('works');
    expect(app.chat[app.chat.length - 1].text).toBe(
      'Good. It waits in the draft, and goes out when you release version 1.0.1. Say "release" here when you are ready.',
    );
    expect(M.release.suggestKind(app)).toBe('fix');
    const r = await M.release.releaseApp(app, M.release.suggestKind(app), M.release.draftNotes(app));
    expect(r?.v).toBe('1.0.1');

    // reported again, the Tester cannot see it any more, and no plan is made
    const plans = app.chat.filter((m) => m.card?.type === 'plan').length;
    await M.improve.startImprove(app, said);
    expect(app.chat[app.chat.length - 1].text).toMatch(/^I could not see it\. .+ the rules already allow them to delete /);
    expect(app.chat.filter((m) => m.card?.type === 'plan').length).toBe(plans);
  }, 120_000);

  it('where a report was made fills in who and what', async () => {
    const app = await build();
    const { role, table } = refused(app);
    const ops = M.improve.problemOps(app as never, "I can't delete this", {
      user: 'Someone',
      role: role.id,
      screen: table.label,
      table: table.name,
      record: null,
    });
    expect(ops).toEqual([{ op: 'set_access', table: table.name, role: role.id, action: 'delete', value: 'all' }]);
    expect(M.improve.problemOps(app as never, "I can't delete this")).toBeNull();
    expect(M.improve.problemOps(app as never, 'Add a notes field to patients')).toBeNull();
  }, 60_000);

  it('a new feature: a question with a recommended answer, then the plan; not now changes nothing', async () => {
    const app = await build();
    await M.release.releaseApp(app, 'first', ['First release']);
    await M.improve.startImprove(app, 'Add a locker field to patients');
    let u = last<UnderstandCard>(app, 'understand')!;
    expect(u.kind).toBe('feature');
    expect(u.seen).toBeNull();
    expect(u.questions).toHaveLength(1);
    expect(u.questions[0].text).toBe('What kind of field is Locker?');
    expect(u.questions[0].options).toEqual(['Text', 'Number', 'Date', 'You decide']);
    expect(u.questions[0].recommended).toBe(0);
    // no plan until the question is answered
    expect(last<PlanCard>(app, 'plan')).toBeUndefined();

    M.improve.answerImprove(app, u.flow, 0, 3); // You decide: the recommended answer is used
    let p = last<PlanCard>(app, 'plan')!;
    expect(p.plan?.changes).toEqual(['Add Locker (text) to Patients']);
    expect(p.plan?.kind).toBe('feature');
    expect(p.plan?.becomes).toBe('1.1');
    expect(p.plan?.records.label).toBe('Nothing is lost');
    // the owner says it is really a fix: the card follows, and so does the number
    M.improve.setImproveKind(app, p.flow!, 'fix');
    expect(p.plan?.kind).toBe('fix');
    expect(p.plan?.becomes).toBe('1.0.1');
    M.improve.dropPlan(app, p.flow!, false);
    expect(p.decided).toBe('later');
    expect(cols(app, 'patients')).not.toContain('locker');
    expect(M.release.isDirty(app)).toBe(false);
    // a card that is no longer waiting cannot be used
    await M.improve.goAhead(app, p.flow!);
    expect(cols(app, 'patients')).not.toContain('locker');

    // asked again, answered with a number this time
    await M.improve.startImprove(app, 'Add a locker field to patients');
    u = last<UnderstandCard>(app, 'understand')!;
    M.improve.answerImprove(app, u.flow, 0, 1);
    p = last<PlanCard>(app, 'plan')!;
    expect(p.plan?.changes).toEqual(['Add Locker (number) to Patients']);
    await M.improve.goAhead(app, p.flow!);
    expect(app.def.tables.find((t) => t.name === 'patients')?.columns.find((c) => c.name === 'locker')?.type).toBe('number');
    expect(M.release.suggestKind(app)).toBe('feature');
    // a sentence that names the kind of field needs no question
    await M.improve.startImprove(app, 'Add a due date field to patients');
    expect(last<UnderstandCard>(app, 'understand')!.questions).toEqual([]);
  }, 120_000);

  it('removing a field asks what happens to its values, and keeping the field changes nothing', async () => {
    const app = await build();
    const n = Number(one(app, 'SELECT COUNT(*) AS n FROM "patients" WHERE "phone" IS NOT NULL AND "phone" <> \'\'').n);
    expect(n).toBeGreaterThan(0);
    await M.improve.startImprove(app, 'Remove the phone field from patients');
    let u = last<UnderstandCard>(app, 'understand')!;
    expect(u.questions[0].text).toBe(n + ' patients have a value in Phone. What should happen to them?');
    expect(u.questions[0].options).toEqual(['Put them away for 30 days', 'Keep the field', 'You decide']);
    M.improve.answerImprove(app, u.flow, 0, 1);
    expect(app.chat[app.chat.length - 1].text).toBe('Then nothing needs to change. The app stays as it is.');
    expect(cols(app, 'patients')).toContain('phone');

    await M.improve.startImprove(app, 'Remove the phone field from patients');
    u = last<UnderstandCard>(app, 'understand')!;
    M.improve.answerImprove(app, u.flow, 0, 0);
    const p = last<PlanCard>(app, 'plan')!;
    expect(p.plan?.records.level).toBe('removes');
    expect(p.plan?.records.text).toContain(n + ' stored values leave the app. They are put away for 30 days');
    await M.improve.goAhead(app, p.flow!); // go ahead is the yes: no second approval card
    expect(cols(app, 'patients')).not.toContain('phone');
    expect(Number(one(app, 'SELECT COUNT(*) AS n FROM "tk_put_away" WHERE "column_name" = \'phone\'').n)).toBe(n);
    expect(app.chat.some((m) => m.card?.type === 'approval')).toBe(false);
  }, 120_000);

  it('before and after: the version people have, holding the records the draft holds', async () => {
    const app = await build();
    expect(await M.improve.beforeCopy(app)).toBeNull(); // nothing is released yet
    await M.release.releaseApp(app, 'first', ['First release']);
    await M.improve.startImprove(app, 'Add a due date field to patients');
    await M.improve.goAhead(app, last<PlanCard>(app, 'plan')!.flow!);
    expect(cols(app, 'patients')).toContain('due_date');
    M.db.sqlRun(app.id, 'UPDATE "patients" SET "phone" = \'Typed in the draft\' WHERE "id" = 1', null, 'test');
    M.db.sqlRun(app.id, 'DELETE FROM "visit_notes" WHERE "id" = (SELECT MAX("id") FROM "visit_notes")', null, 'test');

    const before = (await M.improve.beforeCopy(app))!;
    expect(before.id).not.toBe(app.id);
    expect(cols(before, 'patients')).not.toContain('due_date');
    expect(one(before, 'SELECT "phone" AS c FROM "patients" WHERE "id" = 1').c).toBe('Typed in the draft');
    expect(one(before, 'SELECT COUNT(*) AS n FROM "visit_notes"').n).toBe(one(app, 'SELECT COUNT(*) AS n FROM "visit_notes"').n);
    // the draft itself is untouched by making the copy
    expect(cols(app, 'patients')).toContain('due_date');
    // a second comparison replaces the first copy, so copies do not pile up
    const again = (await M.improve.beforeCopy(app))!;
    expect(M.core.S.apps[before.id]).toBeUndefined();
    expect(M.core.S.apps[again.id]).toBeDefined();
  }, 120_000);
});

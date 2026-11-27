// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppRecord } from '@/shared/types/workspace';
// Builds replay saved recordings, which the page loads once the first screen has painted.
import '@/workspace/saved';

// The browser loads sql.js as a script from /vendor; here it comes straight from node_modules.
vi.mock('@/platform/sqlite', () => ({ loadSqlite: () => createRequire(import.meta.url)('sql.js')() }));

/* Records after a release: a device that updates keeps them (also in a field that was renamed), and the owner going
   back to an earlier version keeps them too. Runs the real workspace modules on a saved build with a real database. */

type Mods = {
  core: typeof import('@/workspace/core');
  db: typeof import('@/workspace/db');
  line: typeof import('@/workspace/line');
  changes: typeof import('@/workspace/changes');
  release: typeof import('@/workspace/release');
  share: typeof import('@/workspace/share');
  carry: typeof import('@/workspace/carry');
  steps: typeof import('@/workspace/record-steps');
  history: typeof import('@/workspace/history');
  tests: typeof import('@/workspace/tests');
};
let M: Mods;
type BuildApp = Parameters<Mods['line']['runBuild']>[0];
type ChangeApp = Parameters<Mods['changes']['handleChat']>[0];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Builds the clinic saved build, answering its one question with the first option. */
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
const one = (app: AppRecord, sql: string) => (M.db.sqlRun(app.id, sql, null, 'test') as Record<string, unknown>[])[0];
const cols = (app: AppRecord, table: string) => (app.def.tables.find((t) => t.name === table)?.columns || []).map((c) => c.name);
/** What a person's device does with a link: rebuild the app from the released pack. */
async function open(code: string): Promise<AppRecord> {
  return M.share.appFromPack(M.share.readPack(await M.share.unsqueeze(code)), 'k' + Math.random());
}
async function packOf(code: string) {
  return M.share.readPack(await M.share.unsqueeze(code));
}

beforeAll(async () => {
  M = {
    core: await import('@/workspace/core'),
    db: await import('@/workspace/db'),
    line: await import('@/workspace/line'),
    changes: await import('@/workspace/changes'),
    release: await import('@/workspace/release'),
    share: await import('@/workspace/share'),
    carry: await import('@/workspace/carry'),
    steps: await import('@/workspace/record-steps'),
    history: await import('@/workspace/history'),
    tests: await import('@/workspace/tests'),
  };
  M.core.S.settings.demo = true;
  M.core.S.settings.speed = 'instant';
  await M.db.initSqlite();
});

describe('records after a release', () => {
  it('an update keeps the values of a field that was renamed, and going back keeps every record', async () => {
    const app = await build();
    const r10 = await M.release.releaseApp(app, 'first', ['First release']);
    expect(r10?.v).toBe('1.0');
    expect(r10?.steps).toEqual([]);

    // version 1.1 renames a field and adds one
    await say(app, 'Rename the phone field in patients to mobile');
    await say(app, 'Add an allergies field to patients');
    expect(cols(app, 'patients')).toContain('mobile');
    expect(cols(app, 'patients')).not.toContain('phone');
    const r11 = await M.release.releaseApp(app, 'feature', ['Phone is called Mobile now', 'Patients have allergies']);
    expect(r11?.v).toBe('1.1');
    expect(r11?.steps).toEqual([
      { op: 'rename_field', table: 'patients', from: 'phone', to: 'mobile' },
      { op: 'add_field', table: 'patients', column: 'allergies' },
    ]);
    const pack11 = await packOf(r11!.pack!);
    expect(M.steps.normHistory(pack11.history).map((h) => h.v)).toEqual(['1.0', '1.1']);

    // a person has version 1.0 and has worked in it
    const dev10 = await open(r10!.pack!);
    M.db.sqlRun(dev10.id, 'UPDATE "patients" SET "phone" = \'Typed on the device\' WHERE "id" = 1', null, 'test');
    M.db.sqlRun(dev10.id, 'DELETE FROM "visit_notes" WHERE "id" = (SELECT MAX("id") FROM "visit_notes")', null, 'test');
    const had = Number(one(dev10, 'SELECT COUNT(*) AS n FROM "visit_notes"').n);

    // they receive 1.1: the value follows the field to its new name
    const dev11 = await open(r11!.pack!);
    const steps = M.steps.stepsBetween(M.steps.normHistory(pack11.history), '1.0', '1.1');
    const kept = M.carry.carryData(dev10, dev11, steps);
    expect(kept).not.toBeNull();
    expect(one(dev11, 'SELECT "mobile" AS c FROM "patients" WHERE "id" = 1').c).toBe('Typed on the device');
    expect(Number(one(dev11, 'SELECT COUNT(*) AS n FROM "visit_notes"').n)).toBe(had);
    expect(kept!.away).toBe(0);

    // without the steps the same update would have emptied the field: the bug this replaces
    const blind = await open(r11!.pack!);
    M.carry.carryData(dev10, blind, []);
    expect(one(blind, 'SELECT "mobile" AS c FROM "patients" WHERE "id" = 1').c).toBeNull();

    // the owner types into the new field, then goes back to 1.0
    M.db.sqlRun(
      app.id,
      'UPDATE "patients" SET "allergies" = \'Call them on Monday\', "mobile" = \'Edited by the owner\' WHERE "id" = 2',
      null,
      'test',
    );
    const before = Number(one(app, 'SELECT COUNT(*) AS n FROM "patients"').n);
    const back = await M.release.goBackTo(app, r10!, 'Allergies were not needed');
    expect(back?.v).toBe('1.1.1');
    expect(back?.kind).toBe('rollback');
    expect(back?.back).toBe('1.0');
    expect(M.release.relList(app).map((r) => r.v)).toEqual(['1.1.1', '1.1', '1.0']);
    expect(M.release.isDirty(app)).toBe(false);
    expect(cols(app, 'patients')).toContain('phone');
    expect(cols(app, 'patients')).not.toContain('allergies');
    // every record is still there, the renamed field holds its value under the old name again
    expect(Number(one(app, 'SELECT COUNT(*) AS n FROM "patients"').n)).toBe(before);
    expect(one(app, 'SELECT "phone" AS c FROM "patients" WHERE "id" = 2').c).toBe('Edited by the owner');
    // and the value in the field 1.0 does not have is put away, not deleted
    expect(
      one(
        app,
        'SELECT "value" AS v FROM "tk_put_away" WHERE "table_name" = \'patients\' AND "column_name" = \'allergies\' AND "row_id" = 2',
      ).v,
    ).toBe('Call them on Monday');
    expect(app.takenBack?.items).toEqual(['Phone is called Mobile now', 'Patients have allergies']);
    expect(app.takenBack?.why).toBe('Allergies were not needed');
    expect(app.tests?.failed).toBe(0);

    // the device on 1.1 receives 1.1.1: its records stay, the notes it typed are put away
    M.db.sqlRun(dev11.id, 'UPDATE "patients" SET "allergies" = \'From the device\' WHERE "id" = 1', null, 'test');
    const pack111 = await packOf(back!.pack!);
    const dev111 = await open(back!.pack!);
    const kept2 = M.carry.carryData(dev11, dev111, M.steps.stepsBetween(M.steps.normHistory(pack111.history), '1.1', '1.1.1'));
    expect(kept2?.away).toBe(1);
    expect(one(dev111, 'SELECT "phone" AS c FROM "patients" WHERE "id" = 1').c).toBe('Typed on the device');

    // the owner asks for notes again and releases: the put-away values come back, on the owner's copy and on the device
    await say(app, 'Add an allergies field to patients');
    expect(one(app, 'SELECT "allergies" AS v FROM "patients" WHERE "id" = 2').v).toBe('Call them on Monday');
    const r112 = await M.release.releaseApp(app, 'feature', ['Patients have allergies again']);
    expect(r112?.v).toBe('1.2');
    const pack12 = await packOf(r112!.pack!);
    const dev12 = await open(r112!.pack!);
    const kept3 = M.carry.carryData(dev111, dev12, M.steps.stepsBetween(M.steps.normHistory(pack12.history), '1.1.1', '1.2'));
    expect(kept3?.back).toBe(1);
    expect(one(dev12, 'SELECT "allergies" AS v FROM "patients" WHERE "id" = 1').v).toBe('From the device');
  }, 120_000);

  it('an update that cannot take the records changes nothing', async () => {
    const app = await build();
    const r10 = await M.release.releaseApp(app, 'first', ['First release']);
    const dev = await open(r10!.pack!),
      next = await open(r10!.pack!);
    const seeded = Number(one(next, 'SELECT COUNT(*) AS n FROM "patients"').n);
    // a record on the device that the new copy must refuse (a status the app does not know)
    M.db.sqlRun(dev.id, 'PRAGMA ignore_check_constraints = ON', null, 'test');
    M.db.sqlRun(dev.id, 'UPDATE "appointments" SET "status" = \'not_a_status\' WHERE "id" = 1', null, 'test');
    M.db.sqlRun(dev.id, 'UPDATE "patients" SET "phone" = \'Still here\' WHERE "id" = 2', null, 'test');
    expect(M.carry.carryData(dev, next, [])).toBeNull();
    expect(Number(one(next, 'SELECT COUNT(*) AS n FROM "patients"').n)).toBe(seeded);
    expect(one(dev, 'SELECT "phone" AS c FROM "patients" WHERE "id" = 2').c).toBe('Still here');
  }, 60_000);

  it('a release remembers what new people start with: empty, demo data or the records as they are', async () => {
    const app = await build();
    const count = (a: AppRecord, t: string) => Number(one(a, 'SELECT COUNT(*) AS n FROM "' + t + '"').n);
    const total = (a: AppRecord) => a.def.tables.reduce((n, t) => n + count(a, t.name), 0);
    M.db.sqlRun(app.id, 'UPDATE "patients" SET "phone" = \'Typed while trying it\' WHERE "id" = 1', null, 'test');
    const seeded = total(app);
    expect(seeded).toBeGreaterThan(10);

    // the usual choice for a real launch: nobody starts with the made-up records
    const r10 = await M.release.releaseApp(app, 'first', ['First release'], { start: 'empty' });
    expect(r10?.start).toBe('empty');
    const empty = M.share.packOf(app, { data: 'empty' });
    expect(empty.data).toBe('empty');
    const dev = M.share.appFromPack(empty, 'k-empty');
    expect(dev.status).toBe('ready');
    expect(dev.shared?.data).toBe('empty');
    expect(total(dev)).toBe(0);
    // the people of the app are still there, so someone can sign in, and every page is there
    expect(Number(one(dev, 'SELECT COUNT(*) AS n FROM "users"').n)).toBe(app.def.users.length);
    expect(dev.def.screens.length).toBe(app.def.screens.length);
    // the checks that do not walk through made-up records pass on it (the walkthrough books a visit for a demo patient)
    M.tests.runTestsSync(dev);
    const failing = Object.entries(M.tests.TESTS[dev.id].res).filter(([, r]) => !r.ok);
    expect(failing.filter(([id]) => !id.startsWith('acc:'))).toEqual([]);
    // the copy kept with the release still holds the demo data: the app can go back to it and "Reset data" still works
    const kept = M.share.appFromPack(await packOf(r10!.pack!), 'k-kept');
    expect(total(kept)).toBe(seeded);

    // starter settings the plan names are real from day one, so an empty start keeps them
    const settings = app.def.tables.find((t) => !t.columns.some((c) => c.type === 'ref' && c.required))!;
    app.plan = { lists: app.def.tables.map((t) => ({ name: t.name, settings: t.name === settings.name })) } as unknown as AppRecord['plan'];
    expect([...M.share.settingsLists(app, app.def.tables)]).toEqual([settings.name]);
    const some = M.share.appFromPack(M.share.packOf(app, { data: 'empty' }), 'k-settings');
    expect(some.status).toBe('ready');
    expect(count(some, settings.name)).toBe(count(app, settings.name));
    expect(total(some)).toBe(count(app, settings.name));
    // and the same for a version that is already packed
    const stripped = M.share.appFromPack(M.share.emptied(await packOf(r10!.pack!), app), 'k-stripped');
    expect(stripped.status).toBe('ready');
    expect(total(stripped)).toBe(count(stripped, settings.name));
    expect(count(stripped, settings.name)).toBeGreaterThan(0);
    // a settings list whose records must point at a list that starts empty cannot keep them
    const needy = app.def.tables.find((t) => t.columns.some((c) => c.type === 'ref' && c.required && c.ref !== 'users'));
    if (needy) {
      app.plan = { lists: [{ name: needy.name, settings: true }] } as unknown as AppRecord['plan'];
      expect(M.share.settingsLists(app, app.def.tables).size).toBe(0);
    }
    app.plan = null;

    // the records as they are now: what the owner typed travels
    const live = M.share.appFromPack(M.share.packOf(app, { data: 'live' }), 'k-live');
    expect(one(live, 'SELECT "phone" AS c FROM "patients" WHERE "id" = 1').c).toBe('Typed while trying it');

    // the next release starts new people the way the one before it did, unless the owner chooses again
    await say(app, 'Add an allergies field to patients');
    const r11 = await M.release.releaseApp(app, 'feature', ['Patients have allergies']);
    expect(r11?.start).toBe('empty');
    await say(app, 'Add a nickname field to patients');
    const r12 = await M.release.releaseApp(app, 'feature', ['Patients have a nickname'], { start: 'demo' });
    expect(r12?.start).toBe('demo');
    // a link from before the choice existed, or one that says something odd, starts with demo data
    expect(M.share.startWith(undefined)).toBe('demo');
    expect(M.share.startWith('everything')).toBe('demo');
  }, 120_000);

  it('what going back took out can be put back in the draft, with the records and the put-away values', async () => {
    const app = await build();
    M.core.openTab(app.id);
    M.history.historyHooks.check(); // the draft history starts, as it does when the app is open
    for (let i = 0; i < 100 && !M.history.historyOf(app.id)?.versions.length; i++) await sleep(10);
    expect(M.history.historyOf(app.id)?.versions.length).toBe(1);
    const r10 = await M.release.releaseApp(app, 'first', ['First release']);
    await say(app, 'Rename the phone field in patients to mobile');
    await say(app, 'Add an allergies field to patients');
    const r11 = await M.release.releaseApp(app, 'feature', ['Phone is called Mobile now', 'Patients have allergies']);
    expect(r11?.v).toBe('1.1');
    M.db.sqlRun(app.id, 'UPDATE "patients" SET "allergies" = \'Penicillin\', "mobile" = \'0300 5550100\' WHERE "id" = 2', null, 'test');

    const back = await M.release.goBackTo(app, r10!, 'The new field confused people');
    expect(back?.v).toBe('1.1.1');
    expect(M.release.draftNotes(app)).toEqual(['Small changes.']); // nothing is waiting: what 1.1 changed is not in the app now
    expect(M.release.canBringBack(app)).toBe(true);
    // a record added after going back must survive the changes coming back
    M.db.sqlRun(app.id, 'UPDATE "patients" SET "phone" = \'Changed after going back\' WHERE "id" = 3', null, 'test');
    const n = Number(one(app, 'SELECT COUNT(*) AS n FROM "patients"').n);

    expect(M.release.bringBack(app)).toBe(true);
    expect(app.takenBack).toBeNull();
    expect(cols(app, 'patients')).toContain('mobile');
    expect(cols(app, 'patients')).toContain('allergies');
    expect(Number(one(app, 'SELECT COUNT(*) AS n FROM "patients"').n)).toBe(n);
    expect(one(app, 'SELECT "mobile" AS c FROM "patients" WHERE "id" = 2').c).toBe('0300 5550100');
    expect(one(app, 'SELECT "mobile" AS c FROM "patients" WHERE "id" = 3').c).toBe('Changed after going back');
    expect(one(app, 'SELECT "allergies" AS c FROM "patients" WHERE "id" = 2').c).toBe('Penicillin'); // back from being put away
    expect(M.carry.awayCount(app.id)).toBe(0);
    // nothing was released: people still have 1.1.1, and the draft holds the changes again
    expect(M.release.relOf(app)?.v).toBe('1.1.1');
    expect(M.release.isDirty(app)).toBe(true);
    expect(app.tests?.failed).toBe(0);
    expect(M.release.draftNotes(app).join(' ')).toMatch(/Renamed .*Mobile/i);

    // released again, a device on 1.1.1 follows the rename and gets its put-away value back
    const dev111 = await open(back!.pack!);
    M.db.sqlRun(dev111.id, 'UPDATE "patients" SET "phone" = \'On the device\' WHERE "id" = 1', null, 'test');
    const r12 = await M.release.releaseApp(app, 'feature', ['Allergies are back']);
    expect(r12?.v).toBe('1.2');
    expect(r12?.steps).toEqual([
      { op: 'rename_field', table: 'patients', from: 'phone', to: 'mobile' },
      { op: 'add_field', table: 'patients', column: 'allergies' },
    ]);
    const pack12 = await packOf(r12!.pack!);
    const dev12 = await open(r12!.pack!);
    const moved = M.carry.carryData(dev111, dev12, M.steps.stepsBetween(M.steps.normHistory(pack12.history), '1.1.1', '1.2'));
    expect(moved).not.toBeNull();
    expect(one(dev12, 'SELECT "mobile" AS c FROM "patients" WHERE "id" = 1').c).toBe('On the device');

    // undoing the removal of a field brings its values back as well
    M.history.historyHooks.check(); // the draft with the field in it is a version
    const asked = say(app, 'Remove the allergies field from patients');
    for (let i = 0; i < 300 && !M.line.PENDING[app.id]; i++) await sleep(10);
    M.line.PENDING[app.id]?.(true); // the owner approves the removal on its card
    await asked;
    expect(cols(app, 'patients')).not.toContain('allergies');
    expect(M.carry.awayCount(app.id)).toBeGreaterThan(0);
    M.history.undo(app);
    expect(cols(app, 'patients')).toContain('allergies');
    expect(one(app, 'SELECT "allergies" AS c FROM "patients" WHERE "id" = 2').c).toBe('Penicillin');
    expect(M.carry.awayCount(app.id)).toBe(0);
    // and doing it again puts them away again, with nothing lost in between
    M.history.redo(app);
    expect(cols(app, 'patients')).not.toContain('allergies');
    expect(
      one(
        app,
        'SELECT "value" AS v FROM "tk_put_away" WHERE "table_name" = \'patients\' AND "column_name" = \'allergies\' AND "row_id" = 2',
      ).v,
    ).toBe('Penicillin');
  }, 120_000);
});

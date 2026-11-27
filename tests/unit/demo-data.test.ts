// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { complete, resolveProvider } from '@/server/llm';
import type { AppRecord } from '@/shared/types/workspace';
import { startLine } from './helpers/workspace-line';

// The browser loads sql.js as a script from /vendor; here it comes straight from node_modules.
vi.mock('@/platform/sqlite', () => ({ loadSqlite: () => createRequire(import.meta.url)('sql.js')() }));

const mock = resolveProvider({ LLM_PROVIDER: 'mock' })!;
const ask = async (prompt: string) => (await complete(mock, { messages: [{ role: 'user', content: prompt }], tier: 'default' })).text;

type Mods = {
  db: typeof import('@/workspace/db');
  demo: typeof import('@/workspace/demo-data');
  engine: typeof import('@/workspace/engine');
  tests: typeof import('@/workspace/tests');
  line: typeof import('@/workspace/line');
  changes: typeof import('@/workspace/changes');
};
let m: Mods;
let app: AppRecord;

const n = (text: string, params?: (string | number)[]) =>
  Number(Object.values(m.db.sqlRows(app.id, text, params || null)[0] || {})[0]) || 0;
const count = (table: string, where = '1 = 1') => n('SELECT COUNT(*) FROM ' + m.db.qi(table) + ' WHERE ' + where);
const seedRows = (table: string) => (app.seed?.rows[table] || []).length;
const brokenLinks = () => m.db.sqlRows(app.id, 'PRAGMA foreign_key_check', null).length;
/** The first table that points at another table, with that column: a child record needs a parent. */
function childTable() {
  for (const t of app.def.tables) {
    const c = t.columns.find((x) => x.type === 'ref' && x.ref !== t.name);
    if (c) return { t, c, parent: app.def.tables.find((x) => x.name === c.ref)! };
  }
  throw new Error('the built app has no table that points at another');
}
/** Adds one record of the app's own (not demo data) that points at the given parent row. */
function addOwnChild(parentId: number) {
  const { t, c } = childTable();
  const id = m.demo.tempRecord(app, t);
  expect(id).toBeGreaterThan(0);
  m.db.sqlRun(app.id, 'UPDATE ' + m.db.qi(t.name) + ' SET ' + m.db.qi(c.name) + ' = ? WHERE "id" = ?', [parentId, id]);
  return id;
}

/** The generated tests that failed in the last run, with what they found. */
const failedTests = () =>
  Object.entries(m.tests.TESTS[app.id].res)
    .filter(([, r]) => !r.ok)
    .map(([id, r]) => id + ': ' + r.actual);

beforeAll(async () => {
  const world = await startLine(ask);
  m = {
    db: await import('@/workspace/db'),
    demo: await import('@/workspace/demo-data'),
    engine: await import('@/workspace/engine'),
    tests: await import('@/workspace/tests'),
    line: await import('@/workspace/line'),
    changes: await import('@/workspace/changes'),
  };
  app = (await world.build('A gym tracks members, class bookings and trainers')) as unknown as AppRecord;
  await new Promise((r) => setTimeout(r, 50));
  expect(app.status).toBe('ready');
}, 60_000);

describe('demo data', () => {
  it('marks every row the Database agent wrote, and nothing else', () => {
    const c = m.demo.demoCounts(app);
    const made = app.def.tables.reduce((k, t) => k + count(t.name), 0);
    expect(made).toBeGreaterThan(5);
    expect(c).toMatchObject({ demo: made, own: 0 });
    expect(m.demo.hasDemoData(app)).toBe(true);
    expect(m.demo.canAddDemoData(app)).toBe(false);
    // the mark is a system column: it is in the file, and an agent cannot define a field with its name
    expect(m.db.createTableSQL({ name: 't', columns: [] })).toContain('"is_demo" INTEGER NOT NULL DEFAULT 0');
    const sc = m.engine.normSchema({ tables: [{ name: 'notes', columns: [{ name: 'is_demo' }, { name: 'text' }] }] }, app.def.brief!);
    expect(sc.tables[0].columns.map((x) => x.name)).toEqual(['text']);
  });

  it('a record made through the app is not demo data', () => {
    const { parent } = childTable();
    const id = addOwnChild(n('SELECT MIN("id") FROM ' + m.db.qi(parent.name)));
    const { t } = childTable();
    expect(count(t.name, '"is_demo" = 0 AND "id" = ' + id)).toBe(1);
    expect(m.demo.demoCounts(app).own).toBe(1);
  });

  it('plans a removal that never deletes a record someone added, and keeps what such a record points to', () => {
    const { t, parent } = childTable();
    const plan = m.demo.planDemoRemoval(app);
    const keptParent = n('SELECT MIN("id") FROM ' + m.db.qi(parent.name));
    expect(plan.ownN).toBe(1);
    expect(plan.kept[parent.name]).toContain(keptParent);
    expect(plan.goes[parent.name]).not.toContain(keptParent);
    expect(plan.keptNames.length).toBe(plan.keptN);
    expect(plan.goesN + plan.keptN).toBe(m.demo.demoCounts(app).demo);
    const own = n('SELECT "id" FROM ' + m.db.qi(t.name) + ' WHERE "is_demo" = 0');
    expect(plan.goes[t.name]).not.toContain(own);
  });

  it('removes the demo data, keeps the rest, and leaves no broken link', () => {
    const { t, parent } = childTable();
    const before = m.demo.demoCounts(app),
      plan = m.demo.planDemoRemoval(app);
    m.db.sqlRun(app.id, 'INSERT INTO "activity" ("at", "table_name", "row_id", "action") VALUES (?, ?, ?, ?)', [
      '2026-01-01T09:00',
      t.name,
      plan.goes[t.name][0],
      'updated',
    ]);
    expect(m.demo.planDemoRemoval(app).edited).toBe(1);
    const out = m.demo.removeDemoData(app);
    expect(out).toEqual({ removed: plan.goesN, kept: plan.keptN, own: 1 });
    const after = m.demo.demoCounts(app);
    expect(after.demo).toBe(0);
    expect(after.own).toBe(before.own + plan.keptN);
    expect(count(t.name)).toBe(1 + (plan.kept[t.name] || []).length);
    expect(count(parent.name, '"is_demo" = 0')).toBe(plan.kept[parent.name].length);
    expect(count('activity', '"action" = \'updated\'')).toBe(0); // the history of a removed record goes with it
    expect(brokenLinks()).toBe(0);
    expect(count('users')).toBe(app.def.users.length); // people stay, so everyone can still sign in
    expect(m.demo.canAddDemoData(app)).toBe(true);
  });

  it('the generated tests still pass with the demo data gone, and leave nothing behind', () => {
    const rows = app.def.tables.map((t) => count(t.name));
    const sum = m.tests.runTestsSync(app)!;
    expect(failedTests()).toEqual([]);
    expect(sum.total).toBeGreaterThan(20);
    expect(app.def.tables.map((t) => count(t.name))).toEqual(rows);
    expect(m.demo.demoCounts(app).demo).toBe(0);
  });

  it('the generated tests pass on an app with no records at all, by making their own temporary ones', () => {
    // "start empty": a copy of the database with every list emptied, put back afterwards
    const keep = m.db.dbBytes(app.id);
    m.db.sqlRun(app.id, 'DELETE FROM "activity"');
    m.db
      .topoOrder(app.def.tables)
      .reverse()
      .forEach((t) => m.db.sqlRun(app.id, 'DELETE FROM ' + m.db.qi(t.name)));
    expect(m.demo.demoCounts(app)).toMatchObject({ demo: 0, own: 0 });
    try {
      delete m.tests.TESTS[app.id];
      const sum = m.tests.runTestsSync(app)!;
      expect(failedTests()).toEqual([]);
      expect(sum.total).toBeGreaterThan(20);
      expect(app.def.tables.map((t) => count(t.name))).toEqual(app.def.tables.map(() => 0));
      // the workflow tests moved a record, and the walkthrough found the records it names
      const res = m.tests.TESTS[app.id].res;
      const wf = Object.keys(res).filter((k) => k.startsWith('wf:do:'));
      expect(wf.length).toBeGreaterThan(0);
      wf.forEach((k) => expect(res[k].actual).toMatch(/^now /));
      // the station checks that run on a change do the same
      expect(m.engine.testMatrix(app as never).filter((x) => !x.ok)).toEqual([]);
      const acc = m.engine.runAcceptance(app, { agent: 'orchestrator', appId: app.id });
      expect(acc.checks.filter((c) => !c.ok)).toEqual([]);
    } finally {
      m.db.dbReplace(app.id, keep);
    }
  });

  it('undo puts the database back as it was, until a record changes', () => {
    expect(m.demo.demoUndo(app)).not.toBeNull();
    expect(m.demo.undoDemoRemoval(app)).toBe(true);
    expect(m.demo.demoCounts(app)).toMatchObject({ own: 1 });
    expect(m.demo.hasDemoData(app)).toBe(true);
    expect(m.demo.demoUndo(app)).toBeNull();
    // remove again, then change a record: the undo is withdrawn
    m.demo.removeDemoData(app);
    expect(m.demo.demoUndo(app)).not.toBeNull();
    const { t } = childTable();
    expect(m.demo.tempRecord(app, t)).toBeGreaterThan(0);
    expect(m.demo.demoUndo(app)).toBeNull();
    expect(m.demo.undoDemoRemoval(app)).toBe(false);
  });

  it('adds the demo data again next to the records that are there, with every link pointing at the right row', () => {
    const own = m.demo.demoCounts(app).own;
    const added = m.demo.addDemoData(app, { quiet: true });
    const made = app.def.tables.reduce((k, t) => k + seedRows(t.name), 0);
    expect(added).toBe(made);
    expect(m.demo.demoCounts(app)).toMatchObject({ demo: made, own });
    expect(brokenLinks()).toBe(0);
    // a demo child points at a demo parent again, not at whichever record now has that position as its id
    const { t, c, parent } = childTable();
    const stray = n(
      'SELECT COUNT(*) FROM ' +
        m.db.qi(t.name) +
        ' k JOIN ' +
        m.db.qi(parent.name) +
        ' p ON p."id" = k.' +
        m.db.qi(c.name) +
        ' WHERE k."is_demo" = 1 AND p."is_demo" = 0',
    );
    expect(stray).toBe(0);
    expect(m.demo.addDemoData(app, { quiet: true })).toBeGreaterThan(0); // adding twice is allowed by the function; the app only offers it when there is none
    m.demo.removeDemoData(app, { quiet: true });
    expect(m.demo.demoCounts(app)).toMatchObject({ demo: 0, own });
    expect(m.demo.demoUndo(app)).toBeNull(); // a quiet removal (the build's "start empty") offers no undo
  });

  it('chat removes and adds demo data, and will not start over while there are records to lose', async () => {
    m.demo.addDemoData(app, { quiet: true });
    const own = m.demo.demoCounts(app).own;
    expect(own).toBeGreaterThan(0);
    await m.changes.handleChat(app as never, 'reset data', { rules: true });
    expect(m.demo.demoCounts(app).own).toBe(own);
    expect(app.chat[app.chat.length - 1].text).toMatch(/would delete the \d+ records? you added/);
    await m.changes.handleChat(app as never, 'remove the demo data', { rules: true });
    expect(m.demo.demoCounts(app)).toMatchObject({ demo: 0, own });
    await m.changes.handleChat(app as never, 'add demo data again', { rules: true });
    expect(m.demo.hasDemoData(app)).toBe(true);
  });

  it('start over empties everything and puts the demo data back, marked', () => {
    m.line.resetAppData(app);
    const made = app.def.tables.reduce((k, t) => k + seedRows(t.name), 0);
    expect(m.demo.demoCounts(app)).toMatchObject({ demo: made, own: 0 });
    expect(n('SELECT MIN("id") FROM ' + m.db.qi(app.def.tables[0].name))).toBe(1);
  });

  it('marks the original rows of a database made before the mark existed', () => {
    const t = app.def.tables[0];
    // an older file: no mark column, and one record added after the build
    app.def.tables.forEach((x) => m.db.sqlRun(app.id, 'ALTER TABLE ' + m.db.qi(x.name) + ' DROP COLUMN "is_demo"'));
    m.db.sqlRun(
      app.id,
      'INSERT INTO ' + m.db.qi(t.name) + ' SELECT NULL, ' + colsAfterId(t.name) + ' FROM ' + m.db.qi(t.name) + ' WHERE "id" = 1',
    );
    m.db.dbFlush(app.id);
    m.db.DBX.open[app.id].close();
    delete m.db.DBX.open[app.id]; // the next read opens the stored file, as after a reload
    expect(m.demo.demoCounts(app).byTable[t.name]).toEqual({ demo: seedRows(t.name), own: 1 });
    expect(count(t.name, '"is_demo" = 0 AND "id" > ' + seedRows(t.name))).toBe(1);
  });

  it('a copy that started from real records gets the mark column and no marks', () => {
    app.def.tables.forEach((x) => m.db.sqlRun(app.id, 'ALTER TABLE ' + m.db.qi(x.name) + ' DROP COLUMN "is_demo"'));
    m.db.dbFlush(app.id);
    m.db.DBX.open[app.id].close();
    delete m.db.DBX.open[app.id];
    app.shared = { key: 'k', by: '', at: 0, as: '', data: 'live', preview: false, ver: '', uid: '', notes: [] } as never;
    expect(m.demo.demoCounts(app).demo).toBe(0);
    expect(m.demo.canAddDemoData(app)).toBe(false); // none of its starting rows is demo data, so there is nothing to add
    app.shared = null;
  });
});

/** Every column of a table but its id, quoted, for copying a row. */
function colsAfterId(table: string) {
  return m.db
    .sqlRows(app.id, 'PRAGMA table_info(' + m.db.qi(table) + ')', null)
    .map((c) => String(c.name))
    .filter((c) => c !== 'id')
    .map(m.db.qi)
    .join(', ');
}

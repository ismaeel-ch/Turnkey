import type { AppTable, Row } from '@/shared/types/app';
import type { SqlRow, SqlValue } from '@/shared/types/sqljs';
import type { AppRecord, Dict } from '@/shared/types/workspace';
import { S, arr, commit, dayOffset, errText, notify, nowStamp, toast, toolCall } from './core';
import {
  DBX,
  DEMO_COL,
  dbBytes,
  dbExists,
  dbOpen,
  dbRelease,
  dbReplace,
  dbRollback,
  dbSavepoint,
  demoColSQL,
  qi,
  sqlPeek,
  sqlRows,
  sqlRun,
  topoOrder,
} from './db';
import { appUsers, insertSeed, seedIsDemo, seedIsLive } from './engine';
import { appBusy } from './history';

/* ===== Turnkey · demo data =====
   The rows the Database agent writes are made up, so every screen has something to show. Each one carries a hidden
   mark (the is_demo column) and a visible "Demo" tag. They can be removed in one step without touching a record
   someone added, put back, and added again later. Nothing here needs a model. */

const READY = new WeakSet<object>();
const sysTable = (n: string) => n === 'users' || n === 'activity' || /^sqlite_/.test(n);

/**
 * Makes sure every app table has the demo mark. A database made before the mark existed gets the column once: its
 * original rows are the ones with the lowest ids (ids are never reused), so those are marked. A copy that started
 * from someone's real records gets the column and no marks.
 */
export function demoReady(appId: string): boolean {
  if (!dbExists(appId)) return false;
  let db: object;
  try {
    db = dbOpen(appId);
  } catch {
    return false;
  }
  if (READY.has(db)) return true;
  READY.add(db);
  const app = S.apps[appId] as AppRecord | undefined;
  const missing = sqlRows(appId, "SELECT name FROM sqlite_master WHERE type = 'table'", null, 'upgrade')
    .map((r) => String(r.name))
    .filter((n) => !sysTable(n) && !sqlRows(appId, 'PRAGMA table_info(' + qi(n) + ')', null, 'upgrade').some((c) => c.name === DEMO_COL));
  missing.forEach((n) => {
    sqlRun(appId, 'ALTER TABLE ' + qi(n) + ' ADD COLUMN ' + demoColSQL, null, 'upgrade');
    const made = app && !seedIsLive(app) ? arr(app.seed && app.seed.rows[n]).length : 0;
    if (made) sqlRun(appId, 'UPDATE ' + qi(n) + ' SET ' + qi(DEMO_COL) + ' = 1 WHERE "id" <= ?', [made], 'upgrade');
  });
  return true;
}

/**
 * A list of starter settings (categories, limits, teams), as the approved plan marks it. Its rows are real from day
 * one: never demo data, never removed, and not counted as records someone added. An app without a plan has none.
 */
export const isSettingsTable = (app: Pick<AppRecord, 'plan'>, table: string) =>
  !!app.plan && arr<{ name: string; settings?: boolean }>(app.plan.lists).some((l) => l.name === table && l.settings === true);

/** How many records are demo data and how many are someone's own, in all and per table. Settings are counted apart. */
export interface DemoCounts {
  demo: number;
  own: number;
  settings: number;
  byTable: Dict<{ demo: number; own: number }>;
}
const NONE: DemoCounts = { demo: 0, own: 0, settings: 0, byTable: {} };
export function demoCounts(app: AppRecord): DemoCounts {
  if (!demoReady(app.id)) return NONE;
  const out: DemoCounts = { demo: 0, own: 0, settings: 0, byTable: {} };
  app.def.tables.forEach((t) => {
    const r = sqlPeek(app.id, 'SELECT COALESCE(SUM(' + qi(DEMO_COL) + '), 0) AS d, COUNT(*) AS n FROM ' + qi(t.name))[0];
    if (!r) return;
    const demo = Number(r.d) || 0,
      rest = (Number(r.n) || 0) - demo,
      settings = isSettingsTable(app, t.name);
    out.byTable[t.name] = { demo, own: settings ? 0 : rest };
    out.demo += demo;
    if (settings) out.settings += rest;
    else out.own += rest;
  });
  return out;
}
export const hasDemoData = (app: AppRecord) => demoCounts(app).demo > 0;
/** The demo rows kept on the app record, so they can be added again. */
const seedDemoRows = (app: AppRecord) =>
  app.def.tables.reduce((n, t) => n + arr<Row>(app.seed && app.seed.rows[t.name]).filter((r) => seedIsDemo(r, seedIsLive(app))).length, 0);
/** "Add demo data again" is offered when the app holds none and the original rows are still on record. */
export const canAddDemoData = (app: AppRecord) => dbExists(app.id) && !hasDemoData(app) && seedDemoRows(app) > 0;

/** "9 claims", "1 claim". */
export const countText = (n: number, t: Pick<AppTable, 'label' | 'one'>) => n + ' ' + (n === 1 ? t.one : t.label).toLowerCase();
/** "3 claims and 2 payments", from counts per table; "records" when there is nothing to name. */
export function countsText(app: AppRecord, of: Dict<number>, word?: string): string {
  const parts = app.def.tables.filter((t) => of[t.name] > 0).map((t) => countText(of[t.name], t));
  if (!parts.length) return 'no ' + (word || 'records');
  return parts.length > 3
    ? parts.slice(0, 3).join(', ') + ' and ' + (parts.length - 3) + ' more ' + (parts.length - 3 === 1 ? 'kind' : 'kinds')
    : parts.length === 1
      ? parts[0]
      : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

/** What removing the demo data would do, worked out before anything is changed. */
export interface DemoPlan {
  /** ids to delete, by table */
  goes: Dict<number[]>;
  /** demo rows that stay because a record someone added points at them (directly or through another kept row) */
  kept: Dict<number[]>;
  goesN: number;
  keptN: number;
  ownN: number;
  /** demo rows on the way out that were changed after they were added */
  edited: number;
  /** the names of the first few kept rows, for the confirmation */
  keptNames: string[];
}
export function planDemoRemoval(app: AppRecord): DemoPlan {
  const plan: DemoPlan = { goes: {}, kept: {}, goesN: 0, keptN: 0, ownN: 0, edited: 0, keptNames: [] };
  if (!demoReady(app.id)) return plan;
  const tables = app.def.tables,
    rows: Dict<SqlRow[]> = {},
    demo: Dict<Set<number>> = {},
    kept: Dict<Set<number>> = {},
    queue: [AppTable, SqlRow][] = [];
  tables.forEach((t) => {
    rows[t.name] = sqlPeek(app.id, 'SELECT * FROM ' + qi(t.name));
    demo[t.name] = new Set();
    kept[t.name] = new Set();
    rows[t.name].forEach((r) => {
      if (Number(r[DEMO_COL])) demo[t.name].add(Number(r.id));
      else queue.push([t, r]);
    });
  });
  plan.ownN = queue.filter(([t]) => !isSettingsTable(app, t.name)).length;
  // a record that stays keeps everything it points at, and so on down the chain
  while (queue.length) {
    const [t, r] = queue.pop() as [AppTable, SqlRow];
    t.columns.forEach((c) => {
      if (c.type !== 'ref' || r[c.name] == null || !demo[String(c.ref)]) return;
      const id = Number(r[c.name]),
        tn = String(c.ref);
      if (!demo[tn].has(id) || kept[tn].has(id)) return;
      kept[tn].add(id);
      const target = rows[tn].find((x) => Number(x.id) === id),
        tt = tables.find((x) => x.name === tn);
      if (target && tt) queue.push([tt, target]);
    });
  }
  const touched = new Set(
    sqlPeek(app.id, 'SELECT DISTINCT "table_name" AS t, "row_id" AS id FROM "activity" WHERE "action" <> ?', ['created']).map(
      (a) => a.t + '|' + a.id,
    ),
  );
  tables.forEach((t) => {
    plan.kept[t.name] = [...kept[t.name]];
    plan.goes[t.name] = [...demo[t.name]].filter((id) => !kept[t.name].has(id));
    plan.keptN += plan.kept[t.name].length;
    plan.goesN += plan.goes[t.name].length;
    plan.edited += plan.goes[t.name].filter((id) => touched.has(t.name + '|' + id)).length;
    plan.kept[t.name].forEach((id) => {
      const r = rows[t.name].find((x) => Number(x.id) === id),
        c = t.columns.find((x) => x.name === t.title),
        name = r && c && (c.type === 'text' || c.type === 'longtext') ? String(r[t.title] || '') : '';
      plan.keptNames.push(name || t.one + ' #' + id);
    });
  });
  return plan;
}

/** What the last removal did, kept in memory so it can be undone until a record changes. */
export interface DemoUndo {
  bytes: Uint8Array;
  sig: string;
  removed: number;
  own: number;
  at: number;
}
export const DEMO_UNDO: Dict<DemoUndo> = {};
/** A fingerprint of the records: it changes when a record is added, changed or removed. */
function recordsSig(app: AppRecord): string {
  const one = (text: string) => Object.values(sqlPeek(app.id, text)[0] || {}).join(':');
  return [one('SELECT COUNT(*) AS n, MAX("id") AS m FROM "activity"')]
    .concat(app.def.tables.map((t) => one('SELECT COUNT(*) AS n, MAX("id") AS m FROM ' + qi(t.name))))
    .join('|');
}
/** The last removal, while it can still be undone: nothing has been added, changed or removed since. */
export function demoUndo(app: AppRecord): DemoUndo | null {
  const u = DEMO_UNDO[app.id];
  if (!u) return null;
  if (!dbExists(app.id) || u.sig !== recordsSig(app)) {
    delete DEMO_UNDO[app.id];
    return null;
  }
  return u;
}
/** Closes the "Demo data removed" message. Undo is gone with it; "Add demo data again" stays. */
export function dismissDemoUndo(app: AppRecord) {
  delete DEMO_UNDO[app.id];
  notify();
}

/** Why the records cannot be changed right now, or '' when they can. */
export const demoBlocked = (app: AppRecord) => (appBusy(app) ? 'Wait until the current work on ' + app.name + ' has finished.' : '');
const chunks = <T>(list: T[], n: number) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
const logStep = (app: AppRecord, purpose: string, result: Dict<unknown>) =>
  toolCall({ agent: 'orchestrator', appId: app.id }, 'run_sql', { purpose }, () => result, 'backend');

/** What a removal did. */
export interface DemoRemoval {
  removed: number;
  kept: number;
  own: number;
}
/**
 * Removes the demo data. A record someone added is never deleted: a demo row that such a record points at stays and
 * stops being demo data. Everything happens inside one savepoint, so a failure leaves the database as it was.
 * `quiet` is for the build itself ("start empty"): no message, no undo, and it runs while the build is still open.
 */
export function removeDemoData(app: AppRecord, o?: { quiet?: boolean }): DemoRemoval | null {
  const quiet = !!(o && o.quiet);
  if (!demoReady(app.id)) return null;
  const why = quiet ? (DBX.hold[app.id] ? 'busy' : '') : demoBlocked(app);
  if (why) {
    if (!quiet) toast(why, 'warning');
    return null;
  }
  const plan = planDemoRemoval(app);
  if (!plan.goesN && !plan.keptN) return { removed: 0, kept: 0, own: plan.ownN };
  const bytes = quiet ? null : dbBytes(app.id),
    id = app.id,
    run = (text: string, params?: SqlValue[]) => sqlRun(id, text, params || null, 'demo');
  dbSavepoint(id, 'demo');
  try {
    run('PRAGMA defer_foreign_keys = ON'); // rows that point at each other go together; the links are checked below
    app.def.tables.forEach((t) =>
      chunks(plan.kept[t.name] || [], 400).forEach((part) =>
        run('UPDATE ' + qi(t.name) + ' SET ' + qi(DEMO_COL) + ' = 0 WHERE "id" IN (' + part.map(() => '?').join(', ') + ')', part),
      ),
    );
    topoOrder(app.def.tables)
      .reverse()
      .forEach((t) =>
        chunks(plan.goes[t.name] || [], 400).forEach((part) => {
          const marks = part.map(() => '?').join(', ');
          run('DELETE FROM "activity" WHERE "table_name" = ? AND "row_id" IN (' + marks + ')', [t.name as SqlValue].concat(part));
          run('DELETE FROM ' + qi(t.name) + ' WHERE "id" IN (' + marks + ')', part);
        }),
      );
    const broken = sqlRows(id, 'PRAGMA foreign_key_check', null, 'demo');
    if (broken.length) throw new Error('a record that stays points at one that would go (' + broken[0].table + ')');
    dbRelease(id, 'demo');
  } catch (e) {
    dbRollback(id, 'demo');
    if (!quiet) toast('The demo data could not be removed, so nothing was changed: ' + errText(e), 'danger', 8000);
    return null;
  }
  const out = { removed: plan.goesN, kept: plan.keptN, own: plan.ownN };
  logStep(app, 'remove demo data', out);
  if (bytes) DEMO_UNDO[id] = { bytes, sig: recordsSig(app), removed: plan.goesN, own: plan.ownN + plan.keptN, at: Date.now() };
  commit();
  return out;
}
/** Puts the database back as it was just before the demo data was removed. */
export function undoDemoRemoval(app: AppRecord): boolean {
  const u = demoUndo(app),
    why = demoBlocked(app);
  if (!u) {
    toast('A record has changed since, so this can no longer be undone. Use "Add demo data again" instead.', 'warning');
    return false;
  }
  if (why) {
    toast(why, 'warning');
    return false;
  }
  try {
    dbReplace(app.id, u.bytes);
  } catch (e) {
    toast('That did not work: ' + errText(e), 'danger');
    return false;
  }
  delete DEMO_UNDO[app.id];
  logStep(app, 'undo: put the demo data back', { rows: u.removed });
  toast('The demo data is back.', 'success');
  commit();
  return true;
}
/** Inserts the original demo rows again, marked as demo data, next to whatever the app holds now. */
export function addDemoData(app: AppRecord, o?: { quiet?: boolean }): number {
  const quiet = !!(o && o.quiet);
  if (!demoReady(app.id)) return 0;
  const why = demoBlocked(app);
  if (why) {
    if (!quiet) toast(why, 'warning');
    return 0;
  }
  const problems: string[] = [];
  let n = 0;
  dbSavepoint(app.id, 'demo');
  try {
    n = insertSeed(app.id, app.def.tables, (app.seed && app.seed.rows) || {}, problems, 'demo', app.def.users, true, {
      live: seedIsLive(app),
      onlyDemo: true,
    });
    dbRelease(app.id, 'demo');
  } catch (e) {
    dbRollback(app.id, 'demo');
    if (!quiet) toast('The demo data could not be added: ' + errText(e), 'danger');
    return 0;
  }
  delete DEMO_UNDO[app.id];
  logStep(app, 'add demo data', { rows: n, skipped: problems.length });
  if (!quiet)
    toast(
      n ? 'Demo data added: ' + n + (n === 1 ? ' record' : ' records') + ', each marked "Demo".' : 'There was no demo data to add.',
      n ? 'success' : 'info',
    );
  commit();
  return n;
}
/** Marks one record as demo data (the walkthrough's records) or as someone's own ("Keep this record"). */
export function setDemoMark(app: AppRecord, table: string, id: number, demo: boolean) {
  if (!demoReady(app.id) || !app.def.tables.some((t) => t.name === table)) return;
  sqlRun(app.id, 'UPDATE ' + qi(table) + ' SET ' + qi(DEMO_COL) + ' = ? WHERE "id" = ?', [demo ? 1 : 0, id], 'demo');
  notify();
}

/**
 * For a check that runs inside a savepoint: when the app holds no demo data (it was removed, or the app started empty),
 * the original demo rows are put in for the length of the check and rolled back with it. The checks were written
 * against those rows, so they keep passing, and no record someone added is touched.
 */
export function tempDemoData(app: AppRecord): number {
  if (!demoReady(app.id) || hasDemoData(app)) return 0;
  try {
    return insertSeed(app.id, app.def.tables, (app.seed && app.seed.rows) || {}, [], 'check', app.def.users, true, {
      live: seedIsLive(app),
      onlyDemo: true,
    });
  } catch {
    return 0;
  }
}
/**
 * One temporary record with every required field filled, for a check to act on when the table is empty. It is made
 * inside the check's savepoint and rolled back with it. Returns its id, or 0 when it could not be made.
 */
export function tempRecord(app: AppRecord, t: AppTable, depth = 0): number {
  const def = app.def,
    users = appUsers(app),
    cols: string[] = [],
    vals: SqlValue[] = [];
  const first = (tn: string) => Number((sqlRows(app.id, 'SELECT MIN("id") AS id FROM ' + qi(tn), null, 'check')[0] || {}).id) || 0;
  for (const c of t.columns) {
    const status = !!def.process && def.process.table === t.name && def.process.column === c.name;
    if (!c.required && !status) continue;
    let v: SqlValue;
    if (status) v = def.process ? def.process.initial : null;
    else if (c.type === 'number' || c.type === 'money') v = 1;
    else if (c.type === 'bool') v = 0;
    else if (c.type === 'date') v = dayOffset(0);
    else if (c.type === 'datetime') v = nowStamp();
    else if (c.type === 'select') v = (c.options || [])[0] || null;
    else if (c.type === 'user') v = (users.find((u) => !c.role || u.role === c.role) || users[0] || { id: null }).id;
    else if (c.type === 'ref') {
      const rt = def.tables.find((x) => x.name === c.ref);
      v = (rt && first(rt.name)) || (rt && rt.name !== t.name && depth < 3 ? tempRecord(app, rt, depth + 1) : 0) || null;
    } else v = 'Test ' + t.one.toLowerCase();
    if (v == null) return 0;
    cols.push(c.name);
    vals.push(v);
  }
  cols.push('created_at');
  vals.push(nowStamp());
  try {
    sqlRun(
      app.id,
      'INSERT INTO ' + qi(t.name) + ' (' + cols.map(qi).join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')',
      vals,
      'check',
    );
    return Number((sqlRows(app.id, 'SELECT last_insert_rowid() AS id', null, 'check')[0] || {}).id) || 0;
  } catch {
    return 0;
  }
}

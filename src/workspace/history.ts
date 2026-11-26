/*
 * Undo, redo and version history for a built app.
 *
 * The owner and the agents edit the same app: its definition (tables, rules, views, screens, theme) and its build
 * workflow. Rather than ask every station, change and canvas edit to report itself, this module watches the store.
 * When an app is idle (no run, no approval waiting, no re-run queued) and its definition or workflow differs from the
 * version it last saved, it saves a new version and works out who made the change from the app's provenance records
 * (src/workspace/provenance.ts): the agents whose items changed since, or `you` for workflow edits.
 *
 * Undo and redo move between versions; restoring an older version from the history adds it as a new version, so it
 * can be undone too. A version keeps the app's database file as well, so its tables always match its definition.
 * When a version is put back, the rows the app holds now are carried into it wherever the tables and fields
 * still exist: going back changes the design of the app, not the work people did in it.
 *
 * Histories are kept in IndexedDB (src/platform/storage/history-db.ts), at most 30 versions per app.
 */
import type { AppDef } from '@/shared/types/app';
import type { AppFlow, AppRecord, Dict, StationLine, Touch } from '@/shared/types/workspace';
import type { SqlDatabase, SqlValue } from '@/shared/types/sqljs';
import {
  canRedo,
  canUndo,
  currentVersion,
  emptyHistory,
  pushVersion,
  readHistory,
  stepHistory,
  type History,
  type Version,
} from '@/shared/history';
import { openHistoryDb, type HistoryDb } from '@/platform/storage/history-db';
import { S, U, activeTab, clone, commit, emit, hashStr, notify, subscribe, toast, uid } from './core';
import { DBX, dbBump, dbExists, dbFlush, dbOpen, qi } from './db';
import { PENDING, RUNS } from './line';
import { cancelRerun, queuedRerun } from './rerun';

/** What a version keeps of an app. `fp` fingerprints the parts the owner sees, to tell whether anything changed. */
export interface AppSnap {
  fp: string;
  name: string;
  icon: string;
  accent: string;
  def: AppDef;
  flow: AppFlow;
  line: Dict<StationLine>;
  touched: Dict<Touch>;
  reviews: AppRecord['reviews'];
  seed: AppRecord['seed'];
  log: AppRecord['log'];
  renamed: unknown;
  /** the app's SQLite file at this version, or null when it had none */
  db: Uint8Array | null;
}
export type AppVersion = Version<AppSnap>;

const isSnap = (x: unknown): x is AppSnap => {
  const s = x as Partial<AppSnap> | null;
  return !!s && typeof s.fp === 'string' && !!s.def && typeof s.def === 'object' && !!s.flow && typeof s.flow === 'object';
};

/** How long the store must be quiet before an edit is saved as a version. Bursts of edits become one version. */
export const SETTLE_MS = 700;

const HIST: Dict<History<AppSnap>> = {};
/** apps whose history is being read from storage */
const loading = new Set<string>();
let store: Promise<HistoryDb> | null = null;
const db = () => (store ||= openHistoryDb());

/** The fingerprint of what the owner sees of an app: its name, look, definition and workflow. */
export const fingerprint = (app: AppRecord) => hashStr(JSON.stringify([app.name, app.icon, app.accent, app.def, app.flow]));

function exportDb(appId: string): Uint8Array | null {
  try {
    if (!DBX.SQL || !dbExists(appId)) return null;
    const d = dbOpen(appId),
      u8 = d.export();
    d.run('PRAGMA foreign_keys = ON'); // export reopens the file
    return u8;
  } catch {
    return null;
  }
}

function snapOf(app: AppRecord): AppSnap {
  return {
    fp: fingerprint(app),
    name: app.name,
    icon: app.icon,
    accent: app.accent,
    def: clone(app.def),
    flow: clone(app.flow),
    line: clone(app.line),
    touched: clone(app.touched || {}),
    reviews: clone(app.reviews || {}),
    seed: app.seed ? clone(app.seed) : null,
    log: clone(app.log || []),
    renamed: app.renamed === undefined ? null : clone(app.renamed),
    db: exportDb(app.id),
  };
}

/** Who changed the app since `since`: the agents (or `you`, or the rules) whose items are newer, newest first. */
function whoSince(app: AppRecord, since: number, flowChanged: boolean): string[] {
  const recs = Object.values(app.touched || {})
    .filter((t) => t.at > since)
    .sort((a, b) => b.at - a.at);
  const by = [...new Set(recs.map((t) => t.by))];
  if (flowChanged && !by.includes('you')) by.push('you');
  return by.length ? by : ['you'];
}

/** The change in plain words: the newest change-log lines, the newest run, or what part changed. */
function whatSince(app: AppRecord, since: number, prev: AppSnap | null): string {
  const lines = (app.log || []).filter((l) => l.at > since).map((l) => l.text);
  if (lines.length) return lines.length > 2 ? lines.slice(-2).join('; ') + ' and ' + (lines.length - 2) + ' more' : lines.join('; ');
  const recs = Object.values(app.touched || {})
    .filter((t) => t.at > since && t.what)
    .sort((a, b) => b.at - a.at);
  if (recs.length) return String(recs[0].what);
  const run = (app.runs || []).filter((r) => r.t0 > since).pop();
  if (run && run.label) return String(run.label);
  if (prev) {
    if (prev.name !== app.name) return 'Rename the app to ' + app.name;
    if (JSON.stringify(prev.flow) !== JSON.stringify(app.flow)) return 'Change the workflow';
    if (prev.icon !== app.icon || prev.accent !== app.accent) return 'Change the look';
  }
  return 'Change the app';
}

/** True while something is still changing the app, so its state is not a finished version yet. */
export const appBusy = (app: AppRecord) =>
  app.status !== 'ready' || !!RUNS[app.id] || !!PENDING[app.id] || !!queuedRerun(app.id) || !!DBX.hold[app.id];

const saveTimers: Dict<ReturnType<typeof setTimeout>> = {};
function persist(appId: string) {
  clearTimeout(saveTimers[appId]);
  saveTimers[appId] = setTimeout(() => {
    delete saveTimers[appId];
    const h = HIST[appId];
    if (h) void db().then((d) => d.put(appId, h));
  }, 250);
}

async function load(appId: string) {
  if (HIST[appId] || loading.has(appId)) return;
  loading.add(appId);
  let h: History<AppSnap> | null = null;
  try {
    h = readHistory((await (await db()).get(appId)) as unknown, isSnap);
  } catch {
    h = null;
  }
  loading.delete(appId);
  HIST[appId] = h || emptyHistory<AppSnap>();
  check();
}

/** Saves a new version of an app if it changed since its current version. Returns the new version, if any. */
export function record(app: AppRecord): AppVersion | null {
  const h = HIST[app.id];
  if (!h || appBusy(app)) return null;
  const cur = currentVersion(h),
    fp = fingerprint(app);
  if (cur && cur.snap.fp === fp) return null;
  const since = cur ? cur.at : 0,
    flowChanged = !!cur && JSON.stringify(cur.snap.flow) !== JSON.stringify(app.flow),
    v: AppVersion = cur
      ? {
          id: uid('ver'),
          at: Date.now(),
          by: whoSince(app, since, flowChanged),
          what: whatSince(app, since, cur.snap),
          kind: 'edit',
          snap: snapOf(app),
        }
      : {
          id: uid('ver'),
          at: Date.now(),
          by: whoSince(app, 0, false).filter((b) => b !== 'you'),
          what: 'History starts here',
          kind: 'start',
          snap: snapOf(app),
        };
  HIST[app.id] = pushVersion(h, v);
  persist(app.id);
  notify();
  return v;
}

/** Looks at the open app and saves a version when it has changed and is idle. */
export function check() {
  const t = activeTab(),
    app = t && t.app ? S.apps[t.app] : null;
  if (!app || app.status !== 'ready') return;
  if (!HIST[app.id]) return void load(app.id);
  record(app);
}

/* ---------- putting a version back ---------- */

const colsOf = (d: SqlDatabase, table: string): string[] => {
  try {
    const r = d.exec('PRAGMA table_info(' + qi(table) + ')');
    return r.length ? r[0].values.map((v) => String(v[1])) : [];
  } catch {
    return [];
  }
};

/**
 * Builds the database for a version: its own file, with the rows of `cur` copied in for every table and field both
 * have. A table whose rows cannot go in (a field the version requires is missing now) keeps the version's rows.
 */
function carryRows(next: SqlDatabase, cur: SqlDatabase | null, tables: string[]) {
  if (!cur) return;
  next.run('PRAGMA foreign_keys = OFF');
  for (const t of tables) {
    const a = colsOf(next, t),
      b = new Set(colsOf(cur, t)),
      common = a.filter((c) => b.has(c));
    if (!a.length || !common.length) continue;
    next.run('SAVEPOINT carry');
    try {
      next.run('DELETE FROM ' + qi(t));
      const list = common.map(qi).join(', '),
        rows = cur.exec('SELECT ' + list + ' FROM ' + qi(t)),
        ins = next.prepare('INSERT INTO ' + qi(t) + ' (' + list + ') VALUES (' + common.map(() => '?').join(', ') + ')');
      try {
        for (const r of rows.length ? rows[0].values : []) ins.run(r as SqlValue[]);
      } finally {
        ins.free();
      }
      next.run('RELEASE carry');
    } catch {
      next.run('ROLLBACK TO carry');
      next.run('RELEASE carry');
    }
  }
}

function restoreDb(app: AppRecord, snap: AppSnap) {
  if (!snap.db || !DBX.SQL) return;
  let cur: SqlDatabase | null = null;
  try {
    cur = dbExists(app.id) ? dbOpen(app.id) : null;
  } catch {
    cur = null;
  }
  const next = new DBX.SQL.Database(snap.db);
  carryRows(next, cur, ['users', ...snap.def.tables.map((t) => t.name), 'activity']);
  next.run('PRAGMA foreign_keys = ON');
  clearTimeout(DBX.timers[app.id] ?? undefined);
  DBX.timers[app.id] = null;
  try {
    cur?.close();
  } catch {}
  DBX.open[app.id] = next;
  dbBump(app.id);
  dbFlush(app.id);
}

function apply(app: AppRecord, v: AppVersion) {
  const s = v.snap;
  cancelRerun(app.id); // the version was checked when it was saved; a re-run queued for the edit being undone is moot
  restoreDb(app, s);
  app.name = s.name;
  app.icon = s.icon;
  app.accent = s.accent;
  app.def = clone(s.def);
  app.flow = clone(s.flow);
  app.line = clone(s.line);
  app.touched = clone(s.touched);
  app.reviews = clone(s.reviews);
  app.seed = s.seed ? clone(s.seed) : null;
  app.log = clone(s.log || []);
  if (s.renamed == null) delete app.renamed;
  else app.renamed = clone(s.renamed);
  app.rev = (app.rev || 0) + 1;
  app.updated = Date.now();
  U.flowMap = null;
}

function move(app: AppRecord, dir: -1 | 1) {
  const h = HIST[app.id];
  if (!h || appBusy(app)) return false;
  record(app); // an edit not saved yet becomes a version first, so undo goes back to before it
  const from = currentVersion(HIST[app.id]),
    next = stepHistory(HIST[app.id], dir);
  if (!next || !from) return false;
  const to = currentVersion(next) as AppVersion;
  apply(app, to);
  HIST[app.id] = next;
  persist(app.id);
  emit('CUSTOM', { name: 'history', app: app.id, value: { op: dir < 0 ? 'undo' : 'redo', what: (dir < 0 ? from : to).what } });
  commit();
  return true;
}

export function undo(app: AppRecord) {
  if (appBusy(app)) return toast('Wait until the agents finish, then undo.', 'warning');
  const h = HIST[app.id],
    cur = currentVersion(h);
  if (!move(app, -1)) return toast('Nothing to undo.', 'info');
  toast('Undone: ' + (cur ? cur.what : 'the last change') + '.', 'info');
}

export function redo(app: AppRecord) {
  if (appBusy(app)) return toast('Wait until the agents finish, then redo.', 'warning');
  if (!move(app, 1)) return toast('Nothing to redo.', 'info');
  toast('Redone: ' + (currentVersion(HIST[app.id])?.what || 'the change') + '.', 'info');
}

/** Puts an older (or undone) version back as a new version, so the restore itself can be undone. */
export function restoreVersion(app: AppRecord, versionId: string) {
  if (appBusy(app)) return toast('Wait until the agents finish, then restore.', 'warning');
  record(app);
  const h = HIST[app.id],
    v = h && h.versions.find((x) => x.id === versionId);
  if (!h || !v) return;
  if (currentVersion(h)?.id === v.id) return;
  apply(app, v);
  const back: AppVersion = {
    id: uid('ver'),
    at: Date.now(),
    by: ['you'],
    what: 'Restore the version from ' + new Date(v.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ': ' + v.what,
    kind: 'restore',
    snap: { ...v.snap, fp: fingerprint(app), db: exportDb(app.id) },
  };
  HIST[app.id] = pushVersion(h, back);
  persist(app.id);
  emit('CUSTOM', { name: 'history', app: app.id, value: { op: 'restore', what: v.what } });
  commit();
  toast('Restored the version from ' + new Date(v.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '.', 'success');
}

/* ---------- reading ---------- */

export const historyOf = (appId: string): History<AppSnap> | null => HIST[appId] || null;
export const undoable = (app: AppRecord) => !appBusy(app) && (canUndo(HIST[app.id]) || hasUnsaved(app));
export const redoable = (app: AppRecord) => !appBusy(app) && canRedo(HIST[app.id]) && !hasUnsaved(app);
function hasUnsaved(app: AppRecord) {
  const cur = currentVersion(HIST[app.id]);
  return !!cur && cur.snap.fp !== fingerprint(app);
}

/* ---------- start: the store watcher, the keyboard, and cleaning up after deleted apps ---------- */

const editable = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  if (!e || !e.tagName) return false;
  return e.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) || !!e.closest?.('[contenteditable="true"],.cm-editor');
};

function onKey(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k !== 'z' && k !== 'y') return;
  if (editable(e.target) || U.dialog) return; // text boxes keep their own undo
  const t = activeTab(),
    app = t && t.app ? S.apps[t.app] : null;
  if (!app || app.status !== 'ready') return;
  e.preventDefault();
  if (k === 'y' || e.shiftKey) redo(app);
  else undo(app);
}

let started = false;
let checkTimer: ReturnType<typeof setTimeout> | null = null;

/** Starts watching the store. Call once, after boot(). */
export function startHistory() {
  if (started || typeof window === 'undefined') return;
  started = true;
  subscribe(() => {
    if (checkTimer) return;
    checkTimer = setTimeout(() => {
      checkTimer = null;
      check();
    }, SETTLE_MS);
  });
  document.addEventListener('keydown', onKey);
  // forget the histories of apps that were deleted
  void db().then(async (d) => {
    for (const k of await d.keys()) if (!S.apps[k]) await d.del(k);
  });
  check();
}

/** Test hooks (window.__formwork.history). */
export const historyHooks = {
  of: (appId: string) => {
    const h = HIST[appId];
    return h ? { at: h.at, versions: h.versions.map((v) => ({ id: v.id, by: v.by, what: v.what, kind: v.kind })) } : null;
  },
  check,
  durable: async () => (await db()).durable,
};

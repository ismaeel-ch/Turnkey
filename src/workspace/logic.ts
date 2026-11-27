/**
 * The logic of a built app, enforced: calculated fields are worked out and stored after every save, rules refuse a
 * save that breaks them, and a stage move is held back until its condition holds.
 *
 * A calculated value is stored in its own column, so every view, chart, total and filter reads it like any other
 * field. After a record changes, the fields that read it are worked out again: its own, the totals of the records it
 * points to, and the fields of the records that point to it. The formulas themselves live in src/shared/logic.
 */
import {
  calc,
  calcOrder,
  calcsOf,
  listsInto,
  logicProblems,
  readFormula,
  type AppRule,
  type CalcRef,
  type Rec,
  type Scope,
} from '@/shared/logic';
import { LOGIC_LIMITS } from '@/shared/logic/types';
import type { AppDef, AppTable, ColumnDef, Process, Transition, Untrusted } from '@/shared/types/app';
import type { SqlValue } from '@/shared/types/sqljs';
import { arr, dayOffset, label, snake, str } from './core';
import { qi, sqlRows, sqlRun } from './db';

type Tables = AppTable[];
/** The parts of an app's definition the logic reads. */
export type LogicDef = Pick<AppDef, 'tables' | 'process' | 'logic'>;
/** One record, by list and id. */
export interface RowRef {
  table: string;
  id: number;
}

const tableOf = (tables: Tables, name: string | null | undefined) => tables.find((t) => t.name === name);
const colOf = (t: AppTable | undefined, name: string) => t?.columns.find((c) => c.name === name);
/** How many records one pass reads from a list, and how many records one save may work out again. */
const READ_CAP = 2000;
const WORK_CAP = 600;

/** Stages that mean "this did not happen": a cancelled visit does not block the time it had. */
const DEAD = /cancel|reject|declin|no_show|void|withdraw|missed/;
/** True for a stage that ends a record without it having happened, such as cancelled or rejected. */
export const isDeadStage = (id: unknown) => DEAD.test(String(id));

/** Where a formula of `t` reads its records from: the app's own database. */
export function scopeFor(appId: string, def: LogicDef, t: AppTable, row: Rec): Scope {
  const tables = def.tables;
  const P = def.process && def.process.table === t.name ? def.process : null;
  return {
    row,
    today: dayOffset(0),
    isList: (name) => !colOf(t, name),
    parent(field) {
      const c = colOf(t, field),
        v = row[field];
      if (!c || v == null || v === '') return null;
      if (c.type === 'user')
        return sqlRows(appId, 'SELECT id, name, username, role FROM "users" WHERE "id" = ?', [v as SqlValue], 'rules')[0] || null;
      if (c.type !== 'ref' || !tableOf(tables, c.ref)) return null;
      return sqlRows(appId, 'SELECT * FROM ' + qi(c.ref) + ' WHERE "id" = ?', [v as SqlValue], 'rules')[0] || null;
    },
    children(list) {
      const via = listsInto(tables, t.name).find((x) => x.list === list);
      if (!via || row.id == null) return [];
      return sqlRows(
        appId,
        'SELECT * FROM ' + qi(list) + ' WHERE ' + qi(via.via) + ' = ? LIMIT ' + READ_CAP,
        [row.id as SqlValue],
        'rules',
      );
    },
    others() {
      const rows = sqlRows(
        appId,
        'SELECT * FROM ' + qi(t.name) + ' WHERE "id" <> ? LIMIT ' + READ_CAP,
        [(row.id as SqlValue) ?? 0],
        'rules',
      );
      return P ? rows.filter((r) => !DEAD.test(String(r[P.column]))) : rows;
    },
  };
}

/** A worked-out value as its column stores it: a number, a text, one of the choices, a date, or nothing. */
export function calcValue(c: ColumnDef, v: unknown): SqlValue {
  if (v == null || v === '') return null;
  switch (c.type) {
    case 'number':
    case 'money': {
      const n = typeof v === 'boolean' ? (v ? 1 : 0) : Number(v);
      return Number.isFinite(n) ? n : null;
    }
    case 'bool':
      return v === true || v === 1 || v === 'true' ? 1 : 0;
    case 'select':
      return (c.options || []).includes(String(v)) ? String(v) : null;
    case 'date': {
      const m = /^\d{4}-\d{2}-\d{2}/.exec(String(v));
      return m ? m[0] : null;
    }
    case 'datetime': {
      const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(v));
      return m ? m[1] + 'T' + m[2] : null;
    }
    default:
      return typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v);
  }
}

const same = (a: unknown, b: unknown) =>
  (a == null && b == null) || a === b || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);

/** True when the app has no calculated field: most of this file then has nothing to do. */
export const hasCalcs = (tables: Tables) => tables.some((t) => t.columns.some((c) => c.formula));
export const isCalc = (c: ColumnDef | null | undefined) => !!(c && c.formula);

/** Works out the calculated fields of one record and stores what changed. Returns true when something did. */
function recalcRow(appId: string, def: LogicDef, t: AppTable, order: CalcRef[], id: number): boolean {
  const row = sqlRows(appId, 'SELECT * FROM ' + qi(t.name) + ' WHERE "id" = ?', [id], 'rules')[0];
  if (!row) return false;
  const sets: string[] = [],
    ps: SqlValue[] = [];
  for (const cr of order) {
    if (cr.table !== t.name) continue;
    const c = colOf(t, cr.column);
    if (!c) continue;
    const v = calcValue(c, calc(cr.formula, scopeFor(appId, def, t, row)));
    if (same(row[c.name], v)) continue;
    row[c.name] = v; // a later field of the same record may read this one
    sets.push(qi(c.name) + ' = ?');
    ps.push(v);
  }
  if (sets.length) sqlRun(appId, 'UPDATE ' + qi(t.name) + ' SET ' + sets.join(', ') + ' WHERE "id" = ?', ps.concat([id]), 'rules');
  return sets.length > 0;
}

/** Works out every calculated field of every record: after the starting records are put in, and after a formula changes. */
export function recalcAll(appId: string, def: LogicDef): number {
  if (!hasCalcs(def.tables)) return 0;
  let changed = 0;
  // one field at a time in dependency order, so a total is worked out after the line totals it adds up
  for (const cr of calcOrder(def.tables).order) {
    const t = tableOf(def.tables, cr.table);
    if (!t) continue;
    for (const r of sqlRows(appId, 'SELECT "id" FROM ' + qi(t.name) + ' LIMIT ' + READ_CAP * 5, null, 'rules'))
      if (recalcRow(appId, def, t, [cr], Number(r.id))) changed++;
  }
  return changed;
}

/** For each list: which lists' records must be worked out again when one of its records changes. */
function ripples(tables: Tables) {
  const calcs = calcsOf(tables);
  /** list -> the link fields of it whose target has a field that totals this list */
  const up = new Map<string, string[]>();
  /** list -> the lists (with their link field) whose calculated fields read this list through that link */
  const down = new Map<string, { list: string; via: string }[]>();
  for (const c of calcs) {
    let reads;
    try {
      reads = readFormula(tables, c.table, c.formula).reads;
    } catch {
      continue;
    }
    for (const l of reads.lists)
      for (const x of listsInto(tables, c.table).filter((y) => y.list === l.list)) {
        const list = up.get(x.list) || [];
        if (!list.includes(x.via)) list.push(x.via);
        up.set(x.list, list);
      }
    const t = tableOf(tables, c.table);
    for (const p of reads.paths) {
      const link = colOf(t, p.head);
      if (!link || link.type !== 'ref' || !link.ref) continue;
      const list = down.get(link.ref) || [];
      if (!list.some((x) => x.list === c.table && x.via === link.name)) list.push({ list: c.table, via: link.name });
      down.set(link.ref, list);
    }
  }
  return { up, down };
}

/**
 * Works out again everything that reads the given records, and what reads those, until nothing changes. `before`
 * are the records as they were, so the totals of a record they no longer point to are corrected too. Returns every
 * record whose calculated fields changed.
 */
export function recalcAfter(appId: string, def: LogicDef, seeds: RowRef[], before: { table: string; row: Rec }[] = []): RowRef[] {
  if (!hasCalcs(def.tables)) return [];
  const tables = def.tables,
    order = calcOrder(tables).order,
    { up, down } = ripples(tables);
  const queue: (RowRef & { seed?: boolean })[] = seeds.map((s) => ({ ...s, seed: true }));
  const seen = new Map<string, number>(),
    changed: RowRef[] = [];
  const push = (table: string, id: unknown) => {
    const n = Number(id);
    if (n > 0) queue.push({ table, id: n });
  };
  for (const b of before) for (const via of up.get(b.table) || []) push(colOf(tableOf(tables, b.table), via)?.ref || '', b.row[via]);
  let work = 0;
  while (queue.length && work++ < WORK_CAP) {
    const q = queue.shift() as RowRef & { seed?: boolean };
    const key = q.table + '#' + q.id,
      times = seen.get(key) || 0;
    if (times >= 3) continue; // a field is read by a few others at most; this stops a loop the checks missed
    seen.set(key, times + 1);
    const t = tableOf(tables, q.table);
    if (!t) continue;
    const did = recalcRow(appId, def, t, order, q.id);
    if (did && !changed.some((c) => c.table === q.table && c.id === q.id)) changed.push({ table: q.table, id: q.id });
    if (!did && !q.seed) continue;
    const row = sqlRows(appId, 'SELECT * FROM ' + qi(t.name) + ' WHERE "id" = ?', [q.id], 'rules')[0];
    if (row) for (const via of up.get(t.name) || []) push(colOf(t, via)?.ref || '', row[via]);
    for (const d of down.get(t.name) || [])
      for (const r of sqlRows(appId, 'SELECT "id" FROM ' + qi(d.list) + ' WHERE ' + qi(d.via) + ' = ? LIMIT 200', [q.id], 'rules'))
        push(d.list, r.id);
  }
  return changed;
}

/** The first rule one of the records breaks, or null. A rule with no answer yet (an empty field) is not broken. */
export function brokenRule(appId: string, def: LogicDef, rows: RowRef[]): AppRule | null {
  const rules = def.logic?.rules || [];
  if (!rules.length) return null;
  for (const ref of rows) {
    const mine = rules.filter((r) => r.table === ref.table);
    if (!mine.length) continue;
    const t = tableOf(def.tables, ref.table);
    const row = t && sqlRows(appId, 'SELECT * FROM ' + qi(t.name) + ' WHERE "id" = ?', [ref.id], 'rules')[0];
    if (!t || !row) continue;
    const scope = scopeFor(appId, def, t, row);
    for (const r of mine) if (calc(r.when, scope) === false) return r;
  }
  return null;
}

/** Why a move cannot be made on this record right now, in plain words, or null when it can. */
export function moveBlock(appId: string, def: LogicDef, t: AppTable, row: Rec, tr: Transition): string | null {
  const missing = (tr.needs || []).filter((f) => colOf(t, f) && (row[f] == null || row[f] === ''));
  if (missing.length) return 'Fill in ' + missing.map((f) => (colOf(t, f)?.label || label(f)).toLowerCase()).join(' and ') + ' first';
  if (tr.when && calc(tr.when, scopeFor(appId, def, t, row)) === false)
    return tr.unless || 'Not possible for this ' + (t.one || 'record').toLowerCase() + ' yet';
  return null;
}

/** True when the record is in a stage that locks its fields. */
export const isLocked = (P: Process | null | undefined, row: Rec) => !!P && (P.locked || []).includes(String(row[P.column]));

/* ---------- reading the logic out of an agent's answer or a saved build ---------- */

/** The rules of an answer, kept to real lists. Whether their formulas work is `checkLogic`'s question. */
export function normRules(o: Untrusted, tables: Tables): AppRule[] {
  const used = new Set<string>();
  return arr(o)
    .map((r: Untrusted) => {
      r = r || {};
      const table = snake(r.table || r.list),
        when = str(r.when || r.rule || r.formula),
        message = str(r.message || r.says).slice(0, 200);
      let id = snake(r.id) || snake(message).slice(0, 40) || 'rule';
      for (let n = 2; used.has(id); n++) id = id.replace(/_\d+$/, '') + '_' + n;
      used.add(id);
      return { id, table, when, message };
    })
    .filter((r) => r.when && tableOf(tables, r.table))
    .slice(0, LOGIC_LIMITS.rules);
}

/** What is wrong with the app's logic as it stands, as plain sentences. */
export const logicIssues = (def: LogicDef): string[] =>
  logicProblems(
    def.tables,
    def.logic?.rules || [],
    def.process && def.process.table
      ? {
          table: def.process.table,
          column: def.process.column,
          moves: def.process.transitions.map((x) => ({ label: x.label, when: x.when, needs: x.needs })),
        }
      : null,
  );

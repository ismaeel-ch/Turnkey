import type { Migration, RecordStep, Untrusted } from '@/shared/types/app';
import { arr, snake, str } from './core';

/* ===== Turnkey · what a release does to the records, as steps that can be replayed =====
   Records live on each person's device. When a device receives a newer version it has to do to its own records what
   the owner's draft did to theirs: follow a field that was renamed, turn text into a choice, put away the values of a
   field that went. A release keeps those steps, the link carries them for every version, and the update replays the
   ones between the version a device has and the version it receives. This file is the plain logic, with no database
   and no screen in it. */

export type { RecordStep };

/** The steps one released version made, compared with the version before it. */
export interface VersionSteps {
  v: string;
  steps: RecordStep[];
}

export const STEP_LIMITS = { versions: 40, steps: 60 };

export const verParts = (v: unknown) =>
  String(v || '0')
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
export const verCmp = (a: unknown, b: unknown) => {
  const x = verParts(a),
    y = verParts(b);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
};

const NAME = /^[a-z][a-z0-9_]{0,59}$/,
  VER = /^\d+(\.\d+){0,2}$/;
const name = (x: unknown) => {
  const s = str(x);
  return NAME.test(s) ? s : '';
};

/** Reads one step from anything (a link is untrusted): a step with a missing or odd name is left out. */
export function normStep(o: Untrusted): RecordStep | null {
  if (!o || typeof o !== 'object') return null;
  const table = name(o.table);
  if (!table) return null;
  if (o.op === 'rename_field') {
    const from = name(o.from),
      to = name(o.to);
    return from && to && from !== to ? { op: 'rename_field', table, from, to } : null;
  }
  if (o.op === 'to_choice' || o.op === 'add_field' || o.op === 'remove_field') {
    const column = name(o.column);
    return column ? { op: o.op, table, column } : null;
  }
  return null;
}
export const normSteps = (list: unknown): RecordStep[] =>
  arr<Untrusted>(list)
    .slice(0, STEP_LIMITS.steps)
    .map(normStep)
    .filter((s): s is RecordStep => !!s);

/** Reads the steps of every version a link carries, oldest first. */
export function normHistory(list: unknown): VersionSteps[] {
  const seen = new Set<string>();
  return arr<Untrusted>(list)
    .slice(-STEP_LIMITS.versions)
    .map((x) => ({ v: str(x && x.v), steps: normSteps(x && x.steps) }))
    .filter((x) => VER.test(x.v) && !seen.has(x.v) && !!seen.add(x.v))
    .sort((a, b) => verCmp(a.v, b.v));
}

/** The steps a device on version `from` must replay to reach version `to`, in the order they were released. */
export function stepsBetween(history: VersionSteps[], from: unknown, to: unknown): RecordStep[] {
  return history
    .filter((h) => verCmp(h.v, from) > 0 && verCmp(h.v, to) <= 0)
    .sort((a, b) => verCmp(a.v, b.v))
    .flatMap((h) => h.steps);
}

/** The steps that undo `steps`: used when the owner goes back to an earlier version. A choice that becomes text
 *  again needs nothing, because text holds any value. */
export function inverseSteps(steps: RecordStep[]): RecordStep[] {
  const out: RecordStep[] = [];
  steps
    .slice()
    .reverse()
    .forEach((s) => {
      if (s.op === 'rename_field') out.push({ op: 'rename_field', table: s.table, from: s.to, to: s.from });
      else if (s.op === 'add_field') out.push({ op: 'remove_field', table: s.table, column: s.column });
      else if (s.op === 'remove_field') out.push({ op: 'add_field', table: s.table, column: s.column });
    });
  return out;
}

/**
 * The steps between two states of one draft, read from their migration logs: the log only grows, so one is the start
 * of the other. Going to the longer log replays its extra steps; going to the shorter one undoes them. Logs that do
 * not share a start give no steps, and fields are then matched by name alone.
 */
export function stepsFromTo(cur: Migration[] | undefined, next: Migration[] | undefined): RecordStep[] {
  const a = cur || [],
    b = next || [],
    k = Math.min(a.length, b.length);
  for (let i = 0; i < k; i++) if (a[i].at !== b[i].at || a[i].sql !== b[i].sql) return [];
  const of = (m: Migration[]) => m.map((x) => x.step).filter((x): x is RecordStep => !!x);
  return a.length > b.length ? inverseSteps(of(a.slice(k))) : of(b.slice(k));
}

/** Where each field of one table goes in an update. */
export interface ColumnPlan {
  /** fields whose values are copied, under the name they have afterwards */
  pairs: { from: string; to: string; choice: boolean }[];
  /** fields of the old version with no place in the new one: their values are put away, not deleted */
  away: string[];
  /** fields of the new version nothing was copied into: values put away earlier under that name come back */
  back: string[];
}

/**
 * Works out where the values of each field go when a table is updated. `fromCols` are the fields the device has,
 * `toCols` the fields of the version it receives, `steps` what happened in between. With no steps, a field keeps its
 * values when both versions have one of that name.
 */
export function columnPlan(steps: RecordStep[], table: string, fromCols: string[], toCols: string[]): ColumnPlan {
  const mine = steps.filter((s) => s.table === table),
    target = new Set(toCols),
    taken = new Set<string>(),
    plan: ColumnPlan = { pairs: [], away: [], back: [] };
  fromCols.forEach((c) => {
    let now = c,
      gone = false,
      choice = false;
    mine.forEach((s) => {
      if (gone) return;
      if (s.op === 'rename_field' && s.from === now) now = s.to;
      else if (s.op === 'to_choice' && s.column === now) choice = true;
      else if (s.op === 'remove_field' && s.column === now) gone = true;
    });
    if (!gone && target.has(now) && !taken.has(now)) {
      taken.add(now);
      plan.pairs.push({ from: c, to: now, choice });
    } else plan.away.push(c);
  });
  plan.back = toCols.filter((c) => !taken.has(c));
  return plan;
}

/** What a text value becomes when its field turns into a choice: the same rewrite the owner's draft ran. */
export const choiceValue = (v: unknown) => (typeof v === 'string' && v.trim() ? snake(v) : v);

/**
 * The undo stack behind an app's version history (src/workspace/history.ts). Pure functions on plain data, so the
 * rules are easy to test: a list of versions, oldest first, and the index of the one the app shows now.
 *
 * - A new edit drops every version after the current one (they were undone) and goes on the end.
 * - Undo and redo only move the index. Nothing is lost until a new edit replaces the undone versions.
 * - The list keeps at most `max` versions; the oldest go first.
 */

/** One saved point of an app. `snap` is whatever the caller keeps; this module never looks inside it. */
export interface Version<T> {
  id: string;
  /** when this version was saved, in epoch milliseconds */
  at: number;
  /** who made the change that led here: agent ids, `you` or `rules` */
  by: string[];
  /** the change in plain words, such as "Add Phone to Patients" */
  what: string;
  /** `start` is where the history begins, `restore` brought back an older version */
  kind: 'start' | 'edit' | 'restore';
  snap: T;
}

export interface History<T> {
  versions: Version<T>[];
  /** index in `versions` of the version the app shows now */
  at: number;
}

/** How many versions an app keeps. */
export const HISTORY_MAX = 30;

export const emptyHistory = <T>(): History<T> => ({ versions: [], at: -1 });

/** Adds a version after the current one, dropping the undone versions and the oldest beyond `max`. */
export function pushVersion<T>(h: History<T>, v: Version<T>, max = HISTORY_MAX): History<T> {
  const versions = h.versions.slice(0, h.at + 1).concat([v]);
  const drop = Math.max(0, versions.length - Math.max(1, max));
  const kept = versions.slice(drop);
  return { versions: kept, at: kept.length - 1 };
}

export const canUndo = <T>(h: History<T> | null | undefined) => !!h && h.at > 0;
export const canRedo = <T>(h: History<T> | null | undefined) => !!h && h.at >= 0 && h.at < h.versions.length - 1;

/** Moves one step back (-1) or forward (+1). Returns null when there is nowhere to go. */
export function stepHistory<T>(h: History<T>, dir: -1 | 1): History<T> | null {
  if (dir < 0 ? !canUndo(h) : !canRedo(h)) return null;
  return { versions: h.versions, at: h.at + dir };
}

/** The version the app shows now. */
export const currentVersion = <T>(h: History<T> | null | undefined): Version<T> | null =>
  h && h.at >= 0 && h.at < h.versions.length ? h.versions[h.at] : null;

/**
 * Checks a history read back from storage. Returns null when it is not one, so a damaged record starts a new
 * history instead of breaking the page.
 */
export function readHistory<T>(raw: unknown, isSnap: (x: unknown) => x is T): History<T> | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { versions?: unknown; at?: unknown };
  if (!Array.isArray(o.versions) || typeof o.at !== 'number') return null;
  const versions: Version<T>[] = [];
  for (const x of o.versions) {
    const v = x as Partial<Version<T>> | null;
    if (!v || typeof v.id !== 'string' || typeof v.at !== 'number' || typeof v.what !== 'string') return null;
    if (!Array.isArray(v.by) || !v.by.every((b) => typeof b === 'string')) return null;
    if (v.kind !== 'start' && v.kind !== 'edit' && v.kind !== 'restore') return null;
    if (!isSnap(v.snap)) return null;
    versions.push({ id: v.id, at: v.at, by: v.by, what: v.what, kind: v.kind, snap: v.snap });
  }
  if (!versions.length) return null;
  const at = Math.min(versions.length - 1, Math.max(0, Math.floor(o.at)));
  return { versions, at };
}

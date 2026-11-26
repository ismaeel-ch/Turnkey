/*
 * Who touched what. Every table, field, set of access rules, view and screen of an app remembers which agent made it
 * or last changed it, in which run, and whether that was the build or a change the owner asked for. It is worked out
 * by comparing the definition before and after each step, so no station or change has to report it by hand.
 */
import type { AppDef } from '@/shared/types/app';
import type { AppRecord, Dict, Touch } from '@/shared/types/workspace';
import { AGENTS } from './agents';

export type { Touch };

/** One fingerprint per item of the definition, by a key such as `table:patients` or `col:patients.phone`. */
export type DefSnapshot = Dict<string>;

/** `by` and `run` are provenance already, so they do not count as a change to the item. */
const plain = (x: object): string => JSON.stringify(x, (k, v) => (k === 'by' || k === 'run' ? undefined : (v as unknown)));

/** Fingerprints every item of a definition that the owner can see in the Details pages or the Build view. */
export function snapshotDef(def: AppDef | null | undefined): DefSnapshot {
  const out: DefSnapshot = {};
  if (!def) return out;
  for (const t of def.tables || []) {
    const { columns, ...rest } = t;
    out['table:' + t.name] = plain(rest);
    for (const c of columns || []) out['col:' + t.name + '.' + c.name] = plain(c);
    if (def.access && def.access[t.name]) out['access:' + t.name] = plain(def.access[t.name]);
    if (def.views && def.views[t.name]) out['views:' + t.name] = plain(def.views[t.name]);
  }
  for (const s of def.screens || []) out['screen:' + s.id] = plain(s);
  if (def.dash) out['dash'] = plain(def.dash);
  if (def.theme) out['theme'] = plain(def.theme);
  return out;
}

/**
 * Records, for every item that is new or different since `before`, that `by` made it now.
 * Items that are gone lose their record. `by` is an agent id, `rules` for the built-in rules, or `you`.
 */
export function recordTouches(app: AppRecord, before: DefSnapshot, by: string, via: Touch['via'], run?: number, what?: string) {
  const after = snapshotDef(app.def),
    touched = (app.touched ||= {}),
    at = Date.now();
  for (const k of Object.keys(after)) {
    if (before[k] === after[k]) continue;
    touched[k] = { by, via, at, ...(run != null ? { run } : {}), ...(what ? { what } : {}) };
  }
  for (const k of Object.keys(touched)) if (!(k in after)) delete touched[k];
}

export function touchOf(app: AppRecord, key: string): Touch | null {
  return (app.touched && app.touched[key]) || null;
}

const whoName = (by: string) =>
  by === 'rules' ? 'the built-in rules' : by === 'you' ? 'you' : 'the ' + (AGENTS[by]?.name || by) + ' agent';

/** Plain words for one record, such as "Changed by the Database agent at your request". */
export function touchText(t: Touch | null, fallback = ''): string {
  if (!t) return fallback;
  const who = whoName(t.by);
  if (t.via === 'change') return 'Changed by ' + who + ' at your request';
  if (t.via === 'rerun') return 'Made again by ' + who + ' in a re-run';
  return 'Made by ' + who;
}

/** A few words for a table cell, such as "Database agent, your request". */
export function touchShort(t: Touch | null): string {
  if (!t) return '';
  const who = t.by === 'rules' ? 'Built-in rules' : t.by === 'you' ? 'You' : (AGENTS[t.by]?.name || t.by) + ' agent';
  return who + (t.via === 'change' ? ', your request' : t.via === 'rerun' ? ', re-run' : '');
}

/** The newest record among a table and its fields, access rules and views, for "last changed by". */
export function latestTouchOfTable(app: AppRecord, table: string): Touch | null {
  let best: Touch | null = null;
  for (const [k, t] of Object.entries(app.touched || {})) {
    const own = k === 'table:' + table || k === 'access:' + table || k === 'views:' + table || k.startsWith('col:' + table + '.');
    if (own && (!best || t.at > best.at)) best = t;
  }
  return best;
}

/** The agent to draw next to an item: its icon and colour, or null for the rules and the owner. */
export const touchAgent = (t: Touch | null) => (t && AGENTS[t.by] ? t.by : null);

import type { AppTeam, Migration, RecordStep } from '@/shared/types/app';
import type { AppRecord, Dict, Loose, SavedCase } from '@/shared/types/workspace';
import { REC } from './registry';

/* ===== Turnkey · saved runs that follow the app's field renames =====
   A saved build carries recorded runs of the app's own agents: the values a person typed and what each agent wrote.
   They are written with the field names the saved build started with. When the owner renames a field afterwards, the
   app's migration log keeps a rename step, and this file replays those steps over a saved run so its values land in
   the renamed fields. It works for every app with a team, not for one sample in particular. Plain logic, no screen. */

/** The rename steps in a migration log, in the order they were made. */
export const renamesOf = (migrations: Migration[] | null | undefined): Extract<RecordStep, { op: 'rename_field' }>[] =>
  (migrations || []).map((m) => m.step).filter((s): s is Extract<RecordStep, { op: 'rename_field' }> => !!s && s.op === 'rename_field');

type Renames = ReturnType<typeof renamesOf>;

/** A copy of `o` with its keys renamed by every step on `table`, in order. Values are left as they are. */
export function renameKeys<T extends Dict<Loose>>(o: T, table: string | null | undefined, steps: Renames): T {
  if (!o || typeof o !== 'object' || Array.isArray(o) || !table) return o;
  const out: Dict<Loose> = { ...o };
  steps.forEach((s) => {
    if (s.table !== table || !(s.from in out) || s.to in out) return;
    out[s.to] = out[s.from];
    delete out[s.from];
  });
  return out as T;
}

const rows = (list: Loose, table: string | null | undefined, steps: Renames) =>
  Array.isArray(list) ? list.map((r) => (r && typeof r === 'object' ? renameKeys(r as Dict<Loose>, table, steps) : r)) : list;

/**
 * A saved run with its field names moved to where they are now. `team` is the app's team: its tables say which table
 * each part of the run belongs to (the input values and an agent's summary to the input table, an agent's rows to the
 * table it writes, its updates to the table it edits). Table names never change, so they can be read from the app.
 */
export function followRenames(c: SavedCase, team: Pick<AppTeam, 'input' | 'agents'>, steps: Renames): SavedCase {
  if (!steps.length) return c;
  const input = team.input.table,
    script = Array.isArray(c.script)
      ? c.script.map((s) => {
          if (!s || typeof s !== 'object') return s;
          const out = s as Dict<Loose>,
            a = team.agents.find((x) => x.id === out.agent);
          if (!a) return s;
          const next: Dict<Loose> = { ...out };
          if ('rows' in out) next.rows = rows(out.rows, a.writes, steps);
          if ('update' in out) next.update = rows(out.update, a.updates, steps);
          if (out.summary && typeof out.summary === 'object') next.summary = renameKeys(out.summary as Dict<Loose>, input, steps);
          return next;
        })
      : c.script;
  return { ...c, values: renameKeys(c.values, input, steps), ...(script ? { script } : {}) };
}

/** The saved runs of this app's own agents, under the field names the app has now. Empty for an app with no team. */
export function savedCases(
  app: Pick<AppRecord, 'tpl'> & { def?: { team?: AppTeam | null; migrations?: Migration[] } | null },
): SavedCase[] {
  const rec = app.tpl ? REC[app.tpl] : undefined,
    list = (rec && rec.cases) || [],
    team = app.def && app.def.team;
  if (!team || !list.length) return list;
  const steps = renamesOf(app.def && app.def.migrations);
  return steps.length ? list.map((c) => followRenames(c, team, steps)) : list;
}

import type { RecordStep } from '@/shared/types/app';
import type { SqlRow, SqlValue } from '@/shared/types/sqljs';
import type { AppRecord } from '@/shared/types/workspace';
import { LS, errText } from './core';
import { b64, dbBytes, dbExists, dbRelease, dbRollback, dbSavepoint, qi, sqlMany, sqlRows, sqlRun, topoOrder } from './db';
import { colOf } from './engine';
import { choiceValue, columnPlan } from './record-steps';

/* ===== Turnkey · moving records from one version of an app into another =====
   Used when a device receives a newer version and when the owner goes back to an earlier one. The rule is the same
   both ways: every record stays. A field that was renamed keeps its values under the new name. A field or a list the
   other version does not have is put away in a holding table inside the same database, and comes back by itself when
   a later version has that field or list again. Nothing is copied unless everything can be: one failure and the
   database that was being filled is left exactly as it was. */

/** The holding table. `column_name` is '*' for a whole record of a list the version does not have. */
export const AWAY = 'tk_put_away';
export const AWAY_SQL =
  'CREATE TABLE IF NOT EXISTS ' +
  qi(AWAY) +
  ' ("table_name" TEXT NOT NULL, "column_name" TEXT NOT NULL, "row_id" INTEGER NOT NULL, "value", "at" TEXT NOT NULL, PRIMARY KEY ("table_name", "column_name", "row_id"))';
/** Put-away values are kept this long. */
export const AWAY_DAYS = 30;

/** What an update kept. */
export interface Carried {
  tables: number;
  /** records copied */
  rows: number;
  /** values and records put away, because this version has no place for them */
  away: number;
  /** values and records that came back from being put away */
  back: number;
}

const hasTable = (id: string, t: string) =>
  sqlRows(id, "SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", [t], 'update').length > 0;
const columns = (id: string, t: string) => sqlRows(id, 'PRAGMA table_info(' + qi(t) + ')', null, 'update').map((c) => String(c.name));

/** How many values and records are put away in an app's database. */
export function awayCount(appId: string): number {
  try {
    if (!dbExists(appId) || !hasTable(appId, AWAY)) return 0;
    return Number(sqlRows(appId, 'SELECT COUNT(*) AS n FROM ' + qi(AWAY), null, 'update')[0]?.n || 0);
  } catch {
    return 0;
  }
}

/**
 * Copies the records of `from` into the database of `to`, following `steps` (what changed between the two versions).
 * Returns what was kept, or null when the records could not all be moved: `to` is then unchanged.
 */
export function carryData(from: AppRecord, to: AppRecord, steps: RecordStep[] = []): Carried | null {
  const kept: Carried = { tables: 0, rows: 0, away: 0, back: 0 },
    now = new Date().toISOString(),
    run = (text: string, params?: SqlValue[]) => sqlRun(to.id, text, params || null, 'update') as { changes: number };
  let made = false;
  const holding = () => {
    if (!made) run(AWAY_SQL);
    made = true;
  };
  const putAway = (table: string, column: string, id: unknown, value: unknown) => {
    holding();
    run('INSERT OR REPLACE INTO ' + qi(AWAY) + ' ("table_name", "column_name", "row_id", "value", "at") VALUES (?, ?, ?, ?, ?)', [
      table,
      column,
      Number(id),
      value as SqlValue,
      now,
    ]);
    kept.away++;
  };
  dbSavepoint(to.id, 'carry');
  try {
    run('PRAGMA defer_foreign_keys = ON'); // a record may point at one that is copied after it
    // what this device put away earlier travels with it, unless it is older than the promise to keep it
    if (hasTable(from.id, AWAY)) {
      const limit = new Date(Date.now() - AWAY_DAYS * 86400000).toISOString();
      sqlRows(from.id, 'SELECT * FROM ' + qi(AWAY) + ' WHERE "at" >= ?', [limit], 'update').forEach((r) => {
        holding();
        run('INSERT OR REPLACE INTO ' + qi(AWAY) + ' ("table_name", "column_name", "row_id", "value", "at") VALUES (?, ?, ?, ?, ?)', [
          r.table_name,
          r.column_name,
          r.row_id,
          r.value,
          r.at,
        ]);
      });
    }
    const inFrom = (name: string) => from.def.tables.find((x) => x.name === name);
    topoOrder(to.def.tables)
      .reverse()
      .forEach((t) => {
        if (inFrom(t.name)) run('DELETE FROM ' + qi(t.name));
      });
    topoOrder(to.def.tables).forEach((t) => {
      const src = inFrom(t.name),
        toCols = columns(to.id, t.name);
      if (!src) {
        // a list this copy does not have now: records put away for it, when it was taken out, come back
        if (!made) return;
        const back = sqlRows(to.id, 'SELECT "row_id", "value" FROM ' + qi(AWAY) + ' WHERE "table_name" = ? AND "column_name" = ?', [
          t.name,
          '*',
        ]);
        if (!back.length) return;
        run('DELETE FROM ' + qi(t.name));
        back.forEach((b) => {
          let row: SqlRow;
          try {
            row = JSON.parse(String(b.value)) as SqlRow;
          } catch {
            return;
          }
          const cols = toCols.filter((c) => c in row);
          run(
            'INSERT INTO ' + qi(t.name) + ' (' + cols.map(qi).join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')',
            cols.map((c) => row[c]),
          );
          kept.back++;
        });
        run('DELETE FROM ' + qi(AWAY) + ' WHERE "table_name" = ? AND "column_name" = ?', [t.name, '*']);
        return;
      }
      const plan = columnPlan(steps, t.name, columns(from.id, t.name), toCols),
        rows = sqlRows(from.id, 'SELECT * FROM ' + qi(t.name) + ' ORDER BY "id"', null, 'update'),
        own = new Set(src.columns.map((c) => c.name));
      const list: SqlValue[][] = rows.map((r) =>
        plan.pairs.map((p): SqlValue => {
          const raw = r[p.from];
          if (!p.choice) return raw;
          // text that became a choice: the same rewrite the owner's draft ran; a value that is not one of the choices is put away
          const c = colOf(t, p.to),
            v = choiceValue(raw) as SqlValue;
          if (v == null || v === '' || !c || !c.options || c.options.includes(String(v))) return v;
          putAway(t.name, p.to, r.id, raw);
          return c.required ? c.options[0] : null;
        }),
      );
      if (list.length && plan.pairs.length)
        sqlMany(
          to.id,
          'INSERT INTO ' +
            qi(t.name) +
            ' (' +
            plan.pairs.map((p) => qi(p.to)).join(', ') +
            ') VALUES (' +
            plan.pairs.map(() => '?').join(', ') +
            ')',
          list,
          'update',
        );
      kept.rows += list.length;
      // fields this version does not have: their values are put away, not deleted
      plan.away
        .filter((c) => own.has(c))
        .forEach((c) =>
          rows.forEach((r) => {
            if (r[c] != null && r[c] !== '') putAway(t.name, c, r.id, r[c]);
          }),
        );
      // fields this version has again: the values put away under that name come back
      if (made)
        plan.back.forEach((c) => {
          try {
            kept.back += bringBackColumn(to.id, t.name, c);
          } catch {
            // the values do not fit the field as it is now (a choice they are not part of): they stay put away
          }
        });
      kept.tables++;
    });
    // whole lists this version does not have: every record is put away as it is
    from.def.tables
      .filter((t) => !to.def.tables.some((x) => x.name === t.name))
      .forEach((t) =>
        sqlRows(from.id, 'SELECT * FROM ' + qi(t.name) + ' ORDER BY "id"', null, 'update').forEach((r) =>
          putAway(t.name, '*', r.id, JSON.stringify(r)),
        ),
      );
    // the activity history belongs to the records, so it comes too when both copies keep one the same way
    if (hasTable(from.id, 'activity') && hasTable(to.id, 'activity')) {
      const cols = columns(to.id, 'activity').filter((c) => columns(from.id, 'activity').includes(c));
      run('DELETE FROM "activity"');
      sqlMany(
        to.id,
        'INSERT INTO "activity" (' + cols.map(qi).join(', ') + ') VALUES (' + cols.map(() => '?').join(', ') + ')',
        sqlRows(from.id, 'SELECT * FROM "activity" ORDER BY "id"', null, 'update').map((r) => cols.map((c) => r[c])),
        'update',
      );
    }
    dbRelease(to.id, 'carry');
  } catch (e) {
    console.warn('Records could not be carried over: ' + errText(e));
    dbRollback(to.id, 'carry');
    return null;
  }
  return kept;
}

/* ---------- the same two moves inside the owner's draft ---------- */
/** Puts the values of one field away, just before the draft removes the field. Returns how many. */
export function putAwayColumn(appId: string, table: string, column: string): number {
  sqlRun(appId, AWAY_SQL, null, 'database');
  return (
    sqlRun(
      appId,
      'INSERT OR REPLACE INTO ' +
        qi(AWAY) +
        ' ("table_name", "column_name", "row_id", "value", "at") SELECT ?, ?, "id", ' +
        qi(column) +
        ', ? FROM ' +
        qi(table) +
        ' WHERE ' +
        qi(column) +
        ' IS NOT NULL AND ' +
        qi(column) +
        " <> ''",
      [table, column, new Date().toISOString()],
      'database',
    ) as { changes: number }
  ).changes;
}
/** Brings back the values put away under a field's name, just after the draft adds that field again. Returns how many. */
export function bringBackColumn(appId: string, table: string, column: string): number {
  if (!hasTable(appId, AWAY)) return 0;
  const n = (
    sqlRun(
      appId,
      'UPDATE ' +
        qi(table) +
        ' SET ' +
        qi(column) +
        ' = (SELECT "value" FROM ' +
        qi(AWAY) +
        ' WHERE "table_name" = ? AND "column_name" = ? AND "row_id" = ' +
        qi(table) +
        '."id") WHERE "id" IN (SELECT "row_id" FROM ' +
        qi(AWAY) +
        ' WHERE "table_name" = ? AND "column_name" = ?)',
      [table, column, table, column],
      'database',
    ) as { changes: number }
  ).changes;
  if (n) sqlRun(appId, 'DELETE FROM ' + qi(AWAY) + ' WHERE "table_name" = ? AND "column_name" = ?', [table, column], 'database');
  return n;
}

/* ---------- the safety copy ---------- */
/* Before an update changes the records on a device, the database file as it was is kept, one copy per app. It can be
   saved as a file from About this app. */
export interface SafetyCopy {
  ver: string;
  at: number;
  rows: number;
  /** the SQLite file, base64 */
  db: string;
}
const safeKey = (appId: string) => 'safe:' + appId;
export function keepSafetyCopy(from: AppRecord, forApp: AppRecord, ver: string, rows: number): boolean {
  try {
    return LS.set(safeKey(forApp.id), JSON.stringify({ ver, at: Date.now(), rows, db: b64.enc(dbBytes(from.id)) }));
  } catch {
    return false;
  }
}
export function safetyCopyOf(appId: string): SafetyCopy | null {
  try {
    const x = JSON.parse(LS.get(safeKey(appId)) || 'null') as Partial<SafetyCopy> | null;
    return x && typeof x.db === 'string' && x.db
      ? { ver: String(x.ver || ''), at: Number(x.at) || 0, rows: Number(x.rows) || 0, db: x.db }
      : null;
  } catch {
    return null;
  }
}
export const dropSafetyCopy = (appId: string) => LS.del(safeKey(appId));

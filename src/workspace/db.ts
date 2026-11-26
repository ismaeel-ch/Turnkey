// @ts-nocheck -- converted from the prototype; types are added module by module
import { loadSqlite } from '@/platform/sqlite';
import { BRAND, LS, SQLLOG, notify, nowStamp, ring, toast } from './core';

/* ===== Turnkey prototype · SQLite in the browser (sql.js), saved into browser storage ===== */
export const DBX = {
  SQL: null,
  open: {},
  size: {},
  savedAt: {},
  timers: {},
  hold: {},
  ver: {},
  warned: false,
};
export async function initSqlite() {
  DBX.SQL = await loadSqlite();
}
export const b64 = {
  enc(u8) {
    let s = '';
    const n = 0x8000;
    for (let i = 0; i < u8.length; i += n) s += String.fromCharCode.apply(null, u8.subarray(i, i + n));
    return btoa(s);
  },
  dec(text) {
    const bin = atob(text);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  },
};
export const dbBump = (appId) => {
  DBX.ver[appId] = (DBX.ver[appId] || 0) + 1;
};
export function dbOpen(appId) {
  let db = DBX.open[appId];
  if (db) return db;
  const raw = LS.get('db:' + appId);
  db = raw ? new DBX.SQL.Database(b64.dec(raw)) : new DBX.SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  DBX.open[appId] = db;
  if (raw) DBX.size[appId] = Math.floor((raw.length * 3) / 4);
  return db;
}
export function dbFlush(appId) {
  // write the whole SQLite file into browser storage
  clearTimeout(DBX.timers[appId]);
  DBX.timers[appId] = null;
  const db = DBX.open[appId];
  if (!db) return;
  if (DBX.hold[appId]) {
    DBX.timers[appId] = setTimeout(() => dbFlush(appId), 400);
    return;
  }
  const u8 = db.export();
  db.run('PRAGMA foreign_keys = ON'); // export reopens the file, so the pragma is set again
  DBX.size[appId] = u8.length;
  if (LS.set('db:' + appId, b64.enc(u8))) DBX.savedAt[appId] = Date.now();
  else if (!DBX.warned) {
    DBX.warned = true;
    toast('Browser storage is full. New changes may not be kept. Delete an app or reset data.', 'danger', 8000);
  }
  notify();
}
export function dbSave(appId) {
  if (!DBX.timers[appId]) DBX.timers[appId] = setTimeout(() => dbFlush(appId), 350);
}
export function dbDrop(appId) {
  clearTimeout(DBX.timers[appId]);
  DBX.timers[appId] = null;
  DBX.hold[appId] = 0;
  const db = DBX.open[appId];
  if (db) {
    try {
      db.close();
    } catch (e) {}
  }
  delete DBX.open[appId];
  delete DBX.size[appId];
  delete DBX.savedAt[appId];
  LS.del('db:' + appId);
  dbBump(appId);
}
export const isRead = (text) => /^\s*(select|pragma|with|explain)\b/i.test(text);
export function sqlRun(appId, text, params, by) {
  // every statement the product runs goes through here and is logged
  const db = dbOpen(appId);
  const t0 = performance.now();
  let rows = null,
    changes = 0,
    err = null;
  try {
    if (isRead(text)) {
      const st = db.prepare(text);
      try {
        if (params && params.length) st.bind(params);
        rows = [];
        while (st.step()) rows.push(st.getAsObject());
      } finally {
        st.free();
      }
    } else {
      db.run(text, params && params.length ? params : undefined);
      changes = db.getRowsModified();
      dbBump(appId);
      dbSave(appId);
    }
  } catch (e) {
    err = String((e && e.message) || e);
  }
  ring(
    SQLLOG,
    {
      t: Date.now(),
      app: appId,
      sql: text,
      params: params && params.length ? params.slice(0, 12) : null,
      ms: performance.now() - t0,
      rows: rows ? rows.length : null,
      changes,
      by: by || 'api',
      err,
    },
    500,
  );
  if (err) {
    const e = new Error(err);
    e.sql = text;
    throw e;
  }
  return (
    rows || {
      changes,
    }
  );
}
export function sqlMany(appId, text, list, by) {
  // one prepared statement, many rows (seed data)
  const db = dbOpen(appId);
  const t0 = performance.now();
  let n = 0,
    err = null;
  const st = db.prepare(text);
  try {
    for (const p of list) {
      try {
        st.run(p);
        n++;
      } catch (e) {
        err = 'row ' + (n + 1) + ': ' + ((e && e.message) || e);
        break;
      }
    }
  } finally {
    st.free();
  }
  dbBump(appId);
  dbSave(appId);
  ring(
    SQLLOG,
    {
      t: Date.now(),
      app: appId,
      sql: text,
      params: null,
      many: list.length,
      ms: performance.now() - t0,
      rows: null,
      changes: n,
      by: by || 'api',
      err,
    },
    500,
  );
  if (err) throw new Error(err);
  return n;
}
export const PEEK = new Map();
export function sqlPeek(appId, text, params) {
  // unlogged, cached read for the builder's own panels
  const key = appId + '|' + (DBX.ver[appId] || 0) + '|' + text + '|' + JSON.stringify(params || []);
  if (PEEK.has(key)) return PEEK.get(key);
  if (PEEK.size > 300) PEEK.clear();
  let rows = [];
  try {
    const st = dbOpen(appId).prepare(text);
    try {
      if (params && params.length) st.bind(params);
      while (st.step()) rows.push(st.getAsObject());
    } finally {
      st.free();
    }
  } catch (e) {
    rows = [];
  }
  PEEK.set(key, rows);
  return rows;
}
export const lastId = (appId) => {
  const r = dbOpen(appId).exec('SELECT last_insert_rowid()');
  return r[0].values[0][0];
};
export function dbSavepoint(appId, name) {
  dbOpen(appId).run('SAVEPOINT ' + name);
  DBX.hold[appId] = (DBX.hold[appId] || 0) + 1;
}
export function dbRollback(appId, name) {
  const db = dbOpen(appId);
  db.run('ROLLBACK TO ' + name);
  db.run('RELEASE ' + name);
  DBX.hold[appId] = Math.max(0, (DBX.hold[appId] || 1) - 1);
  dbBump(appId);
}
export function dbRelease(appId, name) {
  dbOpen(appId).run('RELEASE ' + name);
  DBX.hold[appId] = Math.max(0, (DBX.hold[appId] || 1) - 1);
  dbBump(appId);
  dbSave(appId);
}
export const dbExists = (appId) => !!DBX.open[appId] || !!LS.get('db:' + appId);
export function dbTables(appId) {
  return dbExists(appId)
    ? sqlPeek(appId, "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid")
    : [];
}
export function dbCount(appId, table) {
  const r = sqlPeek(appId, 'SELECT COUNT(*) AS n FROM ' + qi(table));
  return r[0] ? r[0].n : 0;
}
export function dbBytes(appId) {
  const db = dbOpen(appId);
  const u8 = db.export();
  db.run('PRAGMA foreign_keys = ON');
  return u8;
}
export function dbDump(appId) {
  // plain SQL text of the whole database
  const out = ['-- ' + BRAND.name + ' export, ' + nowStamp(), 'PRAGMA foreign_keys = OFF;', 'BEGIN;'];
  dbTables(appId).forEach((t) => {
    out.push('', t.sql + ';');
    const rows = sqlPeek(appId, 'SELECT * FROM ' + qi(t.name));
    rows.forEach((r) =>
      out.push(
        'INSERT INTO ' + qi(t.name) + ' (' + Object.keys(r).map(qi).join(', ') + ') VALUES (' + Object.values(r).map(ql).join(', ') + ');',
      ),
    );
  });
  out.push('', 'COMMIT;', 'PRAGMA foreign_keys = ON;');
  return out.join('\n');
}

/* ---------- definitions to SQL ---------- */
export const qi = (n) => '"' + String(n).replace(/"/g, '""') + '"';
export const ql = (v) => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'");
export const SQLT = {
  text: 'TEXT',
  longtext: 'TEXT',
  select: 'TEXT',
  date: 'TEXT',
  datetime: 'TEXT',
  number: 'NUMERIC',
  money: 'REAL',
  bool: 'INTEGER',
  ref: 'INTEGER',
  user: 'INTEGER',
};
export function colSQL(c, forAlter) {
  let s = qi(c.name) + ' ' + (SQLT[c.type] || 'TEXT');
  if (c.required && !forAlter) s += ' NOT NULL';
  if (c.type === 'bool') s += ' DEFAULT 0';
  if (c.type === 'select' && c.options && c.options.length) s += ' CHECK (' + qi(c.name) + ' IN (' + c.options.map(ql).join(', ') + '))';
  if (c.type === 'ref') s += ' REFERENCES ' + qi(c.ref) + '("id")';
  if (c.type === 'user') s += ' REFERENCES "users"("id")';
  return s;
}
export function createTableSQL(t) {
  const lines = ['"id" INTEGER PRIMARY KEY AUTOINCREMENT'].concat(
    t.columns.map((c) => colSQL(c)),
    ['"created_by" INTEGER REFERENCES "users"("id")', '"created_at" TEXT'],
  );
  return 'CREATE TABLE ' + qi(t.name) + ' (\n  ' + lines.join(',\n  ') + '\n)';
}
export const SYS_SQL = [
  'CREATE TABLE "users" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT,\n  "name" TEXT NOT NULL,\n  "username" TEXT NOT NULL UNIQUE,\n  "password" TEXT NOT NULL,\n  "role" TEXT NOT NULL\n)',
  'CREATE TABLE "activity" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT,\n  "at" TEXT NOT NULL,\n  "user_id" INTEGER REFERENCES "users"("id"),\n  "table_name" TEXT NOT NULL,\n  "row_id" INTEGER,\n  "action" TEXT NOT NULL,\n  "detail" TEXT\n)',
];
export function topoOrder(tables) {
  // parents before children, so seed rows can point at earlier rows
  const left = tables.slice(),
    out = [],
    names = new Set();
  while (left.length) {
    const i = left.findIndex((t) => t.columns.every((c) => c.type !== 'ref' || c.ref === t.name || names.has(c.ref)));
    const t = left.splice(i < 0 ? 0 : i, 1)[0];
    out.push(t);
    names.add(t.name);
  }
  return out;
}

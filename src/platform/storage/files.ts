import { decodeBase64, encodeBase64 } from './base64';

/** What the export and import functions need from a storage: the `LS` surface. `TurnkeyStorage` and `LS` both fit. */
export interface KeyValueStore {
  get(k: string): string | null;
  set(k: string, v: string): boolean;
  del(k: string): void;
  keys(): string[];
}

const SQLITE_MAGIC = 'SQLite format 3\u0000';

export class DataFileError extends Error {
  constructor(
    message: string,
    readonly code: 'not_sqlite' | 'damaged' | 'no_app' | 'not_a_backup' | 'wrong_version' | 'storage_full' | 'bad_id',
  ) {
    super(message);
    this.name = 'DataFileError';
  }
}

export const isSqliteFile = (u8: Uint8Array): boolean =>
  u8.length >= 100 && SQLITE_MAGIC.split('').every((c, i) => u8[i] === c.charCodeAt(0));
const dbKey = (appId: string) => 'db:' + appId;
const APP_ID = /^[A-Za-z0-9_-]{1,64}$/;

/* ---------- one app's database as a .sqlite file ---------- */

/** The SQLite file of one app, byte for byte what the workspace's `dbBytes` would give, or null when the app has none. */
export function exportAppSqlite(store: KeyValueStore, appId: string): Uint8Array | null {
  const raw = store.get(dbKey(appId));
  if (!raw) return null;
  try {
    return decodeBase64(raw);
  } catch {
    throw new DataFileError('The saved database of this app is damaged and cannot be exported.', 'damaged');
  }
}

/** A file name for the download: `<app name>.sqlite`, safe on every system. */
export const sqliteFileName = (appName: string): string =>
  (String(appName || 'app')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'app') + '.sqlite';

/** The part of sql.js this module uses, so tests and the browser can pass either build. */
export interface SqlJsLike {
  Database: new (data?: Uint8Array) => {
    exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
    close(): void;
  };
}

export interface ImportCheck {
  tables: string[];
  rows: number;
  integrity: string;
}

/**
 * Looks inside a SQLite file without keeping it: runs `PRAGMA integrity_check` and `foreign_key_check`, and lists the
 * tables. Throws a `DataFileError` when it is not a SQLite file or does not open.
 */
export function inspectSqlite(SQL: SqlJsLike, bytes: Uint8Array): ImportCheck {
  if (!isSqliteFile(bytes)) throw new DataFileError('That file is not a SQLite database.', 'not_sqlite');
  let db: InstanceType<SqlJsLike['Database']> | null = null;
  try {
    db = new SQL.Database(bytes);
    const integrity = String(db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] ?? '');
    if (integrity !== 'ok') throw new DataFileError('The database file is damaged: ' + integrity, 'damaged');
    const tables = (
      db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid")[0]?.values || []
    ).map((r) => String(r[0]));
    let rows = 0;
    for (const t of tables) rows += Number(db.exec('SELECT COUNT(*) FROM "' + t.replace(/"/g, '""') + '"')[0]?.values[0]?.[0] || 0);
    return { tables, rows, integrity };
  } catch (e) {
    if (e instanceof DataFileError) throw e;
    throw new DataFileError('That file could not be opened as a database: ' + String((e as Error)?.message || e), 'damaged');
  } finally {
    try {
      db?.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Puts a .sqlite file in as an app's database. The app must already exist in the workspace state (the caller checks;
 * this function only stores the file). With `SQL` the file is opened and checked first, and it must contain the tables
 * in `mustHave` (the app's own table names plus `users` and `activity`). The workspace has to drop its open copy of the
 * database and reopen it after this (`dbDrop` keeps the stored file only if it is not deleted afterwards; `DBX.open[id]`
 * must be closed and removed first). Returns what the file holds.
 */
export function importAppSqlite(
  store: KeyValueStore,
  appId: string,
  bytes: Uint8Array,
  opts: { SQL?: SqlJsLike; mustHave?: string[] } = {},
): ImportCheck | null {
  if (!APP_ID.test(appId)) throw new DataFileError('That is not a valid app id.', 'bad_id');
  if (!isSqliteFile(bytes)) throw new DataFileError('That file is not a SQLite database.', 'not_sqlite');
  let info: ImportCheck | null = null;
  if (opts.SQL) {
    info = inspectSqlite(opts.SQL, bytes);
    const missing = (opts.mustHave || []).filter((t) => !info!.tables.includes(t));
    if (missing.length)
      throw new DataFileError('That database does not belong to this app. Missing tables: ' + missing.join(', ') + '.', 'damaged');
  }
  const previous = store.get(dbKey(appId));
  if (!store.set(dbKey(appId), encodeBase64(bytes))) {
    if (previous != null) store.set(dbKey(appId), previous);
    throw new DataFileError(
      'Browser storage is full, so the database was not imported. Delete an app or export and clear some data first.',
      'storage_full',
    );
  }
  return info;
}

/* ---------- the whole workspace as one JSON file ---------- */

export const BACKUP_FORMAT = 'turnkey-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  f: typeof BACKUP_FORMAT;
  v: typeof BACKUP_VERSION;
  /** ISO time the backup was made */
  at: string;
  /** every stored value by its key without the namespace: `state`, `db:<appId>` (base64). Exactly as stored. */
  items: Record<string, string>;
}

/** Everything the workspace stored, as a plain object ready for `JSON.stringify`. Keys that are not strings are impossible: storage holds strings. */
export function createBackup(store: KeyValueStore, now: Date = new Date()): Backup {
  const items: Record<string, string> = {};
  for (const k of store.keys()) {
    const v = store.get(k);
    if (v != null) items[k] = v;
  }
  return { f: BACKUP_FORMAT, v: BACKUP_VERSION, at: now.toISOString(), items };
}

export const backupFileName = (now: Date = new Date()): string => 'turnkey-backup-' + now.toISOString().slice(0, 10) + '.json';

/** Reads and checks backup text. Throws a `DataFileError` with a plain message. */
export function parseBackup(text: string): Backup {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    throw new DataFileError('That file is not a Turnkey backup. It is not valid JSON.', 'not_a_backup');
  }
  const b = o as Partial<Backup> | null;
  if (!b || typeof b !== 'object' || b.f !== BACKUP_FORMAT || !b.items || typeof b.items !== 'object' || Array.isArray(b.items))
    throw new DataFileError('That file is not a Turnkey backup.', 'not_a_backup');
  if (b.v !== BACKUP_VERSION)
    throw new DataFileError('That backup is from a different version of Turnkey and cannot be read.', 'wrong_version');
  for (const [k, v] of Object.entries(b.items)) {
    if (typeof v !== 'string') throw new DataFileError('The backup is damaged: "' + k + '" is not text.', 'damaged');
    if (!(k === 'state' || (k.startsWith('db:') && APP_ID.test(k.slice(3)))))
      throw new DataFileError('The backup holds something Turnkey does not store: "' + k + '".', 'not_a_backup');
  }
  const state = b.items.state;
  if (state !== undefined) {
    try {
      const s = JSON.parse(state);
      if (!s || s.v !== 1) throw new Error('version');
    } catch {
      throw new DataFileError('The workspace state in the backup is damaged.', 'damaged');
    }
  }
  return b as Backup;
}

export interface RestoreResult {
  written: string[];
  removed: string[];
}

/**
 * Puts a backup back. `replace` (default) makes the store match the backup: keys not in it are deleted.
 * `merge` only adds and overwrites. If storage fills up part way, every key already changed is put back as it was and
 * a `DataFileError` is thrown, so a failed restore leaves the workspace as it was. The workspace must reload afterwards,
 * because it holds the state and the open databases in memory.
 */
export function restoreBackup(store: KeyValueStore, backup: Backup, mode: 'replace' | 'merge' = 'replace'): RestoreResult {
  const before = new Map<string, string | null>();
  const touch = (k: string) => {
    if (!before.has(k)) before.set(k, store.get(k));
  };
  const undo = () => {
    for (const [k, v] of before) {
      if (v == null) store.del(k);
      else store.set(k, v);
    }
  };
  const written: string[] = [];
  const removed: string[] = [];
  const incoming = Object.keys(backup.items);
  if (mode === 'replace')
    for (const k of store.keys())
      if (!(k in backup.items)) {
        touch(k);
        store.del(k);
        removed.push(k);
      }
  for (const k of incoming) {
    touch(k);
    if (!store.set(k, backup.items[k])) {
      undo();
      throw new DataFileError('Browser storage is full, so nothing was restored. Your data is as it was.', 'storage_full');
    }
    written.push(k);
  }
  return { written, removed };
}

/** Convenience for the browser: the backup as a Blob-ready string. */
export const backupToText = (store: KeyValueStore, now?: Date): string => JSON.stringify(createBackup(store, now));

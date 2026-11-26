// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { schemaSql, normalizeTables, type TableDef } from '@/shared/sql';
import {
  DataFileError,
  backupToText,
  createBackup,
  decodeBase64,
  encodeBase64,
  exportAppSqlite,
  importAppSqlite,
  inspectSqlite,
  isSqliteFile,
  openStorage,
  parseBackup,
  restoreBackup,
  sqliteFileName,
  type KeyValueStore,
  type SqlJsLike,
} from '@/platform/storage';
import { savedBuilds } from '../sql/legacy-records';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js/dist/sql-wasm.js');

interface TestDb {
  run(s: string): void;
  export(): Uint8Array;
  exec(s: string): Array<{ values: unknown[][] }>;
  close(): void;
}
interface TestSql extends SqlJsLike {
  Database: new (d?: Uint8Array) => TestDb & InstanceType<SqlJsLike['Database']>;
}

async function sqlJs() {
  return (await initSqlJs()) as TestSql;
}

/** An app database built the way the workspace builds it: system tables, the app's tables, a few rows. */
async function clinicDb() {
  const SQL = await sqlJs();
  const b = savedBuilds().find((x) => x.id === 'clinic')!;
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  for (const s of schemaSql(normalizeTables(b.database.tables) as TableDef[])) db.run(s);
  db.run(`INSERT INTO "users" ("name","username","password","role") VALUES ('Dr Sample','sample','demo','doctor')`);
  db.run(`INSERT INTO "patients" ("full_name") VALUES ('Zara Ahmed'), ('Omar Siddiqui')`);
  const bytes = db.export();
  db.close();
  return { SQL, bytes };
}

const mapStore = (limit = Infinity): KeyValueStore & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return {
    m,
    get: (k) => m.get(k) ?? null,
    set: (k, v) => {
      const total = [...m].reduce((n, [a, b]) => n + (a === k ? 0 : a.length + b.length), 0) + k.length + v.length;
      if (total > limit) return false;
      m.set(k, v);
      return true;
    },
    del: (k) => void m.delete(k),
    keys: () => [...m.keys()].sort(),
  };
};

describe('base64', () => {
  it('round-trips bytes, including big ones', () => {
    const u8 = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(decodeBase64(encodeBase64(u8))).toEqual(u8);
    expect(encodeBase64(new TextEncoder().encode('SQLite'))).toBe(btoa('SQLite'));
  });
});

describe('one app as a .sqlite file', () => {
  it('exports exactly the stored file and imports it back into another workspace', async () => {
    const { SQL, bytes } = await clinicDb();
    expect(isSqliteFile(bytes)).toBe(true);
    const a = mapStore();
    a.set('db:app_1', encodeBase64(bytes));
    const file = exportAppSqlite(a, 'app_1')!;
    expect(file).toEqual(bytes);
    expect(exportAppSqlite(a, 'nope')).toBeNull();

    const b = mapStore();
    const info = importAppSqlite(b, 'app_9', file, { SQL, mustHave: ['users', 'activity', 'patients'] })!;
    expect(info.tables).toEqual(expect.arrayContaining(['users', 'activity', 'patients', 'appointments', 'visit_notes']));
    expect(info.rows).toBe(3);
    expect(info.integrity).toBe('ok');
    const again = new SQL.Database(decodeBase64(b.get('db:app_9')!));
    expect(again.exec('SELECT full_name FROM patients ORDER BY id')[0].values.flat()).toEqual(['Zara Ahmed', 'Omar Siddiqui']);
  });

  it('works through the real storage adapter and a reload', async () => {
    const { bytes } = await clinicDb();
    const idb = new IDBFactory();
    const s = await openStorage({ indexedDB: idb, localStorage: null, saveDelay: 5 });
    importAppSqlite(s, 'app_1', bytes);
    await s.flush();
    s.close();
    const s2 = await openStorage({ indexedDB: idb, localStorage: null });
    expect(exportAppSqlite(s2, 'app_1')).toEqual(bytes);
  });

  it('refuses things that are not a database, a database of another app, and a full store', async () => {
    const { SQL, bytes } = await clinicDb();
    const st = mapStore();
    expect(() => importAppSqlite(st, 'a1', new TextEncoder().encode('hello'))).toThrowError(
      expect.objectContaining({ code: 'not_sqlite' }),
    );
    expect(() => importAppSqlite(st, 'a1', bytes, { SQL, mustHave: ['tickets'] })).toThrowError(
      expect.objectContaining({ code: 'damaged' }),
    );
    expect(() => importAppSqlite(st, '../x', bytes)).toThrowError(expect.objectContaining({ code: 'bad_id' }));
    expect(st.keys()).toEqual([]);
    const tiny = mapStore(50);
    tiny.set('db:a1', 'old');
    expect(() => importAppSqlite(tiny, 'a1', bytes)).toThrowError(expect.objectContaining({ code: 'storage_full' }));
    expect(tiny.get('db:a1')).toBe('old');
  });

  it('notices a damaged file', async () => {
    const { SQL, bytes } = await clinicDb();
    const bad = bytes.slice();
    for (let i = 4096; i < bad.length; i++) bad[i] = 0xff;
    expect(() => inspectSqlite(SQL, bad)).toThrow(DataFileError);
  });

  it('names the download safely', () => {
    expect(sqliteFileName('CareDesk: Clinic / Visits!')).toBe('caredesk-clinic-visits.sqlite');
    expect(sqliteFileName('')).toBe('app.sqlite');
  });
});

describe('whole-workspace backup', () => {
  const fill = (s: KeyValueStore) => {
    s.set('state', JSON.stringify({ v: 1, apps: { app_1: { name: 'CareDesk' } } }));
    s.set('db:app_1', 'QUJD');
    s.set('db:app_2', 'REVG');
  };

  it('is one JSON file with every key, and restores into an empty workspace exactly', () => {
    const a = mapStore();
    fill(a);
    const text = backupToText(a, new Date('2026-11-26T10:00:00Z'));
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({ f: 'turnkey-backup', v: 1, at: '2026-11-26T10:00:00.000Z' });
    expect(Object.keys(parsed.items).sort()).toEqual(['db:app_1', 'db:app_2', 'state']);
    const b = mapStore();
    const r = restoreBackup(b, parseBackup(text));
    expect(r.written.sort()).toEqual(['db:app_1', 'db:app_2', 'state']);
    expect(b.m).toEqual(a.m);
  });

  it('replace removes what the backup does not have; merge keeps it', () => {
    const src = mapStore();
    src.set('state', JSON.stringify({ v: 1 }));
    const backup = createBackup(src);
    const a = mapStore();
    fill(a);
    const merged = restoreBackup(a, backup, 'merge');
    expect(merged.removed).toEqual([]);
    expect(a.keys()).toEqual(['db:app_1', 'db:app_2', 'state']);
    const replaced = restoreBackup(a, backup, 'replace');
    expect(replaced.removed.sort()).toEqual(['db:app_1', 'db:app_2']);
    expect(a.keys()).toEqual(['state']);
  });

  it('a restore that does not fit leaves the workspace as it was', () => {
    const src = mapStore();
    fill(src);
    src.set('db:app_3', 'x'.repeat(500));
    const backup = createBackup(src);
    const small = mapStore(120);
    small.set('state', JSON.stringify({ v: 1, mine: true }));
    small.set('db:mine', 'keep');
    const before = new Map(small.m);
    expect(() => restoreBackup(small, backup)).toThrowError(expect.objectContaining({ code: 'storage_full' }));
    expect(small.m).toEqual(before);
  });

  it('rejects files that are not backups, are from another version, or hold strange keys', () => {
    expect(() => parseBackup('not json')).toThrowError(expect.objectContaining({ code: 'not_a_backup' }));
    expect(() => parseBackup('{"f":"other"}')).toThrowError(expect.objectContaining({ code: 'not_a_backup' }));
    expect(() => parseBackup('{"f":"turnkey-backup","v":2,"items":{}}')).toThrowError(expect.objectContaining({ code: 'wrong_version' }));
    expect(() => parseBackup('{"f":"turnkey-backup","v":1,"items":{"evil":"x"}}')).toThrowError(
      expect.objectContaining({ code: 'not_a_backup' }),
    );
    expect(() => parseBackup('{"f":"turnkey-backup","v":1,"items":{"db:../x":"x"}}')).toThrowError(
      expect.objectContaining({ code: 'not_a_backup' }),
    );
    expect(() => parseBackup('{"f":"turnkey-backup","v":1,"items":{"db:a":5}}')).toThrowError(expect.objectContaining({ code: 'damaged' }));
    expect(() => parseBackup('{"f":"turnkey-backup","v":1,"items":{"state":"{oops"}}')).toThrowError(
      expect.objectContaining({ code: 'damaged' }),
    );
  });

  it('works through the real adapter: backup from one browser, restore in another after a reload', async () => {
    const a = await openStorage({ indexedDB: new IDBFactory(), localStorage: null, saveDelay: 5 });
    fill(a);
    const text = backupToText(a);
    const idb = new IDBFactory();
    const b = await openStorage({ indexedDB: idb, localStorage: null, saveDelay: 5 });
    restoreBackup(b, parseBackup(text));
    await b.flush();
    b.close();
    const c = await openStorage({ indexedDB: idb, localStorage: null });
    expect(c.entries()).toEqual(a.entries());
  });
});

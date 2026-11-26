/**
 * Where version histories are kept: one IndexedDB record per app, in a database of its own (`turnkey-history`),
 * apart from the workspace's own storage. Histories hold copies of each app's database file, so they are large and
 * must not count against what the workspace itself saves.
 *
 * When IndexedDB is blocked or missing, histories live in memory until the tab closes. Nothing here throws: a failed
 * read is an empty history and a failed write is reported through the returned promise as `false`.
 */

const DB_NAME = 'turnkey-history';
const STORE = 'apps';

export interface HistoryDb {
  get(appId: string): Promise<unknown>;
  put(appId: string, value: unknown): Promise<boolean>;
  del(appId: string): Promise<boolean>;
  keys(): Promise<string[]>;
  /** false when histories will not survive closing the tab */
  durable: boolean;
}

/** Keeps histories in a Map. Used when IndexedDB is not available, and in tests. */
export function memoryHistoryDb(): HistoryDb {
  const m = new Map<string, unknown>();
  return {
    durable: false,
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => (m.set(k, v), true),
    del: async (k) => m.delete(k) || true,
    keys: async () => [...m.keys()],
  };
}

const done = <T>(req: IDBRequest<T>) =>
  new Promise<T>((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });

/** Opens the history database. Falls back to memory when IndexedDB cannot be opened. */
export async function openHistoryDb(factory?: IDBFactory | null): Promise<HistoryDb> {
  const idb = factory === undefined ? (typeof indexedDB !== 'undefined' ? indexedDB : null) : factory;
  if (!idb) return memoryHistoryDb();
  let db: IDBDatabase;
  try {
    const req = idb.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    db = await done(req);
  } catch {
    return memoryHistoryDb();
  }
  const store = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    durable: true,
    async get(k) {
      try {
        return (await done(store('readonly').get(k))) ?? null;
      } catch {
        return null;
      }
    },
    async put(k, v) {
      try {
        await done(store('readwrite').put(v, k));
        return true;
      } catch {
        return false;
      }
    },
    async del(k) {
      try {
        await done(store('readwrite').delete(k));
        return true;
      } catch {
        return false;
      }
    },
    async keys() {
      try {
        return (await done(store('readonly').getAllKeys())).map(String);
      } catch {
        return [];
      }
    },
  };
}

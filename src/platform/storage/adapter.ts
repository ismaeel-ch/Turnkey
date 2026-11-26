/**
 * Browser storage for the workspace: the behaviour of `LS` in `src/legacy/core.js` (get, set, del, keys, size, probe,
 * ok, why, full), backed by IndexedDB, which holds far more than localStorage's five megabytes.
 *
 * The workspace calls storage synchronously, and IndexedDB is asynchronous. So the adapter keeps every value in a
 * memory mirror that is filled before the workspace starts (`openStorage` resolves when it is), reads come from
 * the mirror, and writes go into the mirror at once and are saved to IndexedDB a moment later, in one transaction.
 * Nothing is lost silently: a failed save keeps the value in the mirror and in a list of unsaved keys, retries on
 * the next write or `flush()`, and is reported through `onProblem` and `status()`.
 *
 * Where it keeps data (`mode`):
 *   indexeddb     IndexedDB, the normal case.
 *   localstorage  IndexedDB is blocked or missing, localStorage works. Same limits as today, `set` reports a full store.
 *   memory        both are blocked. Works until the tab closes, and says so (`ok` is false, like `LS.ok`).
 *
 * Stored formats do not change: the keys are `formwork:v1:state` and `formwork:v1:db:<appId>`, the values are the
 * same strings. On first open it copies what localStorage holds under that prefix into IndexedDB (see `migrate`).
 */

export type StorageMode = 'indexeddb' | 'localstorage' | 'memory';

export interface StorageProblem {
  kind: 'quota' | 'write' | 'migrate' | 'open';
  key?: string;
  message: string;
  /** keys whose latest value is not saved yet */
  unsaved: number;
}

export interface StorageStatus {
  mode: StorageMode;
  /** false when nothing will survive closing the tab (memory mode) */
  durable: boolean;
  /** a save was refused because the browser is out of space */
  full: boolean;
  why: string;
  unsaved: number;
  keys: number;
  /** approximate bytes held (characters of keys and values) */
  bytes: number;
  migrated: { from: number; at: number } | null;
}

export interface StorageOptions {
  /** key prefix; `formwork:v1:` like `BRAND.ns` */
  namespace?: string;
  /** IndexedDB database name */
  dbName?: string;
  /** defaults to the global `indexedDB`; pass `null` to simulate it being blocked */
  indexedDB?: IDBFactory | null;
  /** defaults to the global `localStorage`; pass `null` to simulate it being blocked */
  localStorage?: Storage | null;
  /** milliseconds to wait before saving, so a burst of writes is one transaction. Default 150. */
  saveDelay?: number;
  /** delete the migrated localStorage keys once they are verified in IndexedDB. Default true. */
  clearLegacy?: boolean;
  /** refuse a `set` (return false) when the estimated total would pass this many bytes. Off by default. */
  maxBytes?: number;
  onProblem?: (p: StorageProblem) => void;
}

const DB_VERSION = 1;
const KV = 'kv';
const META = 'meta';
const MIGRATED = 'migrated-from-localstorage';

const isQuota = (e: unknown) => {
  const x = e as { name?: string; code?: number; message?: string } | null;
  return (
    !!x &&
    (x.name === 'QuotaExceededError' ||
      x.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      x.code === 22 ||
      x.code === 1014 ||
      /quota|full/i.test(String(x.message || '')))
  );
};
const msg = (e: unknown) => String((e && (e as Error).message) || e);

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error('Transaction aborted'));
  });
}

export class TurnkeyStorage {
  /** like `LS.ok`: false when nothing survives a reload */
  ok = true;
  /** like `LS.why`: the last reason something failed */
  why = '';
  /** like `LS.full`: the last save was refused for lack of space */
  full = false;
  mode: StorageMode = 'memory';

  readonly ns: string;
  /** @internal */
  mirror = new Map<string, string>();
  /** @internal */
  dirty = new Map<string, string | null>();
  private db: IDBDatabase | null = null;
  private ls: Storage | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private listeners = new Set<(p: StorageProblem) => void>();
  private migratedInfo: { from: number; at: number } | null = null;
  private bytes = 0;

  constructor(private readonly o: StorageOptions = {}) {
    this.ns = o.namespace ?? 'formwork:v1:';
    if (o.onProblem) this.listeners.add(o.onProblem);
  }

  /** @internal use `openStorage` */
  async open(): Promise<this> {
    const o = this.o;
    const idb = o.indexedDB === undefined ? (typeof indexedDB !== 'undefined' ? indexedDB : null) : o.indexedDB;
    let lsx: Storage | null = null;
    try {
      lsx = o.localStorage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : o.localStorage;
      if (lsx) {
        const k = this.ns + '__probe';
        lsx.setItem(k, '1');
        lsx.removeItem(k);
      }
    } catch (e) {
      lsx = null;
      this.why = msg(e);
    }
    this.ls = lsx;

    if (idb) {
      try {
        this.db = await this.openDb(idb);
        await this.load();
        this.mode = 'indexeddb';
        await this.migrate();
      } catch (e) {
        this.db = null;
        this.mirror.clear();
        this.why = msg(e);
        this.report({ kind: 'open', message: 'IndexedDB could not be used: ' + msg(e) });
      }
    }
    if (this.mode !== 'indexeddb') {
      if (this.ls) {
        this.mode = 'localstorage';
        this.readLocal();
      } else this.mode = 'memory';
    }
    this.ok = this.mode !== 'memory';
    this.recount();
    return this;
  }

  private openDb(idb: IDBFactory): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
      const r = idb.open(this.o.dbName ?? 'turnkey-storage', DB_VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains(KV)) d.createObjectStore(KV);
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error || new Error('IndexedDB would not open'));
      r.onblocked = () => rej(new Error('IndexedDB is blocked by another tab'));
    });
  }

  private async load(): Promise<void> {
    const db = this.db!;
    const tx = db.transaction(KV, 'readonly');
    const store = tx.objectStore(KV);
    const keys = (await req(store.getAllKeys())) as IDBValidKey[];
    const vals = (await req(store.getAll())) as unknown[];
    keys.forEach((k, i) => {
      if (typeof k === 'string' && typeof vals[i] === 'string') this.mirror.set(k, vals[i] as string);
    });
  }

  private readLocal(): void {
    const ls = this.ls!;
    try {
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && k.startsWith(this.ns)) {
          const v = ls.getItem(k);
          if (v != null) this.mirror.set(k, v);
        }
      }
    } catch (e) {
      this.why = msg(e);
    }
  }

  /**
   * One-time copy of localStorage's `formwork:v1:*` keys into IndexedDB. A key already in IndexedDB wins (it is
   * newer). The copy is read back and compared before localStorage is cleared; if anything differs, localStorage is
   * left alone and the problem is reported. The result is stored under a flag, so it never runs twice.
   */
  private async migrate(): Promise<void> {
    const db = this.db!;
    const flag = await req(db.transaction(META, 'readonly').objectStore(META).get(MIGRATED));
    if (flag) {
      this.migratedInfo = flag as { from: number; at: number };
      return;
    }
    const found = new Map<string, string>();
    if (this.ls) {
      try {
        for (let i = 0; i < this.ls.length; i++) {
          const k = this.ls.key(i);
          if (k && k.startsWith(this.ns) && k !== this.ns + '__probe') {
            const v = this.ls.getItem(k);
            if (v != null) found.set(k, v);
          }
        }
      } catch (e) {
        this.report({ kind: 'migrate', message: 'localStorage could not be read: ' + msg(e) });
        return; // try again next time
      }
    }
    const info = { from: found.size, at: Date.now() };
    try {
      const tx = db.transaction([KV, META], 'readwrite');
      const kv = tx.objectStore(KV);
      for (const [k, v] of found) if (!this.mirror.has(k)) kv.put(v, k);
      await done(tx);
      // read back what was written before anything is deleted
      const check = db.transaction(KV, 'readonly').objectStore(KV);
      let same = true;
      for (const [k, v] of found) {
        const got = (await req(check.get(k))) as string | undefined;
        if (!this.mirror.has(k) && got !== v) same = false;
        if (got !== undefined && !this.mirror.has(k)) this.mirror.set(k, got);
      }
      if (!same) throw new Error('The copy in IndexedDB does not match what localStorage holds');
      const t2 = db.transaction(META, 'readwrite');
      t2.objectStore(META).put(info, MIGRATED);
      await done(t2);
      this.migratedInfo = info;
      if (this.o.clearLegacy !== false && this.ls)
        for (const k of found.keys()) {
          try {
            this.ls.removeItem(k);
          } catch {
            /* leave it */
          }
        }
    } catch (e) {
      for (const k of found.keys()) if (!this.mirror.has(k)) this.mirror.set(k, found.get(k)!); // keep working from memory
      this.report({
        kind: isQuota(e) ? 'quota' : 'migrate',
        message: 'Moving saved data into IndexedDB failed, so it stays in localStorage: ' + msg(e),
      });
      if (isQuota(e)) this.full = true;
      // not flagged as migrated: tried again on the next open
      for (const [k, v] of found) if (!this.dirty.has(k)) this.dirty.set(k, v);
    }
  }

  /** @internal */
  recount(): void {
    let n = 0;
    for (const [k, v] of this.mirror) n += k.length + v.length;
    this.bytes = n;
  }

  /* ---------- the LS surface ---------- */

  /** like `LS.probe()`: is anything durable available */
  probe(): boolean {
    return this.ok;
  }

  get(k: string): string | null {
    const v = this.mirror.get(this.ns + k);
    return v === undefined ? null : v;
  }

  /** Stores a value. Returns false when it is certain the value will not be kept (store full in localStorage mode, or `maxBytes` passed). */
  set(k: string, v: string): boolean {
    const key = this.ns + k;
    const val = String(v);
    const prev = this.mirror.get(key);
    const next = this.bytes - (prev === undefined ? 0 : key.length + prev.length) + key.length + val.length;
    if (this.o.maxBytes && next > this.o.maxBytes) {
      this.full = true;
      this.why = 'The storage limit of ' + this.o.maxBytes + ' bytes would be passed';
      this.report({ kind: 'quota', key: k, message: this.why });
      return false;
    }
    if (this.mode === 'localstorage') {
      try {
        this.ls!.setItem(key, val);
      } catch (e) {
        this.full = true;
        this.why = msg(e);
        this.report({ kind: isQuota(e) ? 'quota' : 'write', key: k, message: this.why });
        return false; // same as LS.set: the old value stays
      }
      this.mirror.set(key, val);
      this.bytes = next;
      this.full = false;
      return true;
    }
    this.mirror.set(key, val);
    this.bytes = next;
    if (this.mode === 'indexeddb') {
      this.dirty.set(key, val);
      this.schedule();
    }
    return true;
  }

  del(k: string): void {
    const key = this.ns + k;
    const prev = this.mirror.get(key);
    if (prev !== undefined) this.bytes -= key.length + prev.length;
    this.mirror.delete(key);
    if (this.mode === 'localstorage') {
      try {
        this.ls!.removeItem(key);
      } catch {
        /* nothing to do */
      }
    } else if (this.mode === 'indexeddb') {
      this.dirty.set(key, null);
      this.schedule();
    }
  }

  keys(): string[] {
    const out: string[] = [];
    for (const k of this.mirror.keys()) if (k.startsWith(this.ns)) out.push(k.slice(this.ns.length));
    return out.sort();
  }

  size(k: string): number {
    const v = this.get(k);
    return v ? v.length + k.length + this.ns.length : 0;
  }

  /* ---------- saving ---------- */

  /** @internal */
  schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.o.saveDelay ?? 150);
  }

  /** Saves everything not yet saved. Resolves true when nothing is left unsaved. Safe to call at any time. */
  async flush(): Promise<boolean> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.mode !== 'indexeddb' || !this.db) return true;
    while (this.saving) await this.saving; // one transaction at a time
    if (!this.dirty.size) return true;
    const batch = new Map(this.dirty);
    const run = (async () => {
      try {
        const tx = this.db!.transaction(KV, 'readwrite');
        const kv = tx.objectStore(KV);
        for (const [k, v] of batch) {
          if (v === null) kv.delete(k);
          else kv.put(v, k);
        }
        await done(tx);
        for (const [k, v] of batch) if (this.dirty.get(k) === v) this.dirty.delete(k); // a newer write stays queued
        this.full = false;
      } catch (e) {
        const quota = isQuota(e);
        if (quota) this.full = true;
        this.why = msg(e);
        this.report({
          kind: quota ? 'quota' : 'write',
          message: quota
            ? 'The browser is out of space, so recent changes are only kept in this tab: ' + msg(e)
            : 'Saving to IndexedDB failed: ' + msg(e),
        });
      }
    })();
    this.saving = run;
    await run;
    this.saving = null;
    if (this.dirty.size && !this.timer && !this.full) this.schedule();
    return this.dirty.size === 0;
  }

  /* ---------- reporting ---------- */

  onProblem(fn: (p: StorageProblem) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private report(p: Omit<StorageProblem, 'unsaved'>): void {
    const full = { ...p, unsaved: this.dirty.size };
    this.listeners.forEach((f) => {
      try {
        f(full);
      } catch {
        /* a listener must not break saving */
      }
    });
  }

  status(): StorageStatus {
    return {
      mode: this.mode,
      durable: this.mode !== 'memory',
      full: this.full,
      why: this.why,
      unsaved: this.dirty.size,
      keys: this.mirror.size,
      bytes: this.bytes,
      migrated: this.migratedInfo,
    };
  }

  /** Browser quota, where the browser says (`navigator.storage.estimate`). */
  async estimate(): Promise<{ usage: number; quota: number } | null> {
    try {
      const e = await navigator.storage.estimate();
      return e.quota ? { usage: e.usage || 0, quota: e.quota } : null;
    } catch {
      return null;
    }
  }

  /** Asks the browser to keep this origin's data when space runs short. Returns whether it agreed. */
  async persist(): Promise<boolean> {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }

  /** Every key and value, with the namespace removed from the keys. For backups. */
  entries(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const k of this.keys()) out[k] = this.mirror.get(this.ns + k)!;
    return out;
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.db?.close();
    this.db = null;
  }

  /* ---------- ways to put it under the workspace ---------- */

  /**
   * An object with the surface of `LS` in core.js (methods plus live `ok`, `why`, `full`). `LS` is a const inside the
   * workspace bundle, so using this needs a one-line seam in src/legacy/core.js; see docs/architecture/data.md.
   */
  lsCompat() {
    return makeLsCompat(this);
  }

  /**
   * The Web Storage interface (getItem, setItem, removeItem, key, length) over the mirror. `LS` calls the global
   * `localStorage` with exactly these, so defining this object as `window.localStorage` before the workspace script
   * runs puts the adapter under it without touching `src/legacy`. A `setItem` that cannot be kept throws a
   * `QuotaExceededError`, as the real one does, so `LS.set` returns false and the workspace shows its own warning.
   */
  asStorage(): Storage {
    return makeWebStorage(this);
  }

  /** @internal */
  recountSoon() {
    this.recount();
  }
}

function makeLsCompat(s: TurnkeyStorage) {
  return {
    get ok() {
      return s.ok;
    },
    set ok(_v: boolean) {
      /* the adapter decides */
    },
    get why() {
      return s.why;
    },
    set why(_v: string) {
      /* the adapter decides */
    },
    get full() {
      return s.full;
    },
    set full(_v: boolean) {
      /* the adapter decides */
    },
    probe: () => s.probe(),
    get: (k: string) => s.get(k),
    set: (k: string, v: string) => s.set(k, v),
    del: (k: string) => s.del(k),
    keys: () => s.keys(),
    size: (k: string) => s.size(k),
  };
}

function makeWebStorage(s: TurnkeyStorage): Storage {
  const keysAll = () => [...s.mirror.keys()];
  const api = {
    get length() {
      return s.mirror.size;
    },
    key: (i: number) => keysAll()[i] ?? null,
    getItem: (k: string) => {
      const v = s.mirror.get(String(k));
      return v === undefined ? null : v;
    },
    setItem: (k: string, v: string) => {
      const key = String(k);
      const inNs = key.startsWith(s.ns);
      if (!inNs) {
        s.mirror.set(key, String(v));
        s.recountSoon();
        if (s.mode === 'indexeddb') {
          s.dirty.set(key, String(v));
          s.schedule();
        }
        return;
      }
      if (!s.set(key.slice(s.ns.length), String(v))) {
        const err = new Error(s.why || 'Storage is full');
        err.name = 'QuotaExceededError';
        throw err;
      }
    },
    removeItem: (k: string) => {
      const key = String(k);
      if (key.startsWith(s.ns)) s.del(key.slice(s.ns.length));
      else {
        s.mirror.delete(key);
        if (s.mode === 'indexeddb') {
          s.dirty.set(key, null);
          s.schedule();
        }
      }
    },
    clear: () => {
      for (const k of keysAll()) api.removeItem(k);
    },
  };
  return api as unknown as Storage;
}

/** Opens the storage and fills the mirror. Await this before the workspace starts. Never rejects: the worst case is memory mode. */
export async function openStorage(options: StorageOptions = {}): Promise<TurnkeyStorage> {
  const s = new TurnkeyStorage(options);
  return s.open();
}

/**
 * Saves when the page is hidden or about to go. IndexedDB cannot be awaited during unload, so the 150 ms delay is the
 * window in which a very quick close could lose the last edit; `visibilitychange` to hidden fires earlier on mobile and
 * on tab switches, which covers most closes.
 */
export function flushOnHide(
  s: TurnkeyStorage,
  win: Pick<Window, 'addEventListener' | 'removeEventListener'> & { document?: Document } = window,
): () => void {
  const hide = () => {
    if (!win.document || win.document.visibilityState === 'hidden') void s.flush();
  };
  const pageHide = () => void s.flush();
  win.addEventListener('visibilitychange', hide);
  win.addEventListener('pagehide', pageHide);
  return () => {
    win.removeEventListener('visibilitychange', hide);
    win.removeEventListener('pagehide', pageHide);
  };
}

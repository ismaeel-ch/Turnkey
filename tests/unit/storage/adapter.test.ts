// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { openStorage, type StorageProblem } from '@/platform/storage';

const NS = 'formwork:v1:';
const opts = (extra: Record<string, unknown> = {}) => ({ indexedDB: new IDBFactory(), localStorage: null, saveDelay: 5, ...extra });

describe('storage adapter, IndexedDB mode', () => {
  it('behaves like LS: get, set, del, keys, size', async () => {
    const s = await openStorage(opts());
    expect(s.mode).toBe('indexeddb');
    expect(s.ok).toBe(true);
    expect(s.get('state')).toBeNull();
    expect(s.set('state', '{"v":1}')).toBe(true);
    expect(s.set('db:app_1', 'AAAA')).toBe(true);
    expect(s.get('state')).toBe('{"v":1}');
    expect(s.keys()).toEqual(['db:app_1', 'state']);
    expect(s.size('db:app_1')).toBe(4 + 'db:app_1'.length + NS.length);
    expect(s.size('missing')).toBe(0);
    s.del('db:app_1');
    expect(s.get('db:app_1')).toBeNull();
    expect(s.keys()).toEqual(['state']);
  });

  it('keeps values across a reload (same database, new adapter)', async () => {
    const idb = new IDBFactory();
    const a = await openStorage({ indexedDB: idb, localStorage: null, saveDelay: 5 });
    a.set('state', 'one');
    a.set('db:x', 'two');
    a.del('db:x');
    a.set('db:y', 'three');
    expect(await a.flush()).toBe(true);
    a.close();
    const b = await openStorage({ indexedDB: idb, localStorage: null });
    expect(b.get('state')).toBe('one');
    expect(b.get('db:x')).toBeNull();
    expect(b.get('db:y')).toBe('three');
    expect(b.keys()).toEqual(['db:y', 'state']);
  });

  it('saves a burst of writes by itself, without flush', async () => {
    const idb = new IDBFactory();
    const a = await openStorage({ indexedDB: idb, localStorage: null, saveDelay: 5 });
    for (let i = 0; i < 20; i++) a.set('state', 'v' + i);
    expect(a.status().unsaved).toBe(1);
    await vi.waitFor(() => expect(a.status().unsaved).toBe(0));
    a.close();
    expect((await openStorage({ indexedDB: idb, localStorage: null })).get('state')).toBe('v19');
  });

  it('holds more than localStorage could', async () => {
    const s = await openStorage(opts());
    const big = 'x'.repeat(3_000_000);
    expect(s.set('db:a', big)).toBe(true);
    expect(s.set('db:b', big)).toBe(true);
    expect(await s.flush()).toBe(true);
    expect(s.status().bytes).toBeGreaterThan(6_000_000);
  });
});

describe('migration from localStorage', () => {
  const seed = () => {
    localStorage.clear();
    localStorage.setItem(NS + 'state', '{"v":1,"apps":{}}');
    localStorage.setItem(NS + 'db:app_a', 'U1FMaXRl');
    localStorage.setItem('other:key', 'not ours');
  };

  it('copies formwork:v1 keys into IndexedDB once, verifies, then clears them', async () => {
    seed();
    const idb = new IDBFactory();
    const s = await openStorage({ indexedDB: idb, localStorage, saveDelay: 5 });
    expect(s.mode).toBe('indexeddb');
    expect(s.get('state')).toBe('{"v":1,"apps":{}}');
    expect(s.get('db:app_a')).toBe('U1FMaXRl');
    expect(s.status().migrated?.from).toBe(2);
    expect(localStorage.getItem(NS + 'state')).toBeNull();
    expect(localStorage.getItem(NS + 'db:app_a')).toBeNull();
    expect(localStorage.getItem('other:key')).toBe('not ours');
    s.close();
    // a key written to localStorage later is not pulled in again: migration ran once
    localStorage.setItem(NS + 'state', 'stale');
    const again = await openStorage({ indexedDB: idb, localStorage, saveDelay: 5 });
    expect(again.get('state')).toBe('{"v":1,"apps":{}}');
    expect(again.status().migrated?.from).toBe(2);
  });

  it('does not overwrite a value already in IndexedDB', async () => {
    localStorage.clear();
    const idb = new IDBFactory();
    const first = await openStorage({ indexedDB: idb, localStorage: null, saveDelay: 5 });
    first.set('state', 'newer');
    await first.flush();
    first.close();
    localStorage.setItem(NS + 'state', 'older');
    const s = await openStorage({ indexedDB: idb, localStorage, saveDelay: 5 });
    expect(s.get('state')).toBe('newer');
  });

  it('can keep the localStorage copy', async () => {
    seed();
    const s = await openStorage({ indexedDB: new IDBFactory(), localStorage, clearLegacy: false });
    expect(s.get('state')).not.toBeNull();
    expect(localStorage.getItem(NS + 'state')).not.toBeNull();
  });

  it('migrates nothing and still works when localStorage is empty', async () => {
    localStorage.clear();
    const s = await openStorage({ indexedDB: new IDBFactory(), localStorage });
    expect(s.status().migrated?.from).toBe(0);
    expect(s.keys()).toEqual([]);
  });
});

describe('fallbacks', () => {
  it('uses localStorage when IndexedDB is blocked, and set reports a full store like LS', async () => {
    localStorage.clear();
    localStorage.setItem(NS + 'state', 'kept');
    const s = await openStorage({ indexedDB: null, localStorage });
    expect(s.mode).toBe('localstorage');
    expect(s.ok).toBe(true);
    expect(s.get('state')).toBe('kept');
    expect(s.set('state', 'changed')).toBe(true);
    expect(localStorage.getItem(NS + 'state')).toBe('changed');
    const problems: StorageProblem[] = [];
    s.onProblem((p) => problems.push(p));
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(s.set('db:a', 'zzz')).toBe(false);
    spy.mockRestore();
    expect(s.full).toBe(true);
    expect(s.get('db:a')).toBeNull();
    expect(s.get('state')).toBe('changed');
    expect(problems[0]).toMatchObject({ kind: 'quota', key: 'db:a' });
  });

  it('works in memory when everything is blocked, and says it is not durable', async () => {
    const s = await openStorage({ indexedDB: null, localStorage: null });
    expect(s.mode).toBe('memory');
    expect(s.ok).toBe(false);
    expect(s.probe()).toBe(false);
    expect(s.status().durable).toBe(false);
    s.set('state', 'a');
    s.set('db:q', 'b');
    expect(s.keys()).toEqual(['db:q', 'state']);
    s.del('state');
    expect(s.get('state')).toBeNull();
    expect(await s.flush()).toBe(true);
  });

  it('falls back when IndexedDB throws on open, without losing localStorage data', async () => {
    localStorage.clear();
    localStorage.setItem(NS + 'state', 'safe');
    const broken = {
      open: () => {
        throw new Error('blocked by policy');
      },
    } as unknown as IDBFactory;
    const problems: StorageProblem[] = [];
    const s = await openStorage({ indexedDB: broken, localStorage, onProblem: (p) => problems.push(p) });
    expect(s.mode).toBe('localstorage');
    expect(s.get('state')).toBe('safe');
    expect(problems[0].kind).toBe('open');
  });
});

describe('problems are reported, not swallowed', () => {
  it('a refused save keeps the value in the mirror, flags full, and retries when asked', async () => {
    const s = await openStorage(opts());
    const problems: StorageProblem[] = [];
    s.onProblem((p) => problems.push(p));
    const db = (s as unknown as { db: IDBDatabase }).db;
    const real = db.transaction.bind(db);
    let fail = true;
    vi.spyOn(db, 'transaction').mockImplementation(((...a: Parameters<IDBDatabase['transaction']>) => {
      if (fail) throw new DOMException('no space', 'QuotaExceededError');
      return real(...a);
    }) as IDBDatabase['transaction']);
    s.set('db:big', 'data');
    expect(await s.flush()).toBe(false);
    expect(s.full).toBe(true);
    expect(s.status()).toMatchObject({ full: true, unsaved: 1 });
    expect(s.get('db:big')).toBe('data'); // still readable in this tab
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ kind: 'quota', unsaved: 1 });
    fail = false;
    expect(await s.flush()).toBe(true);
    expect(s.full).toBe(false);
    expect(s.status().unsaved).toBe(0);
  });

  it('maxBytes makes set return false before anything is lost', async () => {
    const s = await openStorage(opts({ maxBytes: 100 }));
    expect(s.set('a', 'x'.repeat(10))).toBe(true);
    expect(s.set('b', 'x'.repeat(500))).toBe(false);
    expect(s.full).toBe(true);
    expect(s.get('b')).toBeNull();
    expect(s.get('a')).toHaveLength(10);
  });
});

describe('ways to put it under the workspace', () => {
  it('lsCompat has the LS surface', async () => {
    const s = await openStorage(opts());
    const ls = s.lsCompat();
    expect(ls.ok).toBe(true);
    expect(ls.set('state', 'q')).toBe(true);
    expect(ls.get('state')).toBe('q');
    expect(ls.keys()).toEqual(['state']);
    expect(ls.size('state')).toBe(1 + 5 + NS.length);
    ls.del('state');
    expect(ls.get('state')).toBeNull();
    expect(ls.probe()).toBe(true);
  });

  it('asStorage answers what LS asks of localStorage, and throws a quota error when full', async () => {
    const s = await openStorage(opts({ maxBytes: 200 }));
    const st = s.asStorage();
    st.setItem(NS + 'state', 'hello');
    expect(st.getItem(NS + 'state')).toBe('hello');
    expect(st.getItem(NS + 'nope')).toBeNull();
    expect(st.length).toBe(1);
    expect(st.key(0)).toBe(NS + 'state');
    expect(() => st.setItem(NS + 'db:a', 'x'.repeat(1000))).toThrowError(expect.objectContaining({ name: 'QuotaExceededError' }));
    st.removeItem(NS + 'state');
    expect(st.length).toBe(0);
    // the exact calls LS makes
    st.setItem(NS + '__probe', '1');
    st.removeItem(NS + '__probe');
    expect(s.keys()).toEqual([]);
  });
});

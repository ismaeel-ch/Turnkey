// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { JOURNAL, flushOnHide, openStorage } from '@/platform/storage';

const NS = 'formwork:v1:';
const journalKeys = () => Object.keys(localStorage).filter((k) => k.startsWith(JOURNAL));

beforeEach(() => localStorage.clear());

describe('journal: a reload that cuts off the IndexedDB save loses nothing', () => {
  it('replays values journaled on hide whose save never finished', async () => {
    const idb = new IDBFactory();
    const a = await openStorage({ indexedDB: idb, localStorage, saveDelay: 10_000 });
    a.set('state', 'saved');
    expect(await a.flush()).toBe(true);
    a.set('state', 'last edit');
    a.set('db:x', 'new app');
    expect(a.journal()).toBe(2);
    expect(journalKeys().sort()).toEqual([JOURNAL + NS + 'db:x', JOURNAL + NS + 'state']);
    a.close(); // the page went away before the save ran

    const b = await openStorage({ indexedDB: idb, localStorage, saveDelay: 5 });
    expect(b.get('state')).toBe('last edit');
    expect(b.get('db:x')).toBe('new app');
    expect(journalKeys()).toEqual([]); // saved into IndexedDB and cleared
    b.close();
    const c = await openStorage({ indexedDB: idb, localStorage: null, saveDelay: 5 });
    expect(c.get('state')).toBe('last edit'); // really in IndexedDB now
  });

  it('replays a delete', async () => {
    const idb = new IDBFactory();
    const a = await openStorage({ indexedDB: idb, localStorage, saveDelay: 10_000 });
    a.set('db:gone', 'x');
    await a.flush();
    a.del('db:gone');
    a.journal();
    a.close();
    const b = await openStorage({ indexedDB: idb, localStorage, saveDelay: 5 });
    expect(b.get('db:gone')).toBeNull();
  });

  it('clears entries once the save lands, so an older value never comes back over a newer one', async () => {
    const idb = new IDBFactory();
    const a = await openStorage({ indexedDB: idb, localStorage, saveDelay: 10_000 });
    a.set('state', 'v1');
    a.journal();
    expect(await a.flush()).toBe(true);
    expect(journalKeys()).toEqual([]);
    a.close();
    const other = await openStorage({ indexedDB: idb, localStorage, saveDelay: 5 }); // another tab saves later
    other.set('state', 'v2');
    await other.flush();
    other.close();
    const b = await openStorage({ indexedDB: idb, localStorage, saveDelay: 5 });
    expect(b.get('state')).toBe('v2');
  });

  it('flushOnHide journals on pagehide', async () => {
    const a = await openStorage({ indexedDB: new IDBFactory(), localStorage, saveDelay: 10_000 });
    const stop = flushOnHide(a);
    a.set('state', 'typed just now');
    window.dispatchEvent(new Event('pagehide'));
    expect(localStorage.getItem(JOURNAL + NS + 'state')).toBe('typed just now');
    stop();
  });
});

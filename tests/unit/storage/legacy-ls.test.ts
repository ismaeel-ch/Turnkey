// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { openStorage } from '@/platform/storage';

/** Runs the workspace's own `LS` code (read from src/legacy/core.js, unchanged) against the adapter. */
function legacyLS(storage: Storage) {
  const core = fs.readFileSync(path.resolve(__dirname, '../../../src/legacy/core.js'), 'utf8');
  const a = core.indexOf('const MEM = {};');
  const b = core.indexOf('/* ---------- persisted state');
  expect(a).toBeGreaterThan(0);
  expect(b).toBeGreaterThan(a);
  const ctx = vm.createContext({ localStorage: storage });
  return vm.runInContext(`const BRAND = { ns: 'formwork:v1:' };\n${core.slice(a, b)}\n;LS`, ctx) as {
    ok: boolean;
    full: boolean;
    probe(): boolean;
    get(k: string): string | null;
    set(k: string, v: string): boolean;
    del(k: string): void;
    keys(): string[];
    size(k: string): number;
  };
}

describe('the workspace LS code on top of the adapter (localStorage replaced by asStorage)', () => {
  it('reads data that was in localStorage before the switch, and writes land in IndexedDB', async () => {
    localStorage.clear();
    localStorage.setItem('formwork:v1:state', '{"v":1}');
    localStorage.setItem('formwork:v1:db:app_a', 'QUJD');
    const idb = new IDBFactory();
    const s = await openStorage({ indexedDB: idb, localStorage, saveDelay: 5 });
    const LS = legacyLS(s.asStorage());
    expect(LS.probe()).toBe(true);
    expect(LS.get('state')).toBe('{"v":1}');
    expect(LS.keys()).toEqual(['db:app_a', 'state']);
    expect(LS.set('db:app_b', 'REVG')).toBe(true);
    LS.del('db:app_a');
    expect(LS.size('db:app_b')).toBe(4 + 8 + 'formwork:v1:'.length);
    await s.flush();
    s.close();
    const again = await openStorage({ indexedDB: idb, localStorage: null });
    expect(again.keys()).toEqual(['db:app_b', 'state']);
  });

  it('a refused write makes LS.set return false and sets LS.full, as before', async () => {
    const s = await openStorage({ indexedDB: new IDBFactory(), localStorage: null, maxBytes: 100 });
    const LS = legacyLS(s.asStorage());
    expect(LS.set('state', 'ok')).toBe(true);
    expect(LS.set('db:big', 'x'.repeat(1000))).toBe(false);
    expect(LS.full).toBe(true);
    expect(LS.get('state')).toBe('ok');
  });
});

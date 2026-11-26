// @vitest-environment jsdom
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  WORKSPACE_NS,
  adapterWanted,
  createBackup,
  forgetWorkspaceStorage,
  openWorkspaceStorage,
  parseBackup,
  restoreBackup,
  workspaceStorage,
} from '@/platform/storage';
import { LS, attachStorage } from '@/workspace/core';

type Win = { __turnkeyOptions?: { storage?: string }; __turnkeyStorage?: unknown; indexedDB?: IDBFactory };
const win = globalThis as unknown as Win;
const plainLS = { ...Object.getOwnPropertyDescriptors(LS) };

beforeEach(() => {
  win.indexedDB = new IDBFactory();
  localStorage.clear();
  delete win.__turnkeyOptions;
  delete win.__turnkeyStorage;
});
afterEach(() => {
  forgetWorkspaceStorage();
  Object.defineProperties(LS, plainLS); // put the workspace's own localStorage LS back
});

describe('workspace storage', () => {
  it('opens IndexedDB with the workspace prefix and moves localStorage into it', async () => {
    localStorage.setItem(WORKSPACE_NS + 'state', '{"v":1,"apps":{}}');
    localStorage.setItem(WORKSPACE_NS + 'db:clinic', 'AAAA');
    localStorage.setItem('other-site-key', 'left alone');
    const s = await openWorkspaceStorage();
    expect(s?.mode).toBe('indexeddb');
    expect(s?.get('state')).toBe('{"v":1,"apps":{}}');
    expect(s?.keys()).toEqual(['db:clinic', 'state']);
    expect(localStorage.getItem(WORKSPACE_NS + 'state')).toBeNull();
    expect(localStorage.getItem('other-site-key')).toBe('left alone');
    expect(win.__turnkeyStorage).toBe(s);
    expect(workspaceStorage()).toBe(s);
    expect(await openWorkspaceStorage()).toBe(s); // once
  });

  it('stays on plain localStorage when the page asks', async () => {
    win.__turnkeyOptions = { storage: 'localstorage' };
    expect(adapterWanted()).toBe(false);
    expect(await openWorkspaceStorage()).toBeNull();
    expect(workspaceStorage()).toBeNull();
  });

  it('puts the adapter under LS, with live ok, why and full', async () => {
    const s = (await openWorkspaceStorage())!;
    attachStorage(s.lsCompat());
    expect(LS.probe()).toBe(true);
    expect(LS.set('state', '{"v":1}')).toBe(true);
    expect(s.get('state')).toBe('{"v":1}');
    expect(localStorage.getItem(WORKSPACE_NS + 'state')).toBeNull(); // went to IndexedDB, not localStorage
    expect(LS.keys()).toEqual(['state']);
    expect(LS.size('state')).toBe(7 + 'state'.length + WORKSPACE_NS.length);
    s.ok = false;
    expect(LS.ok).toBe(false);
    s.full = true;
    expect(LS.full).toBe(true);
    LS.del('state');
    expect(s.get('state')).toBeNull();
  });

  it('a backup made through LS restores in a fresh browser and survives a reload', async () => {
    const a = (await openWorkspaceStorage())!;
    attachStorage(a.lsCompat());
    LS.set('state', JSON.stringify({ v: 1, apps: { clinic: { name: 'Clinic' } } }));
    LS.set('db:clinic', 'U1FMaXRl');
    const text = JSON.stringify(createBackup(LS));
    forgetWorkspaceStorage();

    win.indexedDB = new IDBFactory(); // another browser
    const idb = win.indexedDB;
    const b = (await openWorkspaceStorage())!;
    attachStorage(b.lsCompat());
    LS.set('state', JSON.stringify({ v: 1, apps: {} }));
    LS.set('db:stray', 'AAAA');
    const r = restoreBackup(LS, parseBackup(text));
    expect(r.removed).toEqual(['db:stray']);
    expect(await b.flush()).toBe(true);
    forgetWorkspaceStorage();

    win.indexedDB = idb; // reload
    const c = (await openWorkspaceStorage())!;
    expect(c.keys()).toEqual(['db:clinic', 'state']);
    expect(JSON.parse(c.get('state')!).apps.clinic.name).toBe('Clinic');
    expect(c.get('db:clinic')).toBe('U1FMaXRl');
  });
});

import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  canRedo,
  canUndo,
  currentVersion,
  emptyHistory,
  pushVersion,
  readHistory,
  stepHistory,
  type History,
  type Version,
} from '@/shared/history';
import { memoryHistoryDb, openHistoryDb } from '@/platform/storage/history-db';

type Snap = { n: number };
const isSnap = (x: unknown): x is Snap => !!x && typeof (x as Snap).n === 'number';
const v = (n: number, kind: Version<Snap>['kind'] = 'edit'): Version<Snap> => ({ id: 'v' + n, at: n, by: ['you'], what: 'step ' + n, kind, snap: { n } });
const build = (count: number, max?: number) => {
  let h: History<Snap> = emptyHistory();
  for (let i = 0; i < count; i++) h = pushVersion(h, v(i, i ? 'edit' : 'start'), max);
  return h;
};

describe('version history stack', () => {
  it('starts empty, with nothing to undo or redo', () => {
    const h = emptyHistory<Snap>();
    expect(currentVersion(h)).toBeNull();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(stepHistory(h, -1)).toBeNull();
  });

  it('undoes and redoes by moving the current version', () => {
    const h = build(3);
    expect(currentVersion(h)?.snap.n).toBe(2);
    const back = stepHistory(h, -1)!;
    expect(currentVersion(back)?.snap.n).toBe(1);
    expect(canRedo(back)).toBe(true);
    const again = stepHistory(back, 1)!;
    expect(currentVersion(again)?.snap.n).toBe(2);
    expect(stepHistory(again, 1)).toBeNull();
  });

  it('drops undone versions when a new edit comes after an undo', () => {
    let h = stepHistory(stepHistory(build(4), -1)!, -1)!;
    h = pushVersion(h, v(9));
    expect(h.versions.map((x) => x.snap.n)).toEqual([0, 1, 9]);
    expect(canRedo(h)).toBe(false);
  });

  it('keeps at most max versions, dropping the oldest', () => {
    const h = build(10, 4);
    expect(h.versions.map((x) => x.snap.n)).toEqual([6, 7, 8, 9]);
    expect(h.at).toBe(3);
  });

  it('reads back a stored history and refuses a damaged one', () => {
    const h = build(3);
    expect(readHistory(JSON.parse(JSON.stringify(h)), isSnap)).toEqual(h);
    expect(readHistory({ ...h, at: 99 }, isSnap)?.at).toBe(2);
    expect(readHistory(null, isSnap)).toBeNull();
    expect(readHistory({ versions: [], at: 0 }, isSnap)).toBeNull();
    expect(readHistory({ versions: [{ ...v(1), snap: {} }], at: 0 }, isSnap)).toBeNull();
    expect(readHistory({ versions: [{ ...v(1), kind: 'other' }], at: 0 }, isSnap)).toBeNull();
  });
});

describe('history storage', () => {
  it('keeps histories in IndexedDB, with binary database files', async () => {
    const factory = new IDBFactory();
    const d = await openHistoryDb(factory);
    expect(d.durable).toBe(true);
    const rec = { ...build(2), extra: new Uint8Array([1, 2, 3]) };
    expect(await d.put('app_1', rec)).toBe(true);
    const again = await openHistoryDb(factory);
    const back = (await again.get('app_1')) as typeof rec;
    expect(back.versions.length).toBe(2);
    expect(Array.from(back.extra)).toEqual([1, 2, 3]);
    expect(await again.keys()).toEqual(['app_1']);
    await again.del('app_1');
    expect(await again.get('app_1')).toBeNull();
  });

  it('falls back to memory when IndexedDB is missing', async () => {
    const d = await openHistoryDb(null);
    expect(d.durable).toBe(false);
    await d.put('a', 1);
    expect(await d.get('a')).toBe(1);
    expect(await memoryHistoryDb().get('x')).toBeNull();
  });
});

/**
 * Problems the person should hear about once, in plain words, with a way forward: browser storage that is full or
 * refuses a save, and the SQLite engine failing to load. Model failures have their words in src/shared/api-error.ts.
 *
 * Storage problems arrive two ways: the IndexedDB adapter's `onProblem` (Workspace.tsx passes it here), and the plain
 * localStorage path in core.ts, which fires a `turnkey:storage-problem` window event so it need not import this file.
 * The shell reads `storageProblem()` to show a banner; a toast says it once a minute at most.
 */
import { notify, toast } from './core';

export type StorageTrouble = { kind: 'full' | 'write'; text: string };

let current: StorageTrouble | null = null;
let lastToast = 0;

/** The storage problem to show in the shell's banner, or null. */
export const storageProblem = (): StorageTrouble | null => current;

const WORDS: Record<StorageTrouble['kind'], string> = {
  full: "This browser's storage is full, so your latest changes are not saved. Delete an app you no longer need, or back up the workspace under Settings, then carry on.",
  write: 'Your latest changes could not be saved in this browser. Keep the page open and try again in a moment.',
};

/** Maps an adapter or browser problem to one of three plain cases. */
export function troubleOf(kind: string, why = ''): StorageTrouble {
  const k: StorageTrouble['kind'] = kind === 'quota' || /quota|full|exceeded/i.test(why) ? 'full' : 'write';
  return { kind: k, text: WORDS[k] };
}

/** Records a storage problem: banner from now on, a toast unless one went out in the last minute. */
export function noteStorageProblem(kind: string, why = '', now = Date.now()) {
  // `open` and `migrate`: IndexedDB or an old copy could not be used, and the adapter fell back to something that
  // works. When nothing works, LS.ok is false and the shell already says nothing will be kept.
  if (kind === 'open' || kind === 'migrate') return;
  const next = troubleOf(kind, why);
  const changed = !current || current.kind !== next.kind;
  current = next;
  if (changed || now - lastToast > 60_000) {
    lastToast = now;
    toast(next.text, next.kind === 'write' ? 'warning' : 'danger', 12000);
  }
  notify();
}

/** Clears the banner once a save goes through again. */
export function storageRecovered() {
  if (!current) return;
  current = null;
  notify();
}

/** Listens for problems reported by core.ts's plain localStorage path. Safe to call more than once. */
let listening = false;
export function listenForStorageProblems() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('turnkey:storage-problem', (e) => {
    const d = (e as CustomEvent<{ kind?: string; why?: string } | null>).detail;
    if (d && d.kind === 'ok') storageRecovered();
    else noteStorageProblem(d?.kind || 'write', d?.why || '');
  });
}

/** What the start screen says when the SQLite engine did not load. */
export function engineProblem(detail: string): string {
  const lead = detail ? detail.replace(/\.?$/, '. ') : '';
  const hint = /sqlite|wasm/i.test(detail)
    ? 'The SQLite engine is downloaded the first time Turnkey opens, so check the connection and reload the page. '
    : 'Reload the page. ';
  return lead + hint + 'Your saved apps are still in this browser.';
}

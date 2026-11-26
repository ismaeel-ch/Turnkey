'use client';
/**
 * Puts the IndexedDB storage adapter under the workspace (option C in docs/architecture/data.md).
 *
 * `openWorkspaceStorage` opens the adapter with the workspace's key prefix, moves anything localStorage still holds
 * into IndexedDB, and keeps the opened storage for the backup and restore buttons (`workspaceStorage`). Tests reach it
 * as `window.__turnkeyStorage`. `window.__turnkeyOptions = { storage: 'localstorage' }`, set before the page loads,
 * skips the adapter and keeps the workspace on plain localStorage, as it was before.
 */
import { openStorage, type StorageProblem, type TurnkeyStorage } from './adapter';

/** The prefix `BRAND.ns` in src/workspace/core.ts uses; stored formats do not change. */
export const WORKSPACE_NS = 'formwork:v1:';
export const WORKSPACE_DB = 'turnkey-storage';

type PageOptions = { __turnkeyOptions?: { storage?: 'indexeddb' | 'localstorage' }; __turnkeyStorage?: TurnkeyStorage };

let current: TurnkeyStorage | null = null;

/** The storage the workspace runs on, or null when it runs on plain localStorage. */
export const workspaceStorage = (): TurnkeyStorage | null => current;

/** Whether the page asked to stay on plain localStorage. */
export function adapterWanted(win: PageOptions = globalThis as unknown as PageOptions): boolean {
  return win.__turnkeyOptions?.storage !== 'localstorage';
}

/**
 * Opens the adapter once. Never rejects: when IndexedDB and localStorage are both blocked the adapter runs in memory
 * and says so through `ok`. Resolves null when the page asked for plain localStorage.
 */
export async function openWorkspaceStorage(onProblem?: (p: StorageProblem) => void): Promise<TurnkeyStorage | null> {
  if (current) return current;
  const win = globalThis as unknown as PageOptions;
  if (!adapterWanted(win)) return null;
  current = await openStorage({ namespace: WORKSPACE_NS, dbName: WORKSPACE_DB, onProblem });
  win.__turnkeyStorage = current;
  return current;
}

/** @internal for tests */
export function forgetWorkspaceStorage(): void {
  current?.close();
  current = null;
}

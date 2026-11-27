import { useSyncExternalStore } from 'react';
import { version as BUILT } from '../../../package.json';

/* A tab left open across a release keeps running the old code: nothing reloads it. This asks the server which version
   it runs now and then (when the tab comes back into view, at most every few minutes) and, when it is newer than the
   code in this tab, says so, so the workspace can offer a reload. It never reloads by itself: that could lose a
   half-typed sentence or a build in progress. */

const EVERY_MS = 5 * 60 * 1000;
let newer: string | null = null;
let last = 0;
const listeners = new Set<() => void>();

/** The version this tab's code was built from. */
export const builtVersion = BUILT;

/** True when `server` is a later version than `here` (plain x.y.z numbers; anything else is never newer). */
export function isNewer(server: string, here: string): boolean {
  const p = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
  const a = p(server),
    b = p(here);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Asks /api/health once, if the last check is old enough. Any failure is silent: the tab keeps working as it is. */
export async function checkForUpdate(force?: boolean): Promise<string | null> {
  if (newer) return newer;
  const now = Date.now();
  if (!force && now - last < EVERY_MS) return null;
  last = now;
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    const v = body && typeof body === 'object' && 'version' in body ? (body as { version: unknown }).version : null;
    if (typeof v === 'string' && isNewer(v, BUILT)) {
      newer = v;
      listeners.forEach((f) => f());
    }
  } catch {
    /* offline or the server is away: try again later */
  }
  return newer;
}

/** Starts the checks: when the tab comes back into view or the connection returns, and every few minutes while open. */
export function watchForUpdate(): () => void {
  const onShow = () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  };
  document.addEventListener('visibilitychange', onShow);
  window.addEventListener('online', onShow);
  const t = window.setInterval(onShow, EVERY_MS);
  return () => {
    document.removeEventListener('visibilitychange', onShow);
    window.removeEventListener('online', onShow);
    window.clearInterval(t);
  };
}

const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
/** The newer version the server runs, once a check has found one; null until then. */
export const useNewerVersion = () =>
  useSyncExternalStore(
    subscribe,
    () => newer,
    () => null,
  );

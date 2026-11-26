'use client';

import { useState } from 'react';
import { ErrorScreen } from '@/platform/error-screen';
import { flushOnHide, openWorkspaceStorage } from '@/platform/storage';
import { U, attachStorage, notify } from './core';
import { setFlowAvailable } from './flow';
import { boot, Root } from './shell-c';

type PageOptions = { __turnkeyOptions?: { canvas?: boolean } };
let started = false;

/**
 * Starts the workspace once (state, storage, SQLite, listeners) and draws it. The splash shows until the saved data
 * is read from IndexedDB; then `boot()` loads the state from it as before.
 */
function start() {
  if (started) return;
  started = true;
  void openWorkspaceStorage((p) => console.warn('[storage]', p.message))
    .catch(() => null) // never expected: the adapter falls back to memory instead of failing
    .then((storage) => {
      if (storage) attachStorage(storage.lsCompat());
      boot();
      // after boot(), so its own save on pagehide runs first and this one writes the result to IndexedDB
      if (storage) flushOnHide(storage);
      preloadWhenIdle();
    })
    .catch((e: unknown) => {
      U.boot = 'error';
      U.bootErr = String((e as Error)?.message || e);
      notify();
    });
  // `window.__turnkeyOptions = { canvas: false }` (set before the page loads) shows the plain line of stations.
  setFlowAvailable((window as unknown as PageOptions).__turnkeyOptions?.canvas !== false);
}

/**
 * The build orchestrator (LangGraph) and the AG-UI client load on first use, not with the page. Fetch them once the
 * page is idle, so the first build does not wait for them and the service worker keeps them for offline use.
 */
function preloadWhenIdle() {
  const load = () => {
    void import('@/platform/orchestrator/run').catch(() => undefined);
    void import('@/platform/agui/client').catch(() => undefined);
    void import('@/shared/agent-contract').catch(() => undefined);
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(load, { timeout: 4000 });
  else setTimeout(load, 1500);
}

export default function Workspace() {
  useState(start);
  return (
    <ErrorScreen>
      <Root />
    </ErrorScreen>
  );
}

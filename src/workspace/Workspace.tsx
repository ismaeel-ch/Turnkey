'use client';

import { useState } from 'react';
import { ErrorScreen } from '@/platform/error-screen';
import { flushOnHide, openWorkspaceStorage } from '@/platform/storage';
import { S, U, attachStorage, notify } from './core';
import { listenForStorageProblems, noteStorageProblem } from './errors';
import { setFlowAvailable } from './flow';
import { boot, Root } from './shell-c';
import { startHistory } from './history';

type PageOptions = { __turnkeyOptions?: { canvas?: boolean } };
let started = false;

/**
 * Starts the workspace once (state, storage, SQLite, listeners) and draws it. The splash shows until the saved data
 * is read from IndexedDB; then `boot()` loads the state from it as before.
 */
function start() {
  if (started) return;
  started = true;
  // `window.__turnkeyOptions = { canvas: false }` (set before the page loads) shows the plain line of stations.
  // React Flow (about 60 KB) is fetched once the first screen is up, not beside it; the plain line shows until then.
  const noCanvas = (window as unknown as PageOptions).__turnkeyOptions?.canvas === false;
  if (noCanvas) setFlowAvailable(false);
  listenForStorageProblems();
  void openWorkspaceStorage((p) => {
    console.warn('[storage]', p.message);
    noteStorageProblem(p.kind, p.message);
  })
    .catch(() => null) // never expected: the adapter falls back to memory instead of failing
    .then((storage) => {
      if (storage) attachStorage(storage.lsCompat());
      boot();
      startHistory();
      // after boot(), so its own save on pagehide runs first and this one writes the result to IndexedDB
      if (storage) flushOnHide(storage);
      // On a first visit the welcome screen needs neither the canvas nor the orchestrator, and on a phone parsing them
      // blocks taps on it for a few hundred milliseconds. Wait until the visitor does something (or a while passes).
      const later = S.onboarded ? (fn: () => void) => fn() : afterFirstInput;
      later(() => {
        if (!noCanvas) whenIdle(() => setFlowAvailable(true), 1000);
        preloadWhenIdle();
      });
    })
    .catch((e: unknown) => {
      U.boot = 'error';
      U.bootErr = String((e as Error)?.message || e);
      notify();
    });
}

/** Runs `fn` on the visitor's first tap, click or key press, or after `FIRST_INPUT_WAIT`, whichever comes first. */
const FIRST_INPUT_WAIT = 15000;
function afterFirstInput(fn: () => void) {
  const kinds = ['pointerdown', 'keydown'] as const;
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    kinds.forEach((k) => window.removeEventListener(k, go, true));
    clearTimeout(timer);
    fn();
  };
  kinds.forEach((k) => window.addEventListener(k, go, { capture: true, passive: true }));
  const timer = setTimeout(go, FIRST_INPUT_WAIT);
}

function whenIdle(fn: () => void, timeout: number) {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(fn, { timeout });
  else setTimeout(fn, 200);
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
    // the screens drawn through later(): fetched now so the first click on one does not wait for the network
    for (const ui of [
      () => import('./release-ui'),
      () => import('./tests-ui'),
      () => import('./tester-ui'),
      () => import('./share-ui'),
      () => import('./room-ui'),
      () => import('./flow-ui'),
      () => import('./activity-ui'),
      () => import('./custom-ui'),
    ])
      void ui().catch(() => undefined);
  };
  // a few seconds in, so parsing them does not hold up the first screen; then at the next idle moment
  setTimeout(() => whenIdle(load, 4000), 5000);
}

export default function Workspace() {
  useState(start);
  return (
    <ErrorScreen>
      <Root />
    </ErrorScreen>
  );
}

'use client';

import { useState } from 'react';
import { ErrorScreen } from '@/platform/error-screen';
import { setFlowAvailable } from './flow';
import { boot, Root } from './shell-c';

type PageOptions = { __turnkeyOptions?: { canvas?: boolean } };
let started = false;

/** Starts the workspace once (state, storage, SQLite, listeners) and draws it. */
function start() {
  if (started) return;
  started = true;
  boot();
  // `window.__turnkeyOptions = { canvas: false }` (set before the page loads) shows the plain line of stations.
  setFlowAvailable((window as unknown as PageOptions).__turnkeyOptions?.canvas !== false);
}

export default function Workspace() {
  useState(start);
  return (
    <ErrorScreen>
      <Root />
    </ErrorScreen>
  );
}

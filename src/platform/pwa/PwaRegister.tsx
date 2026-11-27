'use client';

import { useEffect } from 'react';
import { watchInstallPrompt } from './prompt';
import { registerWorker, removeWorkers } from './register';
import { watchForUpdate } from './update';

/** Listens for the browser's install offer, and starts the service worker once the page has loaded (and removes it in development). Renders nothing, and a
 *  failure here is never allowed to show: the app works without the worker. */
// As soon as this file runs in the browser: the offer can come before React has mounted anything.
watchInstallPrompt();

export default function PwaRegister() {
  useEffect(() => {
    const run = process.env.NODE_ENV === 'production' ? registerWorker : removeWorkers;
    run().catch(() => {});
    return process.env.NODE_ENV === 'production' ? watchForUpdate() : undefined;
  }, []);
  return null;
}

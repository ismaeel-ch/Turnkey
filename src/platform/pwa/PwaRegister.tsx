'use client';

import { useEffect } from 'react';
import { registerWorker, removeWorkers } from './register';

/** Starts the service worker once the page has loaded (and removes it in development). Renders nothing, and a
 *  failure here is never allowed to show: the app works without the worker. */
export default function PwaRegister() {
  useEffect(() => {
    const run = process.env.NODE_ENV === 'production' ? registerWorker : removeWorkers;
    run().catch(() => {});
  }, []);
  return null;
}

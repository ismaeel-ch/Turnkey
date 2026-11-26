'use client';

import { useEffect } from 'react';
import { registerWorker } from './register';

/** Starts the service worker once the page has loaded. Renders nothing. A failure here is never allowed to show. */
export default function PwaRegister() {
  useEffect(() => {
    try {
      if (process.env.NODE_ENV !== 'production') return;
      registerWorker().catch(() => {});
    } catch {
      /* the page works without the worker */
    }
  }, []);
  return null;
}

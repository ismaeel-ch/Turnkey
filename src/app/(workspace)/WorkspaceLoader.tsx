'use client';

import dynamic from 'next/dynamic';
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react';
import { isBootIntent, onWorkspaceDrawn, setBootIntent, workspaceDrawn } from '@/platform/boot-intent';

/*
 * The workspace keeps its state in browser storage and runs SQLite in the browser, so it renders on the client only.
 * Until it has drawn, this shows its children: the boot screen the server drew (BootScreen, passed in by the page).
 * Then it stops drawing them, so the page holds one welcome screen, not a hidden copy beside the real one.
 *
 * Its script is large, and on a phone running it holds up the page for half a second or more. A returning visitor or
 * an address that opens an app needs it at once, so it loads at once. A first visit sees the server's welcome screen,
 * which needs no script, so the workspace loads on the visitor's first tap or key press, or after FIRST_VISIT_WAIT,
 * whichever comes first. A button pressed on that welcome screen is remembered (boot-intent.ts) and done once the
 * workspace's own welcome screen is up.
 */
const FIRST_VISIT_WAIT = 3000;

// Through next/dynamic, so the bundle budget (scripts/check-bundle.mjs) still counts it. It loads when first drawn.
const Workspace = dynamic(() => import('@/workspace/Workspace'), { ssr: false, loading: () => null });

export default function WorkspaceLoader({ children }: { children: ReactNode }) {
  const drawn = useSyncExternalStore(onWorkspaceDrawn, workspaceDrawn, () => false);
  const [start, setStart] = useState(false);
  useEffect(() => {
    const html = document.documentElement;
    const kinds = ['pointerdown', 'keydown'] as const;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(timer);
      kinds.forEach((k) => window.removeEventListener(k, go, true));
    };
    const go = () => {
      stop();
      setStart(true);
    };
    const onPress = (e: Event) => {
      const b = e.target instanceof Element ? e.target.closest('[data-boot]') : null;
      const intent = b && b.getAttribute('data-boot');
      if (isBootIntent(intent)) {
        setBootIntent(intent);
        html.classList.add('tk-opening');
        const wait = document.querySelector('#boot-welcome .boot-wait');
        if (wait) wait.textContent = 'Opening Turnkey';
      }
      go();
    };
    // clicks on the welcome's buttons count even after the workspace started loading
    document.addEventListener('click', onPress, true);
    if (html.classList.contains('tk-seen')) go();
    else {
      kinds.forEach((k) => window.addEventListener(k, go, { capture: true, passive: true }));
      timer = setTimeout(go, FIRST_VISIT_WAIT);
    }
    return () => {
      stop();
      document.removeEventListener('click', onPress, true);
    };
  }, []);
  return (
    <>
      {!drawn && children}
      {start && <Workspace />}
    </>
  );
}

'use client';

import { useEffect } from 'react';
import { boot } from './boot';

const SPLASH = '<div id="boot"><strong>Turnkey</strong><span>Loading</span></div>';
const FAILED = '<strong>Turnkey could not load.</strong><span>Reload the page. If it keeps happening, check the connection.</span>';

/**
 * The page element the workspace draws into. React renders the empty host once and never again; the workspace
 * (src/legacy, run by boot.ts) owns everything inside it through its own React root.
 */
export default function LegacyApp() {
  useEffect(() => {
    boot().catch((e) => {
      console.error('[turnkey] boot failed', e);
      const el = document.getElementById('boot');
      if (el) el.innerHTML = FAILED;
    });
  }, []);
  return <div id="root" suppressHydrationWarning dangerouslySetInnerHTML={{ __html: SPLASH }} />;
}

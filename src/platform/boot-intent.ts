/* On a first visit the welcome screen is plain HTML from the server (BootScreen in src/platform/boot-screen.tsx) and
   the workspace script loads on the visitor's first tap or key press, or a few seconds after the page is up
   (WorkspaceLoader). A button pressed on that screen is kept here until the workspace's own welcome screen is drawn,
   which then does what was asked (Onboarding in src/workspace/shell-c.tsx). Tiny on purpose: the loader imports it. */

/** What a button on the server's welcome screen asks for: try the sample, describe your own app, or get started. */
export type BootIntent = 'sample' | 'own' | 'start';
const INTENTS: readonly string[] = ['sample', 'own', 'start'];
export const isBootIntent = (v: unknown): v is BootIntent => typeof v === 'string' && INTENTS.includes(v);

let intent: BootIntent | null = null;

export function setBootIntent(i: BootIntent) {
  intent = i;
}

/** The button pressed before the workspace was ready, once: it is forgotten as it is read. */
export function takeBootIntent(): BootIntent | null {
  const i = intent;
  intent = null;
  return i;
}

let drawn = false;
const onDrawn = new Set<() => void>();
/** The workspace has drawn its first screen: the one the server drew is hidden at once and then taken out of the page. */
export function bootScreenDone() {
  document.documentElement.classList.add('tk-up');
  if (drawn) return;
  drawn = true;
  onDrawn.forEach((f) => f());
}
/** For useSyncExternalStore in WorkspaceLoader, which stops drawing the boot screen once the workspace has drawn. */
export const workspaceDrawn = () => drawn;
export function onWorkspaceDrawn(f: () => void) {
  onDrawn.add(f);
  return () => {
    onDrawn.delete(f);
  };
}

/* The saved state is in IndexedDB, which cannot be read before the first paint, so the workspace keeps one small
   localStorage flag beside it: set once the welcome is finished, cleared when the data is reset. Outside the
   workspace's key prefix, so the move to IndexedDB leaves it alone. */
export const WELCOMED_KEY = 'turnkey:welcomed';
/** Called by the workspace whenever it knows whether the welcome is finished. */
export function noteWelcomed(done: boolean) {
  try {
    if (done) localStorage.setItem(WELCOMED_KEY, '1');
    else localStorage.removeItem(WELCOMED_KEY);
  } catch {
    // storage blocked: the boot screen then shows "Loading", which is right for everyone but a first visit
  }
}

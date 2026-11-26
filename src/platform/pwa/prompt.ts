// The browser's own install offer. Chrome and Edge fire `beforeinstallprompt` once a page's manifest is installable;
// the page keeps the event and calls `prompt()` from a click. Safari and Firefox never fire it: there the person
// installs from the browser's menu, and `installHint()` says where.

/** The event Chrome fires. Not in the DOM typings because it is not a standard. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

let offer: InstallPromptEvent | null = null;
let installedAt = 0;
let watching = false;
const subs = new Set<() => void>();
const tell = () => subs.forEach((f) => f());

const isOffer = (e: Event): e is InstallPromptEvent => typeof (e as Partial<InstallPromptEvent>).prompt === 'function';

/** Starts listening. Call it once, as early as possible: the browser makes its offer soon after the page loads. */
export function watchInstallPrompt(win: Window | undefined = typeof window === 'undefined' ? undefined : window): void {
  if (!win || watching) return;
  watching = true;
  win.addEventListener('beforeinstallprompt', (e) => {
    if (!isOffer(e)) return;
    e.preventDefault(); // keep it for the Install button instead of the browser's own mini bar
    offer = e;
    tell();
  });
  win.addEventListener('appinstalled', () => {
    offer = null;
    installedAt = Date.now();
    tell();
  });
}

/** True when the browser has offered to install the page's current manifest. */
export const canPromptInstall = (): boolean => offer !== null;

/** When the browser last reported an install from this page, or 0. */
export const lastInstalledAt = (): number => installedAt;

/** Drops the kept offer; used when the page's manifest changes. */
export function forgetInstallPrompt(): void {
  if (!offer) return;
  offer = null;
  tell();
}

/** Shows the browser's install dialog. Must run from a click. */
export async function promptInstall(): Promise<InstallOutcome> {
  const e = offer;
  if (!e) return 'unavailable';
  offer = null; // an offer can be used once
  tell();
  try {
    await e.prompt();
    return (await e.userChoice).outcome;
  } catch {
    return 'unavailable';
  }
}

/** For useSyncExternalStore: calls `fn` whenever the offer comes or goes. */
export function onInstallPrompt(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** True when the page runs as an installed app, in its own window. */
export function runningInstalled(win: Window | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!win) return false;
  try {
    if (win.matchMedia?.('(display-mode: standalone)').matches || win.matchMedia?.('(display-mode: window-controls-overlay)').matches)
      return true;
  } catch {
    /* no media queries */
  }
  return (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Where to find Install when the browser makes no offer of its own. */
export function installHint(userAgent: string): string {
  const ua = userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua)))
    return /iPhone|iPad|iPod/.test(ua)
      ? 'In Safari, tap Share, then Add to Home Screen.'
      : 'In Safari, open the File menu and choose Add to Dock.';
  if (/Firefox/.test(ua)) return 'Firefox cannot install web apps on a computer. Open the link in Chrome, Edge or Safari to install it.';
  if (/Edg\//.test(ua)) return 'In Edge, open the menu (…), then Apps, then Install this site as an app.';
  if (/Android/.test(ua)) return 'In the browser menu (⋮), choose Install app or Add to Home screen.';
  return 'In the browser menu (⋮), choose Cast, save and share, then Install page as app. Or use the install icon at the right of the address bar.';
}

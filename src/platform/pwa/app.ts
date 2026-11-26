// How the workspace asks for an app to be installed under its own name and icon.
//
// The workspace owns an app's identity (its name, accent and logo choice). It hands that over as an `AppInstallInput`;
// this module checks it, builds the two addresses the browser needs, and swaps the page's manifest link. Nothing
// here trusts the input: a name is reduced to safe characters and every choice must come from the catalogs.
import { identityQuery, MAX_CODE, parseIdentity, type AppIdentity } from './identity';
import { forgetInstallPrompt } from './prompt';

/** What the workspace knows about one app. Every field is optional text, because it may come from a share link. */
export type AppInstallInput = {
  name?: string;
  /** Accent colour key, for example "teal". */
  accent?: string;
  /** Symbol key from the workspace's icon set, for example "rocket". */
  glyph?: string;
  /** The logo choices of `logoOf(app)` in src/workspace/release.tsx. */
  shape?: string;
  fill?: string;
  mark?: string;
  /** The share code of the released version, so the installed app opens that version. */
  shareCode?: string;
  /** The app's lasting id, the same in every version. Preferred over the share code for the start address. */
  key?: string;
};

export type AppInstallLinks = {
  identity: AppIdentity;
  /** For `<link rel="manifest">`. */
  manifestUrl: string;
  /** For `<link rel="apple-touch-icon">` and for showing the icon in the install dialog. */
  iconUrl: (size?: number) => string;
};

/** Returns the links for one app, or null when the input has a value outside the catalogs. */
export function appInstallLinks(input: AppInstallInput): AppInstallLinks | null {
  const q = new URLSearchParams();
  const set = (k: string, v: string | undefined) => v && q.set(k, v);
  set('name', input.name);
  set('accent', input.accent);
  set('glyph', input.glyph);
  set('shape', input.shape);
  set('fill', input.fill);
  set('mark', input.mark);
  // A share code longer than the manifest can carry is left out; the key still brings the app back.
  if (input.shareCode && input.shareCode.length <= MAX_CODE) set('c', input.shareCode);
  set('key', input.key);
  const parsed = parseIdentity(q);
  if (!parsed.ok) return null;
  const identity = parsed.identity;
  return {
    identity,
    manifestUrl:
      '/a/manifest?' +
      identityQuery(identity, { ...(identity.code ? { c: identity.code } : {}), ...(identity.key ? { key: identity.key } : {}) }),
    iconUrl: (size = 192) => '/a/icon?' + identityQuery(identity, { size: String(size) }),
  };
}

/** Points the page's manifest link and home-screen icon at one app, or back at Turnkey when `links` is null.
 *  Next.js may stream its metadata links into the body, so every matching link in the document changes.
 *  Returns false when there is no document to change. */
export function setInstallLinks(doc: Document | undefined, links: AppInstallLinks | null): boolean {
  if (!doc) return false;
  const point = (rel: string, href: string) => {
    const found = [...doc.querySelectorAll<HTMLLinkElement>('link[rel="' + rel + '"]')];
    // An install offer the browser made for the old manifest would install the wrong app; it offers again.
    if (rel === 'manifest' && found.some((el) => el.getAttribute('href') !== href)) forgetInstallPrompt();
    if (!found.length) {
      const el = doc.createElement('link');
      el.rel = rel;
      doc.head.appendChild(el);
      found.push(el);
    }
    for (const el of found) if (el.getAttribute('href') !== href) el.setAttribute('href', href);
  };
  point('manifest', links ? links.manifestUrl : '/manifest.webmanifest');
  point('apple-touch-icon', links ? links.iconUrl(180) : '/apple-icon.png');
  return true;
}

/** Like setInstallLinks, and keeps it so while the app is open: Next.js and React may put Turnkey's own manifest link
 *  and title back when they render the page's metadata late, and the browser must keep seeing the app's.
 *  Returns the function that stops watching. */
export function holdInstallLinks(doc: Document | undefined, links: AppInstallLinks | null, title?: string): () => void {
  if (!doc) return () => {};
  const apply = () => {
    setInstallLinks(doc, links);
    if (title !== undefined && doc.title !== title) doc.title = title;
  };
  apply();
  const Observer = doc.defaultView?.MutationObserver;
  if (!Observer) return () => {};
  const watch = () =>
    obs.observe(doc.head, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'rel'] });
  const obs = new Observer(() => {
    obs.disconnect(); // its own changes must not wake it again
    apply();
    watch();
  });
  watch();
  return () => obs.disconnect();
}

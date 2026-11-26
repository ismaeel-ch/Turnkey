// How the workspace asks for an app to be installed under its own name and icon.
//
// The workspace owns an app's identity (its name, accent and logo choice). It hands that over as an `AppInstallInput`;
// this module checks it, builds the two addresses the browser needs, and swaps the page's manifest link. Nothing
// here trusts the input: a name is reduced to safe characters and every choice must come from the catalogs.
import { identityQuery, parseIdentity, type AppIdentity } from './identity';

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
  set('c', input.shareCode);
  const parsed = parseIdentity(q);
  if (!parsed.ok) return null;
  const identity = parsed.identity;
  return {
    identity,
    manifestUrl: '/a/manifest?' + identityQuery(identity, identity.code ? { c: identity.code } : {}),
    iconUrl: (size = 192) => '/a/icon?' + identityQuery(identity, { size: String(size) }),
  };
}

/** Points the page's manifest link and home-screen icon at one app, or back at Turnkey when `links` is null.
 *  Returns false when there is no document to change. */
export function setInstallLinks(doc: Document | undefined, links: AppInstallLinks | null): boolean {
  if (!doc) return false;
  const point = (rel: string, href: string) => {
    let el = doc.head.querySelector<HTMLLinkElement>('link[rel="' + rel + '"]');
    if (!el) {
      el = doc.createElement('link');
      el.rel = rel;
      doc.head.appendChild(el);
    }
    el.href = href;
  };
  point('manifest', links ? links.manifestUrl : '/manifest.webmanifest');
  point('apple-touch-icon', links ? links.iconUrl(180) : '/apple-icon.png');
  return true;
}

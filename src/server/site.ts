/**
 * The site's own address, for metadata that needs a full URL (link previews, robots.txt, sitemap.xml).
 *
 * SITE_URL wins when it is set and is a plain http(s) origin. Otherwise development uses localhost and everything
 * else uses the public address. A missing or bad value never throws: it falls back.
 */
export const PUBLIC_SITE_URL = 'https://turnkey-bay.vercel.app';

type Env = Record<string, string | undefined>;

export function siteUrl(env: Env = process.env): URL {
  const raw = env.SITE_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if ((u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password) return new URL(u.origin);
    } catch {
      // fall through to the defaults
    }
  }
  if (env.NODE_ENV === 'development') {
    const port = /^\d{2,5}$/.test(env.PORT ?? '') ? env.PORT : '3000';
    return new URL('http://localhost:' + port);
  }
  return new URL(PUBLIC_SITE_URL);
}

export const SITE_NAME = 'Turnkey';
export const SITE_DESCRIPTION =
  'Describe the app your work needs. A team of agents builds its database, backend, views, pages and tests on a workflow you can watch and change.';

/** Open Graph fields every page shares. A page that sets openGraph replaces the layout's whole object, so it spreads
 *  this first. */
export const BASE_OPEN_GRAPH = {
  type: 'website',
  siteName: SITE_NAME,
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  locale: 'en',
} as const;

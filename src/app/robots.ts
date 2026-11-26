import type { MetadataRoute } from 'next';
import { siteUrl } from '@/server/site';

// Search engines may read the home page. The API and the per-app install files under /a/ are not pages; the early
// spike page says noindex itself (a rule for /spike would also catch short links such as /spike-tracker).
// Shared apps are not listed here: their pages say noindex themselves, and link-preview bots must still reach them.
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/a/'] },
    sitemap: new URL('/sitemap.xml', base).toString(),
    host: base.origin,
  };
}

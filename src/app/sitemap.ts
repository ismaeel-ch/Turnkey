import type { MetadataRoute } from 'next';
import { siteUrl } from '@/server/site';

// Turnkey is one page. Shared apps are left out on purpose: they belong to whoever was sent the link.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: siteUrl().toString(), changeFrequency: 'weekly', priority: 1 }];
}

/**
 * The preview of the app shared under a short name, for the page's metadata and its preview image. Null when short
 * links are off, the name is not a short name, nothing is stored under it, or the store cannot be read: a preview is
 * never worth an error page.
 */
import { cache } from 'react';
import { isSlug } from './records';
import { previewOf, type AppPreview } from './preview';
import { readShare } from './service';
import { resolveShareStore } from './store';

export const sharedPreview = cache(async (slug: string): Promise<AppPreview | null> => {
  if (!isSlug(slug)) return null;
  const store = resolveShareStore();
  if (!store) return null;
  try {
    const found = await readShare(store, slug);
    return found ? previewOf(found) : null;
  } catch {
    return null;
  }
});

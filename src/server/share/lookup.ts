/**
 * The preview of the app shared under a short name, for the page's metadata and its preview image. Null when short
 * links are off, the name is not a short name, nothing is stored under it, the store cannot be read, or the store has
 * been read too often this minute: a preview is never worth an error page.
 *
 * Every /<name> page and its preview picture ask for this, and those routes have no per-visitor limit of their own, so
 * a bot walking random paths (/wp-admin, /login, ...) would cost one store read each. Answers are kept for ten
 * minutes, misses included, and at most PREVIEW_READS_PER_MINUTE store reads happen per minute on one instance.
 */
import { cache } from 'react';
import { isSlug } from './records';
import { previewOf, type AppPreview } from './preview';
import { readShare } from './service';
import { resolveShareStore, type ShareStore } from './store';

export const PREVIEW_TTL_MS = 10 * 60_000;
export const PREVIEW_READS_PER_MINUTE = 60;
const MAX_KEPT = 500;

type Read = (slug: string) => Promise<{ name: string; code: string } | null>;

export function createPreviewLookup(now: () => number = Date.now) {
  const kept = new Map<string, { at: number; preview: AppPreview | null }>();
  let minute = { start: 0, count: 0 };
  return async (slug: string, read: Read): Promise<AppPreview | null> => {
    if (!isSlug(slug)) return null;
    const t = now();
    const hit = kept.get(slug);
    if (hit && t - hit.at < PREVIEW_TTL_MS) return hit.preview;
    if (t - minute.start >= 60_000) minute = { start: t, count: 0 };
    if (minute.count >= PREVIEW_READS_PER_MINUTE) return hit ? hit.preview : null;
    minute.count++;
    let preview: AppPreview | null;
    try {
      const found = await read(slug);
      preview = found ? previewOf(found) : null;
    } catch {
      return null; // a store that is down is not remembered as "nothing here"
    }
    kept.delete(slug);
    kept.set(slug, { at: t, preview });
    if (kept.size > MAX_KEPT) kept.delete(kept.keys().next().value as string);
    return preview;
  };
}

const lookup = createPreviewLookup();

export const sharedPreview = cache(async (slug: string): Promise<AppPreview | null> => {
  if (!isSlug(slug)) return null;
  const store: ShareStore | null = resolveShareStore();
  if (!store) return null;
  return lookup(slug, (s) => readShare(store, s));
});

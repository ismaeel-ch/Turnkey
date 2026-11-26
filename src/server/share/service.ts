/**
 * Saving and reading short links, on top of a store. The routes in src/app/api/share call these.
 */
import { checkCode, hashToken, isSlug, newToken, slugCandidates, tokenMatches, type ShareRecord } from './records';
import type { ShareStore } from './store';

export type SaveResult =
  { ok: true; slug: string; token?: string; created: boolean } | { ok: false; status: 400 | 403 | 409; error: string };

/** Saves a code. With the slug and token from an earlier save, the same name gets the newer code; otherwise a new
 *  name is picked from the app's name. */
export async function saveShare(
  store: ShareStore,
  input: { code: string; name: string; slug?: string; token?: string },
  now: () => Date = () => new Date(),
): Promise<SaveResult> {
  const checked = checkCode(input.code);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  const name = input.name.trim().slice(0, 200) || 'Shared app';
  const at = now().toISOString();

  if (input.slug && input.token) {
    if (!isSlug(input.slug)) return { ok: false, status: 400, error: 'That short name is not valid.' };
    const old = await store.read(input.slug);
    if (old) {
      if (!tokenMatches(input.token, old.tokenHash))
        return { ok: false, status: 403, error: 'Only whoever made this short link can change it.' };
      await store.write({ ...old, name, code: input.code, updated: at }, { create: false });
      return { ok: true, slug: old.slug, created: false };
    }
    // the record is gone (a new store, say): fall through and make a new name
  }

  const token = newToken();
  for (const slug of slugCandidates(name)) {
    const record: ShareRecord = { v: 1, slug, name, code: input.code, tokenHash: hashToken(token), created: at, updated: at };
    if (await store.write(record, { create: true })) return { ok: true, slug, token, created: true };
  }
  return { ok: false, status: 409, error: 'No free short name was found for this app. Rename it and try again.' };
}

/** The code and name stored under a short name, or null. */
export async function readShare(
  store: ShareStore,
  slug: string,
): Promise<{ slug: string; name: string; code: string; updated: string } | null> {
  if (!isSlug(slug)) return null;
  const r = await store.read(slug);
  return r ? { slug: r.slug, name: r.name, code: r.code, updated: r.updated } : null;
}

// Short links for shared apps, browser side: talks to /api/share on this site only (never to a storage service).
// Every answer is checked before use; a failure is a value, never a throw, so the long link always remains.

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export type SaveOutcome =
  { ok: true; slug: string; path: string; token?: string } | { ok: false; reason: 'off' | 'forbidden' | 'failed'; message: string };

export type LoadOutcome =
  { ok: true; slug: string; name: string; code: string } | { ok: false; reason: 'missing' | 'offline' | 'off' | 'failed'; message: string };

const text = (v: unknown, max: number): string => (typeof v === 'string' && v.length <= max ? v : '');

/** Saves a share code under a short name; with an earlier slug and token, puts the newer code under that name. */
export async function saveShortLink(
  input: { code: string; name: string; slug?: string; token?: string },
  fetcher: typeof fetch = fetch,
): Promise<SaveOutcome> {
  let res: Response;
  try {
    res = await fetcher('/api/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, reason: 'failed', message: 'No connection, so the long link is shown.' };
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  if (res.status === 503) return { ok: false, reason: 'off', message: text(body.message, 300) || 'Short links are not set up here.' };
  if (res.status === 403) return { ok: false, reason: 'forbidden', message: text(body.message, 300) };
  const slug = text(body.slug, 40);
  if (!res.ok || !SLUG_RE.test(slug))
    return { ok: false, reason: 'failed', message: text(body.message, 300) || 'The short link could not be saved.' };
  const token = text(body.token, 100);
  return { ok: true, slug, path: '/' + slug, ...(token ? { token } : {}) };
}

/** Reads the share code saved under a short name. */
export async function loadShortLink(slug: string, fetcher: typeof fetch = fetch): Promise<LoadOutcome> {
  if (!SLUG_RE.test(slug)) return { ok: false, reason: 'missing', message: 'That is not a short link.' };
  let res: Response;
  try {
    res = await fetcher('/api/share/' + slug, { cache: 'no-store' });
  } catch {
    return { ok: false, reason: 'offline', message: 'No connection.' };
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  if (res.status === 404) return { ok: false, reason: 'missing', message: 'No app is shared under this address. Ask for the link again.' };
  if (res.status === 503) return { ok: false, reason: 'off', message: 'Short links are not set up on this site.' };
  const code = text(body.code, 900_000);
  if (!res.ok || !/^[01]\.[A-Za-z0-9_-]+$/.test(code))
    return { ok: false, reason: 'failed', message: 'The shared app could not be loaded.' };
  return { ok: true, slug, name: text(body.name, 200), code };
}

/** The short name in an address path such as "/clinic-desk", or null. */
export function slugFromPath(pathname: string): string | null {
  const m = /^\/([a-z0-9-]{3,40})\/?$/.exec(pathname || '');
  return m && SLUG_RE.test(m[1]) ? m[1] : null;
}

/**
 * Short links for shared apps: the rules for a short name, and the checks on what may be stored under one.
 *
 * A shared app is its share code ("1." and the app packed with deflate-raw, base64url), the same thing a long
 * "#app=" link carries. A short link stores that code on the server under a name made from the app's name, so
 * https://<site>/clinic-desk opens the app. The owner gets a token with the first save; only that token can put a
 * newer version under the same name. Everything here is pure, so it is tested without storage.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { z } from 'zod';

/** The longest code a link may carry (the workspace's SHARE.maxCode). */
export const MAX_CODE = 900_000;
/** The most the packed app may grow to when unpacked (the workspace's SHARE.maxJson). */
export const MAX_JSON = 5_000_000;
export const MIN_SLUG = 3;
export const MAX_SLUG = 40;
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** Names the site already uses at the top level, or that would read as part of the site. */
export const RESERVED = new Set([
  'a',
  'api',
  'app',
  'apps',
  'admin',
  'about',
  'help',
  'login',
  'logout',
  'signin',
  'signup',
  'settings',
  'share',
  'shared',
  'spike',
  'turnkey',
  'vendor',
  'icons',
  'icon',
  'static',
  'public',
  'manifest',
  'sw',
  'favicon',
  'new',
  'home',
  'index',
  'null',
  'undefined',
  'www',
]);

/** "Clinic Desk!" → "clinic-desk". Letters with accents lose them; anything else becomes a dash. */
export function slugify(name: string): string {
  const s = String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG - 5) // room for "-1234"
    .replace(/-+$/g, '');
  const base = s.length >= MIN_SLUG ? s : s ? s + '-app' : 'my-app';
  return RESERVED.has(base) ? base + '-app' : base;
}

export const isSlug = (s: string): boolean => SLUG_RE.test(s) && !RESERVED.has(s);

/** The names to try for an app, in order: its own, then numbered, then with a random ending. */
export function slugCandidates(name: string, random: () => string = () => randomBytes(3).toString('hex').slice(0, 4)): string[] {
  const base = slugify(name);
  return [base, ...[2, 3, 4, 5].map((n) => base + '-' + n), base + '-' + random(), base + '-' + random()];
}

/** Checks a share code is what the workspace makes: the right form, a size the link allows, and an app inside. */
export function checkCode(code: string): { ok: true } | { ok: false; error: string } {
  const m = /^([01])\.([A-Za-z0-9_-]+)$/.exec(code);
  if (!m) return { ok: false, error: 'That is not a share code.' };
  if (code.length > MAX_CODE) return { ok: false, error: 'That app is too large to share.' };
  let text: string;
  try {
    const bytes = Buffer.from(m[2], 'base64url');
    text = (m[1] === '1' ? inflateRawSync(bytes, { maxOutputLength: MAX_JSON }) : bytes).toString('utf8');
  } catch {
    return { ok: false, error: 'The share code is damaged.' };
  }
  let pack: unknown;
  try {
    pack = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The share code is damaged.' };
  }
  const p = pack as { f?: unknown; v?: unknown; research?: unknown; database?: unknown } | null;
  if (!p || p.f !== 'formwork-app' || p.v !== 1 || typeof p.research !== 'object' || typeof p.database !== 'object')
    return { ok: false, error: 'That share code does not hold an app.' };
  return { ok: true };
}

export const newToken = (): string => randomBytes(24).toString('base64url');
export const hashToken = (token: string): string =>
  createHash('sha256')
    .update('turnkey-share:' + token)
    .digest('hex');
export function tokenMatches(token: string, hash: string): boolean {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(/^[0-9a-f]{64}$/.test(hash) ? hash : '', 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What is stored under one short name. */
export const shareRecordSchema = z.object({
  v: z.literal(1),
  slug: z.string().regex(SLUG_RE),
  name: z.string().max(200),
  code: z.string().max(MAX_CODE),
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  created: z.string(),
  updated: z.string(),
});
export type ShareRecord = z.infer<typeof shareRecordSchema>;

/** The body of POST /api/share. */
export const shareRequestSchema = z.object({
  code: z.string().min(3).max(MAX_CODE),
  name: z.string().max(200),
  slug: z.string().max(MAX_SLUG).optional(),
  token: z.string().max(100).optional(),
});

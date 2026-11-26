/**
 * What a link preview may show about a shared app: its name, its icon and a one-line description. Nothing else from
 * the app (tables, rows, users, who made it, the request it was built from) leaves the server this way.
 *
 * The share code is untrusted. It is unpacked with the same size limit as checkCode, and every field read from it is
 * either matched against a fixed catalog (the icon) or reduced to plain text (the name and description).
 */
import { inflateRawSync } from 'node:zlib';
import {
  ACCENT_COLORS,
  LOGO_FILLS,
  LOGO_MARKS,
  LOGO_SHAPES,
  cleanName,
  isGlyph,
  type Accent,
  type AppIdentity,
} from '@/platform/pwa/identity';
import { MAX_JSON } from './records';

export type AppIcon = Pick<AppIdentity, 'accent' | 'glyph' | 'shape' | 'fill' | 'mark'>;
export type AppPreview = { name: string; description: string; icon: AppIcon };

export const MAX_DESCRIPTION = 200;
export const DEFAULT_DESCRIPTION = 'An app built with Turnkey. Open it to try it in your browser.';

type Loose = Record<string, unknown>;
const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const pick = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;

/** Plain text on one line, at most `max` characters, cut at a word where it can be. */
export function cleanText(raw: unknown, max = MAX_DESCRIPTION): string {
  const s = str(raw)
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, '') + '…';
}

/** The pack inside a share code, or null when it cannot be read. */
export function unpack(code: string): Loose | null {
  const m = /^([01])\.([A-Za-z0-9_-]+)$/.exec(code);
  if (!m) return null;
  try {
    const bytes = Buffer.from(m[2], 'base64url');
    const text = (m[1] === '1' ? inflateRawSync(bytes, { maxOutputLength: MAX_JSON }) : bytes).toString('utf8');
    const pack = obj(JSON.parse(text));
    return pack.f === 'formwork-app' && pack.v === 1 ? pack : null;
  } catch {
    return null;
  }
}

/**
 * The icon the workspace draws for an app (logoOf and normLogo in src/workspace/release.tsx): the theme's logo where
 * the UI agent chose one, the rest filled in from a hash of the name and the theme's symbol.
 */
export function iconOf(theme: Loose, name: string): AppIcon {
  const logo = obj(theme.logo);
  const themeIcon = str(theme.icon);
  let n = 0;
  const key = name + '|' + themeIcon;
  for (let i = 0; i < key.length; i++) n = (n * 31 + key.charCodeAt(i)) >>> 0;
  const accent = pick(Object.keys(ACCENT_COLORS) as Accent[], theme.accent) ?? 'blue';
  const glyph = isGlyph(str(logo.glyph)) ? str(logo.glyph) : isGlyph(themeIcon) ? themeIcon : 'apps';
  return {
    accent,
    glyph,
    shape: pick(LOGO_SHAPES, logo.shape) ?? LOGO_SHAPES[n % 5],
    fill: pick(LOGO_FILLS, logo.fill) ?? LOGO_FILLS[(n >>> 3) % 4],
    mark: pick(LOGO_MARKS, logo.mark) ?? LOGO_MARKS[(n >>> 6) % 4],
  };
}

/** The preview for a stored short link. `name` is the name it was saved under; the pack's own name is the fallback. */
export function previewOf(record: { name: string; code: string }): AppPreview {
  const pack = unpack(record.code) ?? {};
  const rawName = str(record.name).trim() || str(pack.name);
  const name = cleanName(rawName);
  const theme = obj(obj(pack.screens).theme);
  const description = cleanText(obj(pack.research).summary) || DEFAULT_DESCRIPTION;
  // the hash uses the app's own name, as the workspace does, so the icon matches what its owner sees
  return { name, description, icon: iconOf(theme, str(pack.name) || rawName) };
}

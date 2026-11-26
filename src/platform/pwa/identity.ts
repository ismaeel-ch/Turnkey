// An app's identity as it arrives in a request: untrusted. Everything here either matches a fixed catalog or is
// reduced to safe characters. The catalogs mirror src/workspace/release.tsx (LOGO_SHAPES, LOGO_FILLS, LOGO_MARKS) and
// the workspace theme (ACCENTS); tests/unit/pwa.test.ts compares the logo lists with the workspace source.
import glyphs from './glyphs.json';

export const LOGO_SHAPES = ['squircle', 'circle', 'hexagon', 'shield', 'tile'] as const;
export const LOGO_FILLS = ['gradient', 'solid', 'split', 'ring'] as const;
export const LOGO_MARKS = ['none', 'dot', 'spark', 'bar'] as const;

/** [solid, dark, light] per accent, as scripts/build-legacy.mjs derives them from the Fluent tokens. */
export const ACCENT_COLORS = {
  teal: ['#037a7e', '#025153', '#4fa8ab'],
  blue: ['#0070c5', '#004a82', '#4da1e1'],
  purple: ['#5c2e91', '#3d1e60', '#8d6db2'],
  cranberry: ['#c50f1f', '#820a14', '#d65762'],
  forest: ['#498205', '#305603', '#80a850'],
  marigold: ['#996900', '#654500', '#f0bf4d'],
  pink: ['#c5338f', '#82225e', '#ec76c1'],
  steel: ['#005b70', '#003c4a', '#4d8c9b'],
  pumpkin: ['#bc4a0f', '#7c310a', '#da8558'],
  lavender: ['#7160e8', '#4b3f99', '#9c90ef'],
  royalBlue: ['#004e8c', '#00335c', '#4d83af'],
  magenta: ['#bf0077', '#7e004f', '#d24da0'],
  navy: ['#0027b4', '#001a77', '#4d68cb'],
  grape: ['#881798', '#5a0f64', '#ac5db7'],
  seafoam: ['#008445', '#00572e', '#4ddb97'],
} as const;

export type Accent = keyof typeof ACCENT_COLORS;
export type Shape = (typeof LOGO_SHAPES)[number];
export type Fill = (typeof LOGO_FILLS)[number];
export type Mark = (typeof LOGO_MARKS)[number];

export type AppIdentity = {
  name: string;
  accent: Accent;
  glyph: string;
  shape: Shape;
  fill: Fill;
  mark: Mark;
  /** The share code of a released version ("1.xxxx"), used for the start address. Empty when none was given. */
  code: string;
  /** The app's lasting id (the same for every version), used for the manifest id and the start address. Empty when
   *  none was given. With a key the installed app reopens the copy saved in this browser, whatever its version. */
  key: string;
};

export type ParseResult = { ok: true; identity: AppIdentity } | { ok: false; error: string };

export const DEFAULT_NAME = 'Turnkey app';
export const MAX_NAME = 40;
export const MAX_CODE = 6000;
export const KEY_RE = /^[A-Za-z0-9_-]{1,40}$/;

const GLYPHS = glyphs as Record<string, string>;
const has = (list: readonly string[], v: string) => list.includes(v);
export const isGlyph = (k: string) => Object.prototype.hasOwnProperty.call(GLYPHS, k);
export const glyphPath = (k: string): string => (isGlyph(k) ? GLYPHS[k] : GLYPHS.apps);

/** Keeps letters, numbers, spaces and a few plain marks; drops everything else (markup, control characters, emoji). */
export function cleanName(raw: string | null | undefined): string {
  const s = String(raw ?? '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\p{M} .,'’&()\-_:!?+/]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    .trim();
  return s || DEFAULT_NAME;
}

/** The query parameters are: name, accent, glyph, shape, fill, mark, c (share code), key (the app's lasting id). Missing ones take a default;
 *  one that is present but not in its catalog is refused. */
export function parseIdentity(q: URLSearchParams): ParseResult {
  const pick = <T extends string>(key: string, list: readonly T[], dflt: T): T | null => {
    const v = q.get(key);
    if (v === null || v === '') return dflt;
    return has(list, v) ? (v as T) : null;
  };
  const accent = pick('accent', Object.keys(ACCENT_COLORS) as Accent[], 'blue');
  if (!accent) return { ok: false, error: 'accent is not one of the colours' };
  const shape = pick('shape', LOGO_SHAPES, 'squircle');
  if (!shape) return { ok: false, error: 'shape is not one of the shapes' };
  const fill = pick('fill', LOGO_FILLS, 'gradient');
  if (!fill) return { ok: false, error: 'fill is not one of the fills' };
  const mark = pick('mark', LOGO_MARKS, 'none');
  if (!mark) return { ok: false, error: 'mark is not one of the marks' };
  const g = q.get('glyph');
  if (g !== null && g !== '' && !isGlyph(g)) return { ok: false, error: 'glyph is not one of the symbols' };
  const c = q.get('c') ?? '';
  if (c !== '' && (c.length > MAX_CODE || !/^[01]\.[A-Za-z0-9_-]+$/.test(c))) return { ok: false, error: 'c is not a share code' };
  const key = q.get('key') ?? '';
  if (key !== '' && !KEY_RE.test(key)) return { ok: false, error: 'key is not an app id' };
  return { ok: true, identity: { name: cleanName(q.get('name')), accent, glyph: g || 'apps', shape, fill, mark, code: c, key } };
}

/** The same identity as a query string, in a fixed order (so equal identities share one cached icon). */
export function identityQuery(id: AppIdentity, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  p.set('name', id.name);
  p.set('accent', id.accent);
  p.set('glyph', id.glyph);
  p.set('shape', id.shape);
  p.set('fill', id.fill);
  p.set('mark', id.mark);
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

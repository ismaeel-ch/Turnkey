import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { TURNKEY_LOGO_SVG } from '@/server/og/turnkey-logo';
import { DEFAULT_DESCRIPTION, cleanText, iconOf, previewOf, unpack } from '@/server/share/preview';
import { isSlug } from '@/server/share/records';
import { PUBLIC_SITE_URL, siteUrl } from '@/server/site';

const code = (pack: unknown) => '1.' + deflateRawSync(Buffer.from(JSON.stringify(pack))).toString('base64url');
const pack = (over: Record<string, unknown> = {}) => ({
  f: 'formwork-app',
  v: 1,
  name: 'Clinic Desk',
  request: 'A private request sentence that must not leak',
  by: 'Secret Person',
  research: { summary: 'The front desk books appointments and doctors record visit notes.' },
  database: { tables: [{ name: 'patients', rows: [{ name: 'Jane Private' }] }], users: [{ name: 'Dr Hidden' }] },
  screens: { theme: { accent: 'teal', icon: 'calendar', logo: { glyph: 'heart', shape: 'circle', fill: 'solid', mark: 'dot' } } },
  ...over,
});

describe('siteUrl', () => {
  it('uses SITE_URL when it is a plain http(s) address, keeping only the origin', () => {
    expect(siteUrl({ SITE_URL: 'https://example.org/some/path?q=1' }).toString()).toBe('https://example.org/');
  });
  it('ignores a bad SITE_URL and never throws', () => {
    expect(siteUrl({ SITE_URL: 'javascript:alert(1)' }).origin).toBe(PUBLIC_SITE_URL);
    expect(siteUrl({ SITE_URL: 'not a url' }).origin).toBe(PUBLIC_SITE_URL);
    expect(siteUrl({ SITE_URL: 'https://user:pw@example.org' }).origin).toBe(PUBLIC_SITE_URL);
  });
  it('uses localhost in development and the public address otherwise', () => {
    expect(siteUrl({ NODE_ENV: 'development' }).origin).toBe('http://localhost:3000');
    expect(siteUrl({ NODE_ENV: 'development', PORT: '4100' }).origin).toBe('http://localhost:4100');
    expect(siteUrl({ NODE_ENV: 'production' }).origin).toBe(PUBLIC_SITE_URL);
    expect(siteUrl({}).origin).toBe(PUBLIC_SITE_URL);
  });
});

describe('previewOf', () => {
  it('shows the name, icon and summary only', () => {
    const p = previewOf({ name: 'Clinic Desk', code: code(pack()) });
    expect(p).toEqual({
      name: 'Clinic Desk',
      description: 'The front desk books appointments and doctors record visit notes.',
      icon: { accent: 'teal', glyph: 'heart', shape: 'circle', fill: 'solid', mark: 'dot' },
    });
    const text = JSON.stringify(p);
    for (const secret of ['private request', 'Secret Person', 'Jane Private', 'Dr Hidden', 'patients']) expect(text).not.toContain(secret);
  });

  it('refuses values outside the catalogs and strips markup from text', () => {
    const p = previewOf({
      name: '<script>alert(1)</script>Desk',
      code: code(
        pack({
          research: { summary: 'Line one\n<img src=x onerror=alert(1)>\u202e and more' },
          screens: { theme: { accent: 'evil', icon: '<svg>', logo: { glyph: 'nope', shape: 'star', fill: 'x', mark: 'y' } } },
        }),
      ),
    });
    expect(p.name).not.toMatch(/[<>]/);
    expect(p.description).not.toMatch(/[<>\n\u202e]/);
    expect(p.icon.accent).toBe('blue');
    expect(p.icon.glyph).toBe('apps');
    expect(['squircle', 'circle', 'hexagon', 'shield', 'tile']).toContain(p.icon.shape);
  });

  it('falls back to defaults for a damaged or foreign code', () => {
    expect(unpack('1.!!!')).toBeNull();
    expect(unpack('0.' + Buffer.from('{"f":"other"}').toString('base64url'))).toBeNull();
    const p = previewOf({ name: '', code: '1.AAAA' });
    expect(p.name).toBe('Turnkey app');
    expect(p.description).toBe(DEFAULT_DESCRIPTION);
    expect(p.icon.glyph).toBe('apps');
  });

  it('fills a missing logo the way the workspace does, from the name and theme symbol', () => {
    const a = iconOf({ icon: 'calendar' }, 'Clinic Desk');
    expect(iconOf({ icon: 'calendar' }, 'Clinic Desk')).toEqual(a);
    expect(a.glyph).toBe('calendar');
  });
});

describe('cleanText', () => {
  it('cuts long text at a word and marks the cut', () => {
    const s = cleanText('word '.repeat(100), 50);
    expect(s.length).toBeLessThanOrEqual(50);
    expect(s.endsWith('…')).toBe(true);
    expect(cleanText(42)).toBe('');
  });
});

describe('site files', () => {
  it('keeps the inline logo equal to src/app/icon.svg', () => {
    expect(TURNKEY_LOGO_SVG).toBe(readFileSync('src/app/icon.svg', 'utf8').trim());
  });
  it('robots.txt keeps the API out and points at the sitemap, without blocking short links', () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.disallow).toEqual(['/api/', '/a/']);
    expect(r.sitemap).toBe(PUBLIC_SITE_URL + '/sitemap.xml');
  });
  it('the sitemap lists the home page only', () => {
    expect(sitemap().map((e) => e.url)).toEqual([PUBLIC_SITE_URL + '/']);
  });
  it('metadata route names cannot be taken as short names', () => {
    for (const s of ['opengraph-image', 'twitter-image', 'apple-icon', 'robots', 'sitemap']) expect(isSlug(s)).toBe(false);
  });
});

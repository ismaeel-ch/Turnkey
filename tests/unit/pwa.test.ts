import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GET as manifestGET } from '@/app/a/manifest/route';
import { GET as iconGET } from '@/app/a/icon/route';
import manifest from '@/app/manifest';
import { ACCENT_COLORS, LOGO_FILLS, LOGO_MARKS, LOGO_SHAPES, cleanName, parseIdentity } from '@/platform/pwa/identity';
import { logoSvg } from '@/platform/pwa/logo';

const root = path.join(__dirname, '..', '..');
const req = (route: string, qs: string) => new Request('http://localhost/a/' + route + '?' + qs);

describe('catalogs', () => {
  const legacy = fs.readFileSync(path.join(root, 'src/legacy/release.js'), 'utf8');
  it('match the workspace', () => {
    expect(legacy).toContain("LOGO_SHAPES = ['" + LOGO_SHAPES.join("', '") + "']");
    expect(legacy).toContain("LOGO_FILLS = ['" + LOGO_FILLS.join("', '") + "']");
    expect(legacy).toContain("LOGO_MARKS = ['" + LOGO_MARKS.join("', '") + "']");
  });
  it('have the accent colours the workspace bundle derives', () => {
    const f = path.join(root, 'src/platform/generated/legacy.js');
    if (!fs.existsSync(f)) return;
    const m = /const ACC_HEX = (\{.*?\});\n/.exec(fs.readFileSync(f, 'utf8'));
    expect(JSON.parse(m![1])).toEqual(ACCENT_COLORS);
  });
});

describe('parseIdentity', () => {
  it('takes defaults for missing values', () => {
    const r = parseIdentity(new URLSearchParams('name=Cases'));
    expect(r.ok && r.identity).toMatchObject({
      name: 'Cases',
      accent: 'blue',
      shape: 'squircle',
      fill: 'gradient',
      mark: 'none',
      glyph: 'apps',
    });
  });
  it('refuses values outside the catalogs', () => {
    for (const qs of [
      'accent=red',
      'shape=star',
      'fill=x',
      'mark=%3Cscript%3E',
      'glyph=nope',
      'glyph=__proto__',
      'c=evil',
      'c=1.a%22%3E',
    ]) {
      expect(parseIdentity(new URLSearchParams(qs)).ok, qs).toBe(false);
    }
  });
  it('keeps only safe characters in a name', () => {
    expect(cleanName('<img src=x onerror=alert(1)>')).toBe('img srcx onerroralert(1)');
    expect(cleanName('  Case\u0000 Desk  ')).toBe('Case Desk');
    expect(cleanName('')).toBe('Turnkey app');
    expect(cleanName('x'.repeat(200)).length).toBe(40);
  });
});

describe('logoSvg', () => {
  it('draws every combination without anything outside the catalogs', () => {
    for (const shape of LOGO_SHAPES)
      for (const fill of LOGO_FILLS)
        for (const mark of LOGO_MARKS) {
          const svg = logoSvg({ accent: 'teal', glyph: 'apps', shape, fill, mark });
          expect(svg.startsWith('<svg')).toBe(true);
          expect(svg).not.toMatch(/<script|javascript:|onerror|onload/i);
        }
  });
});

describe('GET /a/manifest', () => {
  it('returns a manifest for one app', async () => {
    const res = manifestGET(req('manifest', 'name=Case%20Desk&accent=forest&shape=hexagon&c=1.abc_-9'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/manifest+json');
    const m = await res.json();
    expect(m).toMatchObject({
      name: 'Case Desk',
      start_url: '/#app=1.abc_-9',
      display: 'standalone',
      theme_color: ACCENT_COLORS.forest[0],
    });
    expect(m.icons.some((i: { sizes: string; purpose: string }) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
    for (const i of m.icons) expect(i.src.startsWith('/a/icon?')).toBe(true);
  });
  it('refuses bad input', async () => {
    expect(manifestGET(req('manifest', 'accent=%3Cb%3E')).status).toBe(400);
    expect(manifestGET(req('manifest', 'c=javascript:alert(1)')).status).toBe(400);
  });
  it('never puts markup into the JSON', async () => {
    const m = await manifestGET(req('manifest', 'name=%3Cscript%3Ealert(1)%3C%2Fscript%3E')).json();
    expect(m.name).not.toMatch(/[<>]/);
  });
});

describe('GET /a/icon', () => {
  it('returns a PNG', async () => {
    const res = iconGET(req('icon', 'accent=pink&shape=shield&fill=split&mark=spark&glyph=rocket&size=192'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const b = new Uint8Array(await res.arrayBuffer());
    expect([...b.slice(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });
  it('returns an SVG on request', async () => {
    const res = iconGET(req('icon', 'format=svg&size=64&shape=circle'));
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(await res.text()).toContain('<circle cx="50" cy="50" r="50"/>');
  });
  it('refuses bad input', () => {
    expect(iconGET(req('icon', 'size=7')).status).toBe(400);
    expect(iconGET(req('icon', 'format=html')).status).toBe(400);
    expect(iconGET(req('icon', 'shape=%22%3E%3Cscript%3E')).status).toBe(400);
  });
});

describe('Turnkey manifest', () => {
  it('is installable', () => {
    const m = manifest();
    expect(m.display).toBe('standalone');
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    for (const i of m.icons ?? []) if (i.src.startsWith('/icons/')) expect(fs.existsSync(path.join(root, 'public', i.src))).toBe(true);
  });
});

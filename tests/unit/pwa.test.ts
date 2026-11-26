import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { GET as manifestGET } from '@/app/a/manifest/route';
import { GET as iconGET } from '@/app/a/icon/route';
import manifest from '@/app/manifest';
import { ACCENT_COLORS, LOGO_FILLS, LOGO_MARKS, LOGO_SHAPES, cleanName, isGlyph, parseIdentity } from '@/platform/pwa/identity';
import { appInstallLinks } from '@/platform/pwa/app';
import { logoSvg } from '@/platform/pwa/logo';
import { deploymentOf, keepableFiles } from '@/platform/pwa/register';

const root = path.join(__dirname, '..', '..');
const req = (route: string, qs: string) => new Request('http://localhost/a/' + route + '?' + qs);

describe('catalogs', () => {
  // The workspace keeps its own copy of these lists (src/workspace/release.tsx, or src/legacy/release.js before the
  // move). Whichever exists must agree with the lists used to draw the installed icon.
  const file = ['src/workspace/release.tsx', 'src/legacy/release.js'].map((f) => path.join(root, f)).find((f) => fs.existsSync(f));
  it('match the workspace', () => {
    expect(file).toBeTruthy();
    const text = fs.readFileSync(file!, 'utf8');
    expect(text).toMatch(new RegExp("LOGO_SHAPES = \\['" + LOGO_SHAPES.join("', '") + "'\\]"));
    expect(text).toMatch(new RegExp("LOGO_FILLS = \\['" + LOGO_FILLS.join("', '") + "'\\]"));
    expect(text).toMatch(new RegExp("LOGO_MARKS = \\['" + LOGO_MARKS.join("', '") + "'\\]"));
  });
  it('have a glyph path for every symbol', () => {
    expect(isGlyph('apps')).toBe(true);
    expect(isGlyph('toString')).toBe(false);
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

describe('appInstallLinks', () => {
  it('builds the manifest and icon addresses from the workspace input', () => {
    const links = appInstallLinks({ name: 'Case Desk', accent: 'teal', shape: 'shield', shareCode: '1.abc' });
    expect(links).not.toBeNull();
    const m = new URL(links!.manifestUrl, 'http://x');
    expect(m.pathname).toBe('/a/manifest');
    expect(m.searchParams.get('name')).toBe('Case Desk');
    expect(m.searchParams.get('c')).toBe('1.abc');
    expect(new URL(links!.iconUrl(512), 'http://x').searchParams.get('size')).toBe('512');
  });
  it('gives back addresses that the routes accept', async () => {
    const links = appInstallLinks({ name: 'Cases', accent: 'pink', glyph: 'rocket' })!;
    const res = manifestGET(new Request('http://localhost' + links.manifestUrl));
    expect(res.status).toBe(200);
    expect(iconGET(new Request('http://localhost' + links.iconUrl())).status).toBe(200);
  });
  it('refuses a value outside the catalogs', () => {
    expect(appInstallLinks({ accent: 'red' })).toBeNull();
    expect(appInstallLinks({ shareCode: '<script>' })).toBeNull();
  });
});

describe('deploymentOf and keepableFiles', () => {
  it('reads the build id from the page', () => {
    expect(deploymentOf('x \\"b\\":\\"GuU38Y2MQUOvlWbxbJE25\\" y')).toBe('guu38y2mquovlwbxbje25');
  });
  it('falls back to a hash of the script names, which changes with them', () => {
    const a = deploymentOf('<script src="/_next/static/chunks/a1.js"></script>');
    const b = deploymentOf('<script src="/_next/static/chunks/a2.js"></script>');
    expect(a).toMatch(/^[0-9a-z]+$/);
    expect(a).not.toBe(b);
  });
  it('keeps only same-origin build files', () => {
    const out = keepableFiles(
      [
        { name: 'http://x/_next/static/chunks/a.js' },
        { name: 'http://x/vendor/sql-wasm.wasm?v=1' },
        { name: 'http://x/api/llm' },
        { name: 'http://other/_next/static/b.js' },
        { name: 'not an address' },
      ],
      'http://x',
    );
    expect(out).toEqual(['/_next/static/chunks/a.js', '/vendor/sql-wasm.wasm?v=1']);
  });
});

describe('service worker', () => {
  type Listener = (e: Record<string, unknown>) => void;
  function load(version = 'abc') {
    const listeners: Record<string, Listener> = {};
    const store = new Map<string, Map<string, Response>>();
    const fetched: string[] = [];
    const cacheOf = (name: string) => {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name)!;
      return {
        match: async (k: string | Request) => m.get(typeof k === 'string' ? k : new URL(k.url).pathname)?.clone(),
        put: async (k: string, r: Response) => void m.set(k, r),
      };
    };
    const self = {
      location: { href: 'http://x/sw.js?v=' + version, origin: 'http://x' },
      addEventListener: (t: string, f: Listener) => (listeners[t] = f),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    };
    const caches = {
      open: async (n: string) => cacheOf(n),
      keys: async () => [...store.keys()],
      delete: async (n: string) => store.delete(n),
    };
    const fetchFn = async (u: string | Request) => {
      const url = typeof u === 'string' ? u : u.url;
      fetched.push(url);
      return new Response(url.endsWith('/') || url === '/' ? '<script src="/_next/static/c.js"></script>' : 'ok');
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8'), {
      self,
      caches,
      fetch: fetchFn,
      URL,
      Response,
      Request,
      Promise,
    });
    return { listeners, store, fetched };
  }
  const fetchEvent = (url: string, over: Record<string, unknown> = {}) => {
    const out: { responded: unknown } = { responded: undefined };
    const req = { method: 'GET', url: 'http://x' + url, mode: 'cors', headers: new Headers(), ...over };
    return { out, ev: { request: req, respondWith: (p: unknown) => (out.responded = p), waitUntil: () => {} } };
  };
  it('leaves API calls, other methods, other origins and its own file alone', () => {
    const { listeners } = load();
    for (const [u, over] of [
      ['/api/llm', {}],
      ['/api/health', {}],
      ['/x', { method: 'POST' }],
      ['/sw.js', {}],
    ] as const) {
      const { ev, out } = fetchEvent(u, over);
      listeners.fetch(ev);
      expect(out.responded, u).toBeUndefined();
    }
    const other = fetchEvent('/_next/static/a.js', { url: 'http://elsewhere/_next/static/a.js' });
    listeners.fetch(other.ev);
    expect(other.out.responded).toBeUndefined();
  });
  it('never writes an API response into the cache, even when the page asks to keep one', async () => {
    const { listeners, store } = load();
    await (async () => {
      let p: Promise<unknown> = Promise.resolve();
      listeners.message({
        data: { type: 'keep', urls: ['/api/llm', '/_next/static/a.js', 'http://evil/_next/static/b.js'] },
        waitUntil: (x: Promise<unknown>) => (p = x),
      });
      await p;
    })();
    const keys = [...(store.get('turnkey-abc')?.keys() ?? [])];
    expect(keys).toEqual(['/_next/static/a.js']);
  });
  it('keeps the page and what it names on install, and drops other versions on activate', async () => {
    const { listeners, store, fetched } = load('new');
    store.set('turnkey-old', new Map());
    store.set('other-site', new Map());
    let p: Promise<unknown> = Promise.resolve();
    listeners.install({ waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
    expect(fetched).toContain('/_next/static/c.js');
    expect(fetched).toContain('/vendor/sql-wasm.wasm');
    expect(fetched.some((u) => u.includes('/api/'))).toBe(false);
    listeners.activate({ waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
    expect([...store.keys()].sort()).toEqual(['other-site', 'turnkey-new']);
  });
});

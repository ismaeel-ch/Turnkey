/* Turnkey service worker. Written by hand; it has no build step.
   Registered as /sw.js?v=<build id> (src/platform/pwa/register.ts), so every deployment is a new worker with a new cache.

   - install:  keep the page, the SQLite engine, the icons, and the stylesheet and chunks the page names.
   - fetch:    the page and the icons answer from the cache and are refreshed in the background; files whose names
               change with their content (/_next/static, /vendor) answer from the cache and go to the network once.
   - never:    anything under /api/, anything that is not a GET, anything on another origin.
   - activate: delete every cache of an older deployment. */
'use strict';

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const PREFIX = 'turnkey-';
const CACHE = PREFIX + VERSION;

// Files with fixed names that the workspace needs. The page, its stylesheet and its script chunks are found in the
// page itself, because their names change with every build.
const FIXED = [
  '/',
  '/manifest.webmanifest',
  '/vendor/sql-wasm.js',
  '/vendor/sql-wasm.wasm',
  '/favicon.ico',
  '/icon.svg',
  '/apple-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
];
// What a page may name: files whose names carry their content, and the engine.
const KEEPABLE = /^\/(_next\/static|vendor)\//;

async function put(cache, url) {
  try {
    const res = await fetch(url, { cache: 'reload' });
    if (res.ok) await cache.put(url, res);
    return res.ok;
  } catch {
    return false;
  }
}

// The files the page links to or loads: /_next/static/... scripts, styles and fonts, and /vendor/... files.
async function namedBy(cache, pageUrl) {
  const res = await cache.match(pageUrl);
  if (!res) return [];
  const text = await res.clone().text();
  const found = new Set();
  const re = /\/(?:_next\/static|vendor)\/[A-Za-z0-9_\-./%~]+\.(?:js|css|woff2?|wasm)(?:\?[A-Za-z0-9_=.\-&%]*)?/g;
  let m;
  while ((m = re.exec(text))) found.add(m[0]);
  return [...found];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // The page must arrive, or this worker does not install and the previous one keeps working.
      if (!(await put(cache, '/'))) throw new Error('the page could not be kept');
      await Promise.all([...FIXED.slice(1), ...(await namedBy(cache, '/'))].map((u) => put(cache, u)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const d = event.data;
  if (!d || d.type !== 'keep' || !Array.isArray(d.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const u of d.urls.slice(0, 200)) {
        if (typeof u !== 'string') continue;
        let url;
        try {
          url = new URL(u, self.location.origin);
        } catch {
          continue;
        }
        if (url.origin !== self.location.origin || !KEEPABLE.test(url.pathname)) continue;
        if (!(await cache.match(url.pathname + url.search))) await put(cache, url.pathname + url.search);
      }
    })(),
  );
});

const IMMUTABLE = KEEPABLE;
const SHELL = /^\/(a\/(manifest|icon)|icons\/|manifest\.webmanifest$|favicon\.ico$|icon\.svg$|apple-icon\.png$)/;

async function refresh(cache, key, request) {
  try {
    const res = await fetch(request, { cache: 'no-cache' });
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch {
    return null;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;
  if (path.startsWith('/api/') || path === '/sw.js') return;
  if (url.searchParams.has('_rsc') || req.headers.get('rsc')) return;

  if (req.mode === 'navigate') {
    if (/^\/[a-z0-9-]{3,40}\/?$/.test(path)) {
      // a short link (/clinic-desk): the network when there is one, else the cached workspace, which opens the copy
      // of that app saved in this browser
      event.respondWith(
        (async () => {
          try {
            return await fetch(req);
          } catch {
            return (await (await caches.open(CACHE)).match('/')) || Response.error();
          }
        })(),
      );
      return;
    }
    if (path !== '/') return; // anything else goes to the network as before
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match('/');
        const update = refresh(cache, '/', new Request('/', { headers: { accept: 'text/html' } }));
        if (hit) {
          event.waitUntil(update);
          return hit;
        }
        return (await update) || Response.error();
      })(),
    );
    return;
  }

  if (IMMUTABLE.test(path)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const key = path + url.search;
        // The engine is asked for with and without a version in the address; both are the same file within one cache.
        const hit = (await cache.match(key)) || (path.startsWith('/vendor/') ? await cache.match(path) : undefined);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) event.waitUntil(cache.put(key, res.clone()));
        return res;
      })(),
    );
    return;
  }

  if (SHELL.test(path)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const key = path + url.search;
        const hit = await cache.match(key);
        const update = refresh(cache, key, req);
        if (hit) {
          event.waitUntil(update);
          return hit;
        }
        return (await update) || Response.error();
      })(),
    );
  }
});

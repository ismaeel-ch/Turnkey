// Install and offline check, in a real browser, against a production build (TK_URL = the server's address).
//   - the manifest is linked and passes Chrome's installability checks
//   - the service worker registers and takes control; API routes are not in its cache
//   - after one visit with a saved build, a reload with the network off shows the workspace and the build still runs
//   - an app's own manifest and icon come from /a/manifest and /a/icon
// Not part of the flows list in run.mjs: `TK_URL=http://localhost:3304 node tests/e2e/offline.cjs`.
const { chromium } = require('playwright');
const url = process.env.TK_URL || 'http://localhost:3304';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''));
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const apiHits = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) apiHits.push(r.url()); });

  // first visit: onboarding, then one saved build
  await page.goto(url + '/');
  await page.waitForSelector('.ob-card', { timeout: 30000 });
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: /Skip and use the demo account/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /empty workspace/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.ob-body .switch').click();
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await page.waitForSelector('.home');
  await page.evaluate(() => { window.__formwork.state().settings.speed = 'instant'; });
  await page.locator('[data-tpl="helpdesk"] .tpl-build').click();
  for (let i = 0; i < 300; i++) {
    const status = await page.evaluate(() => { const s = window.__formwork.state(); const t = (s.tabs[s.session] || []).find((x) => x.id === s.active[s.session]); const a = t && t.app ? s.apps[t.app] : null; return a && a.status; });
    if (status === 'ready' || status === 'failed') break;
    const o = page.locator('.gcard.ask .opt:not([disabled])');
    if (await o.count()) await o.first().click().catch(() => {});
    await sleep(120);
  }
  const appId = await page.evaluate(() => { window.__formwork.save(); return Object.keys(window.__formwork.state().apps)[0]; });
  check('a build is saved', !!appId, appId);

  // manifest and installability
  const manifestHref = await page.evaluate(() => document.querySelector('link[rel=manifest]')?.href);
  check('the page links a manifest', /\/manifest\.webmanifest$/.test(manifestHref || ''), manifestHref);
  const m = await (await ctx.request.get(manifestHref)).json();
  check('the manifest names the app and its icons', m.name === 'Turnkey' && m.display === 'standalone' && m.icons.some((i) => i.sizes === '512x512'), m);

  // service worker
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => window.__formwork && window.__formwork.state, null, { timeout: 30000 }).catch(async () => { await page.screenshot({ path: '/tmp/claude-0/wtD-fail.png' }); console.log(await page.evaluate(() => document.body.innerText.slice(0, 300))); throw new Error('workspace did not load after reload'); });
  for (let i = 0; i < 60 && !(await page.evaluate(() => !!navigator.serviceWorker.controller)); i++) await sleep(250);
  check('the service worker controls the page', await page.evaluate(() => !!navigator.serviceWorker.controller));
  await sleep(2500); // the page tells the worker which files it loaded
  const cdp = await ctx.newCDPSession(page);
  const inst = await cdp.send('Page.getInstallabilityErrors');
  check('Chrome finds no installability errors', inst.installabilityErrors.length === 0, inst.installabilityErrors);
  const cached = await page.evaluate(async () => {
    const out = [];
    for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
    return out;
  });
  check('the cache holds the page, the stylesheet, the engine and chunks', cached.includes('/') && cached.includes('/vendor/sql-wasm.wasm') && cached.some((p) => p.startsWith('/_next/static/') && p.endsWith('.js')) && cached.some((p) => p.endsWith('.css')), cached.length);
  check('no API response is in the cache', !cached.some((p) => p.startsWith('/api/')), cached.filter((p) => p.startsWith('/api/')));

  // offline
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__formwork && window.__formwork.state, null, { timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.length > 100, null, { timeout: 30000 }).catch(() => {});
  const body = await page.evaluate(() => document.body.innerText.length);
  check('offline reload shows the workspace', body > 100, body);
  let rows = null;
  for (let i = 0; i < 40 && (!rows || typeof rows === 'string'); i++) { // the engine loads after the page
    rows = await page.evaluate((id) => {
      try { return window.__formwork.sql(id, 'select count(*) as n from sqlite_master'); } catch (e) { return String(e); }
    }, appId);
    if (!rows || typeof rows === 'string') await sleep(250);
  }
  check('the saved build runs offline (SQLite works)', rows && typeof rows !== 'string', rows);
  const opened = await page.evaluate((id) => !!window.__formwork.state().apps[id], appId);
  check('the saved build is still there offline', opened);

  // per-app manifest and icon, online again
  await ctx.setOffline(false);
  const qs = 'name=Case%20Desk&accent=forest&shape=hexagon&c=1.abc';
  const am = await ctx.request.get(url + '/a/manifest?' + qs);
  check('/a/manifest answers with the app name', am.ok() && (await am.json()).name === 'Case Desk');
  const ai = await ctx.request.get(url + '/a/icon?' + qs + '&size=192');
  check('/a/icon answers with a PNG', ai.ok() && ai.headers()['content-type'] === 'image/png');
  check('no error on the page', errors.length === 0, errors);
  await browser.close();
  const pass = results.every(Boolean);
  console.log(pass ? 'PASS offline' : 'FAIL offline');
  process.exit(pass ? 0 : 1);
})();

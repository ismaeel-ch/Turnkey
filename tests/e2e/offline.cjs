// Install and offline check, in a real browser, against a production build (TK_URL = the server's address).
//   - the manifest is linked and passes Chrome's installability checks
//   - the service worker registers and takes control; API routes are not in its cache
//   - after one visit with a saved build, a reload with the network off shows the workspace and the build still runs
//   - an app's own manifest and icon come from /a/manifest and /a/icon
//   - a shared app, open on its own, links its own manifest: Chrome finds it installable under the app's name, and its
//     start address reopens the saved copy (no second copy); leaving the app links Turnkey's manifest again
// Run it with the other flows: `npm run test:e2e -- offline` (or `TK_URL=http://localhost:3304 node tests/e2e/offline.cjs`).
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
  await page.waitForFunction(() => window.__formwork && window.__formwork.state, null, { timeout: 30000 }).catch(async () => { await page.screenshot({ path: require('path').join(__dirname, 'shots', 'offline-fail.png') }); console.log(await page.evaluate(() => document.body.innerText.slice(0, 300))); throw new Error('workspace did not load after reload'); });
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

  // a shared app installs as itself
  const share = await page.evaluate(async (id) => {
    const f = window.__formwork, app = f.state().apps[id];
    const pack = f.share.packOf(app, { data: 'demo', as: '' });
    pack.ver = '1.0';
    pack.uid = app.uid;
    pack.notes = ['First version'];
    return { code: await f.share.squeeze(JSON.stringify(pack)), name: app.name, uid: app.uid };
  }, appId);
  const sp = await ctx.newPage();
  sp.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await sp.goto(url + '/#app=' + share.code);
  await sp.waitForSelector('.solo .app', { timeout: 30000 });
  await sleep(300);
  const links = await sp.evaluate(() => ({
    manifest: document.querySelector('link[rel=manifest]')?.getAttribute('href') || '',
    touch: document.querySelector('link[rel=apple-touch-icon]')?.getAttribute('href') || '',
    others: [...document.querySelectorAll('link[rel=manifest]')].filter((l) => l.getAttribute('href') !== document.querySelector('link[rel=manifest]').getAttribute('href')).length,
  }));
  const mq = new URL(links.manifest, url).searchParams;
  check('a shared app open on its own links its own manifest, with its name and lasting id', links.others === 0 && links.manifest.startsWith('/a/manifest?') && mq.get('name') === share.name && mq.get('key') === share.uid && !mq.has('c'), links);
  const appM = await (await ctx.request.get(new URL(links.manifest, url).href)).json();
  check("the app's manifest starts the saved copy under the app's name", appM.name === share.name && appM.start_url === '/#app=i.' + share.uid && appM.display === 'standalone', appM);
  const touch = await ctx.request.get(new URL(links.touch, url).href);
  check("the app's home-screen icon is a PNG drawn from its logo", touch.ok() && touch.headers()['content-type'] === 'image/png');
  const scdp = await ctx.newCDPSession(sp);
  let gm = null, gi = null;
  for (let i = 0; i < 20; i++) { // Chrome reads the new manifest a moment after the link changes
    gm = await scdp.send('Page.getAppManifest');
    if (gm.url && gm.url.includes('/a/manifest?')) break;
    await sleep(250);
  }
  gi = await scdp.send('Page.getInstallabilityErrors');
  check('Chrome reads the app manifest and finds no installability errors', !!gm && gm.url.includes('/a/manifest?') && gi.installabilityErrors.length === 0, { url: gm && gm.url, errors: gi.installabilityErrors });
  await sp.locator('#solo-install').click();
  await sp.waitForSelector('.dialog');
  const how = await sp.locator('#inst-go').getAttribute('data-install');
  const instText = await sp.locator('.dialog').innerText();
  console.log('  install dialog: ' + how);
  check('the install dialog offers the browser install, or says where the browser menu has it', how === 'browser' || (how === 'menu' && /menu/.test(instText)), { how, text: instText.slice(0, 300) });
  await sp.locator('.dialog .dfoot .btn', { hasText: 'Not now' }).click();
  const before = await sp.evaluate(() => Object.values(window.__formwork.state().apps).filter((a) => a.shared).length);
  await sp.evaluate(() => window.__formwork.save());
  await sp.close();

  const ip = await ctx.newPage(); // what the installed app opens
  ip.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await ip.goto(url + appM.start_url);
  await ip.waitForSelector('.solo .app', { timeout: 30000 });
  await ip.waitForFunction((n) => document.title === n, share.name, { timeout: 5000 }).catch(() => {});
  const reopened = await ip.evaluate((uid) => {
    const s = window.__formwork.state(), so = window.__formwork.view().solo, a = so && s.apps[so.app];
    return { name: a && a.name, uid: a && a.shared && a.shared.uid, copies: Object.values(s.apps).filter((x) => x.shared).length, title: document.title };
  }, share.uid);
  check('the start address reopens the saved copy, without making another', reopened.uid === share.uid && reopened.copies === before && reopened.title === share.name, reopened);
  await ip.evaluate(() => window.__formwork.share.exitSolo());
  await sleep(300);
  const back = await ip.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href'));
  check("leaving the app links Turnkey's manifest again", back === '/manifest.webmanifest', back);
  const gone = await ctx.newPage();
  await gone.goto(url + '/#app=i.nothing_here');
  await gone.waitForFunction(() => /no longer saved in this browser/.test(document.body.innerText), null, { timeout: 30000 }).then(() => true, () => false).then((ok) => check('an unknown app id says to open the link again', ok));
  check('no error on the page', errors.length === 0, errors);
  await browser.close();
  const pass = results.every(Boolean);
  console.log(pass ? 'PASS offline' : 'FAIL offline');
  process.exit(pass ? 0 : 1);
})();

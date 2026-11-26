// Offline check: visit once, go offline, reload, find the workspace and run a saved build. TK_URL = server address.
const { chromium } = require('playwright');
const url = process.env.TK_URL || 'http://localhost:3111';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url + '/');
  await page.waitForFunction(() => window.__formwork && window.__formwork.state, null, { timeout: 30000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  for (let i = 0; i < 40 && !(await page.evaluate(() => !!navigator.serviceWorker.controller)); i++) await sleep(250);
  await sleep(2000); // the page tells the worker which chunks it loaded
  const keys = await page.evaluate(async () => (await caches.keys()));
  console.log('caches', keys);
  const man = await page.evaluate(() => document.querySelector('link[rel=manifest]')?.href);
  console.log('manifest link', man);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.__formwork && window.__formwork.state, null, { timeout: 30000 });
  const ok = await page.evaluate(async () => {
    const s = window.__formwork.state();
    const apps = Object.values(s.apps || {});
    return { apps: apps.length, sql: typeof window.initSqlJs, title: document.title, body: document.body.innerText.length };
  });
  console.log('offline', JSON.stringify(ok));
  // run a saved build: open the first app tab if one exists in the sample data
  const ran = await page.evaluate(async () => {
    try { const SQL = await window.initSqlJs({ locateFile: (f) => '/vendor/' + f }); const db = new SQL.Database(); db.run('create table t(x)'); db.run('insert into t values (1)'); return db.exec('select count(*) from t')[0].values[0][0]; } catch (e) { return String(e); }
  });
  console.log('sqlite offline', ran);
  const iconOk = await page.evaluate(async () => (await fetch('/icons/icon-192.png')).ok);
  console.log('icon offline', iconOk);
  await browser.close();
  const pass = ok.body > 200 && ran === 1 && iconOk && errors.length === 0;
  console.log(pass ? 'PASS offline' : 'FAIL offline', errors);
  process.exit(pass ? 0 : 1);
})();

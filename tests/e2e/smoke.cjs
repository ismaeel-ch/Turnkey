// Smoke test that is safe to run against production. The release workflow runs it after each production deploy, and
// the "Live site check" workflow runs it by hand.
//
//   TK_URL=https://turnkey-bay.vercel.app node tests/e2e/smoke.cjs
//   TK_URL=https://… EXPECT_VERSION=v0.3.1 node tests/e2e/smoke.cjs
//   npm run test:e2e -- smoke          against a local production build, like the other flows
//
// What it checks, in order:
//   1. /api/health answers ok, and its version is the one just released (EXPECT_VERSION, when given). The page is
//      sent with the security headers, the web manifest is served, and an unknown short link answers 404 (or 503
//      when short links are off).
//   2. The page loads in a real browser and the workspace opens, with no uncaught error on the page.
//   3. A sample app builds from its saved build with every generated test passing, Share makes a short link, and that
//      link opens the app on its own in a fresh browser. Demo mode is on, so none of this calls the model.
//   The first-run screen must say "Model connected" when the server has a model, and "No model connected" when not.
//   4. When a model is configured: one Live build of the clinic sample from its sentence (about ten model calls; the
//      workspace caps a session at 40), and one tool call through /api/health?probe=1. Both go through the site's own
//      rate limits and spend cap. SMOKE_LIVE_BUILD=0 skips the build. With no model configured the app still works
//      (a project rule), so the model checks are a warning, not a failure.
//
// Every share leaves one small record in the short-link store, named "release-check" (then -2 … -5, then random).
// Exits 1 if any check fails. Writes a table to $GITHUB_STEP_SUMMARY when that is set. Prints no secrets: it reads
// only public routes.
const fs = require('node:fs');
const { chromium } = require('playwright');

const base = String(process.env.TK_URL || process.env.SMOKE_URL || process.argv[2] || '').replace(/\/+$/, '');
const expectVersion = String(process.env.EXPECT_VERSION || '').replace(/^v/, '');
const SHARE_NAME = 'Release check';
// The clinic sample's sentence (src/workspace/builds.ts), built live by the model. SMOKE_LIVE_BUILD=0 skips that build.
const CLINIC =
  'A clinic front desk books patient appointments, doctors work from their own schedule and write visit notes, and the manager tracks no-shows.';
const LIVE_BUILD = process.env.SMOKE_LIVE_BUILD !== '0';

if (!/^https?:\/\/[^/\s]+$/.test(base)) {
  console.error('Give the site address, for example: node tests/e2e/smoke.cjs https://turnkey-bay.vercel.app');
  process.exit(2);
}

/** @type {{ name: string, status: 'pass' | 'fail' | 'warn', detail: string }[]} */
const results = [];
const record = (name, status, detail = '') => {
  results.push({ name, status, detail });
  console.log(`${status.toUpperCase().padEnd(4)} ${name}${detail ? '  (' + detail + ')' : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path, timeoutMs = 20000) {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(base + path, { signal: AbortSignal.timeout(timeoutMs), headers: { 'cache-control': 'no-store' } });
      const body = await res.json().catch(() => null);
      if (res.ok && body) return body;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      last = e;
    }
    if (attempt < 3) await sleep(5000);
  }
  throw last;
}

async function checkHealth() {
  try {
    const h = await getJson('/api/health');
    if (h.ok !== true || h.name !== 'turnkey') {
      record('health route answers', 'fail', 'unexpected body');
      return null;
    }
    record('health route answers', 'pass', `backend ${h.backend ?? 'none'}, live ${h.live}`);
    if (expectVersion) {
      if (h.version === expectVersion) record('health reports the released version', 'pass', h.version);
      else record('health reports the released version', 'fail', `expected ${expectVersion}, got ${h.version}`);
    }
    return h;
  } catch (e) {
    record('health route answers', 'fail', String(e && e.message ? e.message : e));
    return null;
  }
}

async function checkHttp() {
  try {
    const res = await fetch(base + '/', { signal: AbortSignal.timeout(20000) });
    const missing = ['content-security-policy', 'x-content-type-options', 'x-frame-options', 'referrer-policy'].filter(
      (h) => !res.headers.get(h),
    );
    if (res.ok && !missing.length) record('page is served with the security headers', 'pass');
    else record('page is served with the security headers', 'fail', res.ok ? 'missing ' + missing.join(', ') : `HTTP ${res.status}`);
  } catch (e) {
    record('page is served with the security headers', 'fail', firstLine(e));
  }
  try {
    const m = await getJson('/manifest.webmanifest');
    if (m.name === 'Turnkey' && Array.isArray(m.icons) && m.icons.length) record('web manifest is served', 'pass');
    else record('web manifest is served', 'fail', 'unexpected manifest');
  } catch (e) {
    record('web manifest is served', 'fail', firstLine(e));
  }
  try {
    const res = await fetch(base + '/api/share/no-such-app-' + Date.now().toString(36), { signal: AbortSignal.timeout(20000) });
    if (res.status === 404 || res.status === 503) record('an unknown short link answers plainly', 'pass', `HTTP ${res.status}`);
    else record('an unknown short link answers plainly', 'fail', `HTTP ${res.status}`);
  } catch (e) {
    record('an unknown short link answers plainly', 'fail', firstLine(e));
  }
}

/** The first-run steps, as in the browser flows. With `badge`, checks the Live choice says that about the model. With
 *  `live`, picks Live instead of Demo. */
async function enter(page, opts = {}) {
  await page.waitForSelector('.ob-card', { timeout: 30000 });
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: /Skip and use the demo account/ }).click();
  const liveChoice = page.locator('.choice').nth(1);
  if (opts.badge) {
    // the page asks the server whether a model is connected; wait until it has an answer
    let text = '';
    for (let i = 0; i < 80; i++) {
      text = (await liveChoice.locator('.badge').innerText().catch(() => '')).trim();
      if (text && text !== 'Checking the model') break;
      await sleep(250);
    }
    if (text === opts.badge) record('first run says whether a model is connected', 'pass', text);
    else record('first run says whether a model is connected', 'fail', `expected "${opts.badge}", got "${text}"`);
  }
  if (opts.live) await liveChoice.click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /empty workspace/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.ob-body .switch').click();
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await page.waitForSelector('.home', { timeout: 20000 });
}

/** Status of the app in the open tab, or null. */
const appNow = (page) =>
  page.evaluate(() => {
    const s = window.__formwork.state();
    const t = (s.tabs[s.session] || []).find((x) => x.id === s.active[s.session]);
    const a = t && t.app ? s.apps[t.app] : null;
    return a ? { status: a.status, name: a.name, mode: a.mode, tests: a.tests || null } : null;
  });

/** Waits for the open app to finish building, answering any question the agents ask with its first option. */
async function waitBuilt(page, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const a = await appNow(page);
    if (a && (a.status === 'ready' || a.status === 'failed')) {
      await page.waitForFunction(() => !document.querySelector('.work-head .spin'), null, { timeout: 30000 });
      return appNow(page);
    }
    const ask = page.locator('.gcard.ask .opt:not([disabled])');
    if (await ask.count()) await ask.first().click().catch(() => {});
    await sleep(250);
  }
  throw new Error(`the build did not finish within ${Math.round(ms / 1000)} s`);
}

async function checkBrowser(health) {
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e).slice(0, 300)));

    // the page loads and the workspace opens (the same first-run steps as the browser flows in tests/e2e)
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await enter(page, { badge: health.live ? 'Model connected' : 'No model connected' });
      record('page loads and the workspace opens', 'pass');
    } catch (e) {
      record('page loads and the workspace opens', 'fail', firstLine(e));
      return;
    }

    // Demo mode: the template is built from its saved build, so no model is called
    await page.evaluate(() => {
      const s = window.__formwork.state();
      s.settings.demo = true;
      s.settings.speed = 'instant';
    });

    const enabled = await getJson('/api/share')
      .then((r) => r.enabled === true)
      .catch(() => false);
    if (!enabled) {
      record('Share makes a short link that opens', 'fail', 'short links are not set up on this deployment (GET /api/share)');
      return;
    }

    let short = '';
    try {
      await page.locator('[data-tpl="clinic"] .tpl-build').click();
      const built = await waitBuilt(page, 120000);
      if (built.status !== 'ready') throw new Error('the template build failed');
      const tests = await page.evaluate(() => {
        const s = window.__formwork.state();
        const t = s.tabs[s.session].find((x) => x.id === s.active[s.session]);
        return s.apps[t.app].tests || null;
      });
      if (tests && tests.total > 0 && tests.failed === 0) record('a sample app builds and its tests pass', 'pass', `${tests.total} tests`);
      else record('a sample app builds and its tests pass', 'fail', JSON.stringify(tests));
      // a name of its own, so the check never takes a short name a person would want, such as /clinic
      await page.evaluate((name) => {
        const s = window.__formwork.state();
        const t = s.tabs[s.session].find((x) => x.id === s.active[s.session]);
        s.apps[t.app].name = name;
      }, SHARE_NAME);
      await page.locator('[data-tour="share"]').click();
      await page.waitForSelector('.dialog.share', { timeout: 10000 });
      if (await page.locator('#sh-release').count()) await page.locator('#sh-release').click();
      await page.waitForFunction(() => /#app=1\./.test(document.getElementById('sh-link')?.value || ''), null, { timeout: 20000 });
      await page.waitForFunction(
        (origin) => (document.getElementById('sh-short')?.value || '').startsWith(origin + '/'),
        new URL(base).origin,
        { timeout: 30000 },
      );
      short = await page.inputValue('#sh-short');
      if (!/\/release-check(-[a-z0-9]+)?$/.test(short)) throw new Error('unexpected short link ' + short);
    } catch (e) {
      const note = await page
        .locator('.dialog.share')
        .innerText()
        .catch(() => '');
      record('Share makes a short link', 'fail', firstLine(e) + (note ? ' | dialog: ' + note.replace(/\s+/g, ' ').slice(0, 200) : ''));
      return;
    }
    record('Share makes a short link', 'pass', short);

    // the short link opens the app on its own, in a browser that has never seen it
    const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    try {
      const p2 = await other.newPage();
      p2.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e).slice(0, 300)));
      await p2.goto(short, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p2.waitForSelector('.solo .app', { timeout: 45000 });
      const title = await p2.title();
      record('the short link opens the app', 'pass', title);
    } catch (e) {
      record('the short link opens the app', 'fail', firstLine(e));
    } finally {
      await other.close();
    }
  } finally {
    if (health.live && LIVE_BUILD) await liveBuild(browser, errors);
    if (errors.length) record('no uncaught errors on the page', 'fail', errors.slice(0, 3).join(' | '));
    else record('no uncaught errors on the page', 'pass');
    await browser.close();
  }
}

/** One real Live build of the clinic sample, from its sentence: one model call per agent plus any send-back, about ten
 *  in all, capped by the workspace at CAP calls a session. Only runs when a model is configured. */
async function liveBuild(browser, errors) {
  const name = 'Live build of the clinic sample';
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e).slice(0, 300)));
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await enter(page, { live: true });
    await page.waitForFunction(() => window.__formwork.wf.mode().id === 'live', null, { timeout: 20000 });
    await page.evaluate(() => {
      window.__formwork.state().settings.speed = 'instant';
    });
    const started = Date.now();
    await page.fill('#home-prompt', CLINIC);
    await page.locator('.prompt .btn.primary').click();
    const a = await waitBuilt(page, 8 * 60 * 1000);
    const calls = await page.evaluate(() => window.__formwork.view().calls);
    const took = Math.round((Date.now() - started) / 1000);
    const t = a.tests;
    if (a.status === 'ready' && a.mode === 'live' && t && t.total > 0 && t.failed === 0)
      record(name, 'pass', `${a.name}: ${calls} model calls, ${took} s, ${t.total} tests pass`);
    else
      record(name, 'fail', `status ${a.status}, mode ${a.mode}, ${calls} model calls, ${took} s, tests ${JSON.stringify(t)}`);
  } catch (e) {
    record(name, 'fail', firstLine(e));
  } finally {
    await ctx.close();
  }
}

async function checkLive(health) {
  if (!health) return;
  if (!health.live) {
    record('Live: one model tool call', 'warn', 'no model is configured on this deployment, so Live is off');
    return;
  }
  try {
    const r = await getJson('/api/health?probe=1', 60000);
    const p = r.probe || {};
    if (p.ok) record('Live: one model tool call', 'pass', `${p.model}, ${p.mode}, ${p.ms} ms`);
    else record('Live: one model tool call', 'fail', p.error || p.toolCalling || 'the probe failed');
  } catch (e) {
    record('Live: one model tool call', 'fail', firstLine(e));
  }
}

function firstLine(e) {
  return String(e && e.message ? e.message : e)
    .split('\n')[0]
    .slice(0, 300);
}

function summary() {
  const icon = { pass: '✅', fail: '❌', warn: '⚠️' };
  const rows = results.map((r) => `| ${icon[r.status]} | ${r.name} | ${r.detail.replace(/\|/g, '\\|')} |`);
  return [`### Smoke test of ${base}`, '', '| | Check | Detail |', '| - | - | - |', ...rows, ''].join('\n');
}

async function main() {
  const health = await checkHealth();
  if (health) {
    await checkHttp();
    await checkBrowser(health);
    await checkLive(health);
  }
  const failed = results.filter((r) => r.status === 'fail').length;
  const warned = results.filter((r) => r.status === 'warn').length;
  console.log(`\n${results.length - failed - warned} passed, ${failed} failed, ${warned} warnings.`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary());
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

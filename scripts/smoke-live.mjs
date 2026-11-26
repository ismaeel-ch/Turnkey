// Smoke test for a deployed Turnkey site. The release workflow runs it once, after each production deploy.
//
//   node scripts/smoke-live.mjs https://turnkey-bay.vercel.app
//   SMOKE_URL=https://… EXPECT_VERSION=v0.3.1 node scripts/smoke-live.mjs
//
// What it checks, in order:
//   1. /api/health answers ok, and its version is the one just released (EXPECT_VERSION, when given).
//   2. The page loads in a real browser and the workspace opens, with no uncaught error on the page.
//   3. Share makes a short link, and that link opens the app on its own in a fresh browser.
//      The app is built from a saved template in Demo mode, so this spends nothing on the model.
//   4. When a model is configured, one tool call through /api/health?probe=1. That is the only model call, on the
//      quick tier, and it goes through the site's own rate limits and spend cap. With no model configured the app
//      still works (that is a project rule), so this is reported as a warning, not a failure.
//
// Every share leaves one small record in the short-link store, named "release-check" (then -2 … -5, then random).
// Exits 1 if any check fails. Writes a table to $GITHUB_STEP_SUMMARY when that is set. Prints no secrets: it reads
// only public routes.
import fs from 'node:fs';
import { chromium } from 'playwright';

const base = String(process.env.SMOKE_URL || process.argv[2] || '').replace(/\/+$/, '');
const expectVersion = String(process.env.EXPECT_VERSION || '').replace(/^v/, '');
const SHARE_NAME = 'Release check';

if (!/^https?:\/\/[^/\s]+$/.test(base)) {
  console.error('Give the site address, for example: node scripts/smoke-live.mjs https://turnkey-bay.vercel.app');
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

async function checkBrowser() {
  const browser = await chromium.launch();
  const errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e && e.message ? e.message : e).slice(0, 300)));

    // the page loads and the workspace opens (the same first-run steps as the browser flows in tests/e2e)
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForSelector('.ob-card', { timeout: 30000 });
      await page.getByRole('button', { name: 'Get started' }).click();
      await page.getByRole('button', { name: /Skip and use the demo account/ }).click();
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByRole('button', { name: /empty workspace/ }).click();
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.locator('.ob-body .switch').click();
      await page.getByRole('button', { name: 'Open my workspace' }).click();
      await page.waitForSelector('.home', { timeout: 20000 });
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
      for (let i = 0; i < 400; i++) {
        const status = await page.evaluate(() => {
          const s = window.__formwork.state();
          const t = (s.tabs[s.session] || []).find((x) => x.id === s.active[s.session]);
          const a = t && t.app ? s.apps[t.app] : null;
          return a ? a.status : null;
        });
        if (status === 'ready') break;
        if (status === 'failed') throw new Error('the template build failed');
        const ask = page.locator('.gcard.ask .opt:not([disabled])');
        if (await ask.count())
          await ask
            .first()
            .click()
            .catch(() => {});
        await sleep(150);
      }
      await page.waitForFunction(() => !document.querySelector('.work-head .spin'), null, { timeout: 30000 });
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
    if (errors.length) record('no uncaught errors on the page', 'fail', errors.slice(0, 3).join(' | '));
    else record('no uncaught errors on the page', 'pass');
    await browser.close();
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

const health = await checkHealth();
if (health) {
  await checkBrowser();
  await checkLive(health);
}
const failed = results.filter((r) => r.status === 'fail').length;
const warned = results.filter((r) => r.status === 'warn').length;
console.log(`\n${results.length - failed - warned} passed, ${failed} failed, ${warned} warnings.`);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary());
process.exit(failed ? 1 : 0);

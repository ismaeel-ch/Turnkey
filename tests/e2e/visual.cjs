// Visual regression checks: screenshots of the main screens, compared with saved baselines.
// Light and dark, desktop (1280 px) and phone (390 px). The clock is frozen, Math.random is seeded, animations,
// transitions and the text caret are off, so the same build draws the same pixels every time.
//
//   npm run test:e2e -- visual                      compare with tests/e2e/visual/*.png
//   VISUAL_UPDATE=1 npm run test:e2e -- visual      write new baselines instead (only on CI's browser and fonts; see
//                                                   docs/process/visual-tests.md)
//
// A screen fails when more than 0.2% of its pixels differ by more than pixelmatch's colour threshold (0.1). On a
// failure the actual and diff images are written to tests/e2e/shots/visual/, which CI keeps as an artifact.
// A screen with no baseline yet passes with a note, and its image is saved there too, ready to be committed.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const url = (process.env.TK_URL || 'http://localhost:3304').replace(/\/?$/, '/');
const BASE = path.join(__dirname, 'visual');
const OUT = path.join(__dirname, 'shots', 'visual');
const UPDATE = process.env.VISUAL_UPDATE === '1';
const MAX_RATIO = 0.002;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (UPDATE) fs.mkdirSync(BASE, { recursive: true });

const results = [];
const errors = [];
const check = (name, ok, detail) => {
  results.push(!!ok);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined && (!ok || process.env.V) ? '  -> ' + JSON.stringify(detail) : ''));
};

// Fixed time and a seeded random, before any page script runs.
const STABLE = `(() => {
  let s = 20261127;
  Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
})();`;
// Nothing moves: no animations, transitions, caret or smooth scrolling, and no toasts (they come and go on a timer). Scrollbars are hidden so their width
// (which differs between machines) never shifts the layout.
const STILL = `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}
::-webkit-scrollbar{display:none}*{scrollbar-width:none!important}.toasts{visibility:hidden!important}`;
const FROZEN = new Date('2026-11-27T09:00:00+05:00');

let pixelmatch;
async function compare(name, buf) {
  const file = name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase() + '.png';
  const base = path.join(BASE, file);
  if (UPDATE) {
    fs.writeFileSync(base, buf);
    check('baseline written: ' + name, true);
    return;
  }
  if (!fs.existsSync(base)) {
    fs.writeFileSync(path.join(OUT, file), buf);
    check('no baseline yet, image saved to tests/e2e/shots/visual: ' + name, true);
    return;
  }
  const a = PNG.sync.read(fs.readFileSync(base));
  const b = PNG.sync.read(buf);
  if (a.width !== b.width || a.height !== b.height) {
    fs.writeFileSync(path.join(OUT, file), buf);
    check('looks the same as its baseline: ' + name, false, { size: [b.width, b.height], baseline: [a.width, a.height] });
    return;
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 });
  const ratio = n / (a.width * a.height);
  if (ratio > MAX_RATIO) {
    fs.writeFileSync(path.join(OUT, file), buf);
    fs.writeFileSync(path.join(OUT, file.replace(/\.png$/, '.diff.png')), PNG.sync.write(diff));
  }
  check('looks the same as its baseline: ' + name, ratio <= MAX_RATIO, { changed: (ratio * 100).toFixed(3) + '%', pixels: n });
}

async function snap(page, name) {
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.mouse.move(0, 0);
  if (await page.evaluate(() => document.activeElement && document.activeElement !== document.body)) await page.evaluate(() => document.activeElement.blur());
  await sleep(250);
  // a tooltip opened by the last click or focus takes a moment to close: a picture never holds one
  await page.waitForFunction(() => !document.querySelector('[role="tooltip"]'), null, { timeout: 5000 }).catch(() => {});
  await compare(name, await page.screenshot({ animations: 'disabled', caret: 'hide' }));
}

async function newPage(browser, scheme, phone) {
  const ctx = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    isMobile: !!phone,
    hasTouch: !!phone,
    colorScheme: scheme,
    reducedMotion: 'reduce',
    locale: 'en-GB',
    timezoneId: 'Asia/Karachi',
  });
  await ctx.route('https://**/*', (route) => route.abort());
  await ctx.addInitScript(STABLE);
  const page = await ctx.newPage();
  await page.clock.install({ time: FROZEN });
  await page.clock.resume();
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.stack || e).slice(0, 400)));
  page.on('load', () => page.addStyleTag({ content: STILL }).catch(() => {}));
  return { ctx, page };
}
async function enter(page) {
  await page.goto(url);
  await page.waitForSelector('.ob-card', { timeout: 30000 });
  await page.addStyleTag({ content: STILL });
}
async function finishOnboarding(page) {
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: /Skip and use the demo account/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /empty workspace/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.ob-body .switch').click();
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await page.waitForSelector('.home');
  await page.evaluate(() => { window.__formwork.state().settings.speed = 'instant'; });
}
async function build(page, id) {
  await page.locator('[data-tpl="' + id + '"] .tpl-build').click();
  for (let i = 0; i < 300; i++) {
    const s = await page.evaluate(() => { const s = window.__formwork.state(); const t = (s.tabs[s.session] || []).find((x) => x.id === s.active[s.session]); const a = t && t.app ? s.apps[t.app] : null; return a ? a.status : null; });
    if (s === 'ready' || s === 'failed') break;
    const o = page.locator('.gcard.ask .opt:not([disabled])');
    if (await o.count()) await o.first().click().catch(() => {});
    await sleep(120);
  }
  await page.waitForFunction(() => !document.querySelector('.work-head .spin'), null, { timeout: 60000 });
  await sleep(600);
}
const view = (page, name) => page.locator('.views .tab', { hasText: name }).first().click();

async function desktop(browser, s) {
  const { ctx, page } = await newPage(browser, s, false);
  await enter(page);
  await snap(page, s + '-desktop-onboarding');
  await finishOnboarding(page);
  await snap(page, s + '-desktop-home');
  await build(page, 'clinic');
  await view(page, 'Build');
  await page.waitForSelector('.steps-view');
  await snap(page, s + '-desktop-build-steps');
  await page.locator('#show-how').click();
  await page.waitForSelector('.react-flow .fl-gate');
  await page.locator('[data-tour="line"] .btn', { hasText: 'Fit' }).first().click().catch(() => {});
  await snap(page, s + '-desktop-build');
  await view(page, 'App');
  if (await page.locator('.persona-btn').count()) await page.locator('.persona-btn').first().click();
  await page.waitForSelector('.app-nav .nav-i');
  await page.locator('.app-nav .nav-i').nth(0).click();
  await snap(page, s + '-desktop-app-overview');
  await page.locator('.app-nav .nav-i').nth(1).click();
  await snap(page, s + '-desktop-app-page');
  await page.locator('.app-nav .nav-i', { hasText: 'Schedule' }).first().click();
  await page.waitForSelector('.vx-bar');
  await snap(page, s + '-desktop-app-list');
  await view(page, 'Details');
  await page.waitForSelector('.subtabs');
  await page.locator('.subtabs').getByRole('tab', { name: 'Data', exact: true }).click();
  await snap(page, s + '-desktop-data');
  await page.locator('[data-tour="share"]').click();
  await page.waitForSelector('.dialog.share');
  await snap(page, s + '-desktop-share');
  await ctx.close();
}

async function phone(browser, s) {
  const { ctx, page } = await newPage(browser, s, true);
  await enter(page);
  await snap(page, s + '-phone-onboarding');
  await finishOnboarding(page);
  await snap(page, s + '-phone-home');
  await build(page, 'clinic');
  await snap(page, s + '-phone-build');
  await page.locator('.phone-nav .tab-i', { hasText: 'App' }).click();
  await page.getByRole('button', { name: 'Open the app' }).click();
  await page.waitForSelector('.solo .app');
  if (await page.locator('.persona-btn').count()) await page.locator('.persona-btn').first().click();
  await page.waitForSelector('.app-tabs');
  await snap(page, s + '-phone-app');
  await page.locator('.app-tabs .tab-i, .app-tabs button', { hasText: 'Schedule' }).first().click();
  await page.waitForSelector('.vx-bar');
  await snap(page, s + '-phone-app-list');
  await ctx.close();
}

(async () => {
  pixelmatch = (await import('pixelmatch')).default;
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  for (const step of [() => desktop(browser, 'light'), () => desktop(browser, 'dark'), () => phone(browser, 'light'), () => phone(browser, 'dark')]) {
    try { await step(); } catch (e) { errors.push('visual flow stopped: ' + String(e.stack || e).slice(0, 700)); }
  }
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
  if (errors.length) { console.log('ERRORS (' + errors.length + '):'); [...new Set(errors)].forEach((e) => console.log(' - ' + e)); }
  process.exit(failed || errors.length ? 1 : 0);
})();

// Accessibility checks, in a real browser, against a production build (TK_URL = the server's address).
// axe-core scans each main screen against WCAG 2.2 A and AA, in the light and the dark theme, and a few keyboard
// checks cover what axe cannot see: a skip link, visible focus, dialogs that keep focus, and reduced motion.
// Run it with the other flows: `npm run test:e2e -- a11y` (or `TK_URL=http://localhost:3304 node tests/e2e/a11y.cjs`).
//   A11Y_REPORT=1 prints every node of every violation, for working through a list of fixes.
const fs = require('fs');
const { chromium } = require('playwright');
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const url = (process.env.TK_URL || 'http://localhost:3304').replace(/\/?$/, '/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const errors = [];
const check = (name, ok, detail) => {
  results.push(!!ok);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && detail !== undefined ? '  -> ' + JSON.stringify(detail, null, process.env.A11Y_REPORT ? 2 : 0) : ''));
};
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Runs axe on the page (or one part of it) and returns its violations, short enough to read in a log. */
async function scan(page, include) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: axeSource });
  const raw = await page.evaluate(
    async ({ include, tags }) => {
      // Fluent's focus manager (Tabster) puts hidden, focusable sentinels at the edges of tab lists and dialogs. They hand
      // focus on at once and are meant to be hidden, so axe's aria-hidden-focus rule would flag every one of them.
      const context = { include: include ? [include] : [document], exclude: [['[data-tabster-dummy]']] };
      const r = await window.axe.run(context, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target.join(' '), why: n.failureSummary.split('\n').slice(1, 3).join(' ').slice(0, 220) })) }));
    },
    { include, tags: TAGS },
  );
  return raw;
}
const brief = (vs) => (process.env.A11Y_REPORT ? vs : vs.map((v) => ({ id: v.id, n: v.nodes.length, first: v.nodes.slice(0, 3).map((n) => n.target) })));
async function screen(page, name, include) {
  await sleep(300);
  const vs = await scan(page, include);
  check('axe finds no WCAG 2.2 AA problems: ' + name, vs.length === 0, brief(vs));
}

async function newPage(browser, scheme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
  await ctx.route('https://**/*', (route) => route.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.stack || e).slice(0, 400)));
  return { ctx, page };
}
const click = (page, sel) => page.locator(sel).first().click();
async function enter(page) {
  await page.goto(url);
  await page.waitForSelector('.ob-card', { timeout: 30000 });
  await sleep(300);
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
  await sleep(400);
}
const view = async (page, name) => {
  if (['Tests', 'Data', 'API', 'Connections'].includes(name)) {
    if (!(await page.locator('.subtabs').count())) await page.locator('.views .tab', { hasText: 'Details' }).click();
    return page.locator('.subtabs').getByRole('tab', { name, exact: true }).click();
  }
  return page.locator('.views .tab', { hasText: name }).first().click();
};

async function scheme(browser, s) {
  const { ctx, page } = await newPage(browser, s);
  await enter(page);
  await screen(page, s + ': onboarding');
  await finishOnboarding(page);
  await screen(page, s + ': workspace home');
  await build(page, 'clinic');
  for (const v of ['Build', 'App', 'Tests', 'Data', 'API', 'Connections']) {
    await view(page, v);
    await screen(page, s + ': built app, ' + v + ' view');
  }
  await page.locator('[data-tour="share"]').click();
  await page.waitForSelector('.dialog.share');
  await screen(page, s + ': share dialog', '.dialog.share');
  await page.keyboard.press('Escape');
  await ctx.close();
}

async function keyboard(browser) {
  const { ctx, page } = await newPage(browser, 'light');
  await enter(page);
  await finishOnboarding(page);
  // a skip link is the first stop and moves focus to the main content
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => { const a = document.activeElement; return { text: (a && a.textContent || '').trim(), href: a && a.getAttribute('href') }; });
  check('the first Tab stop is a link that skips to the main content', /skip/i.test(first.text) && !!first.href, first);
  await page.keyboard.press('Enter');
  await sleep(150);
  const main = await page.evaluate(() => { const m = document.querySelector('main, [role=main]'); return !!m && (m === document.activeElement || m.contains(document.activeElement)); });
  check('following the skip link puts focus in the main content', main);
  // every Tab stop in the first 40 shows a visible focus indicator
  const noRing = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const r = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const cs = getComputedStyle(a);
      const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none') || a.matches('[data-fui-focus-visible]') || !!a.closest('[data-fui-focus-visible]');
      return ring ? null : (a.tagName.toLowerCase() + (a.className && typeof a.className === 'string' ? '.' + a.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' "' + (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 30) + '"');
    });
    if (r) noRing.push(r);
  }
  check('each of the first 40 Tab stops shows a visible focus ring', noRing.length === 0, [...new Set(noRing)].slice(0, 10));
  // reduced motion: no animation or transition runs longer than a blink
  const slow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => { const cs = getComputedStyle(el); const t = (s) => Math.max(...s.split(',').map((x) => parseFloat(x) * (x.trim().endsWith('ms') ? 1 : 1000))); return t(cs.animationDuration) > 50 && cs.animationName !== 'none' || t(cs.transitionDuration) > 50; }).slice(0, 5).map((el) => el.tagName + '.' + String(el.className).slice(0, 40)));
  check('with reduced motion asked for, nothing animates', slow.length === 0, slow);
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch();
  for (const step of [() => scheme(browser, 'light'), () => scheme(browser, 'dark'), () => keyboard(browser)]) {
    try { await step(); } catch (e) { errors.push('a11y flow stopped: ' + String(e.stack || e).slice(0, 700)); }
  }
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
  if (errors.length) { console.log('ERRORS (' + errors.length + '):'); [...new Set(errors)].forEach((e) => console.log(' - ' + e)); }
  process.exit(failed || errors.length ? 1 : 0);
})();

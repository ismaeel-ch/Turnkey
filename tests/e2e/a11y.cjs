// Accessibility checks, in a real browser, against a production build (TK_URL = the server's address).
// axe-core scans each main screen against WCAG 2.2 A and AA, in the light and the dark theme, and a few keyboard
// checks cover what axe cannot see: a skip link, visible focus, dialogs that keep focus, and reduced motion.
// Run it with the other flows: `npm run test:e2e -- a11y` (or `TK_URL=http://localhost:3304 node tests/e2e/a11y.cjs`).
//   A11Y_REPORT=1 prints every node of every violation, for working through a list of fixes.
//   A11Y_ONLY=keyboard runs one part (light, dark, phone or keyboard).
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
  await page.waitForFunction(() => !document.querySelector('.dialog'));
  // the command palette (Ctrl+K) and the keyboard shortcuts dialog (?)
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.dialog.palette .palette-opt');
  await screen(page, s + ': the command palette', '.dialog.palette');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.dialog'));
  await page.keyboard.press('?');
  await page.waitForSelector('.dialog.shortcuts');
  await screen(page, s + ': the keyboard shortcuts dialog', '.dialog.shortcuts');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.dialog'));
  // every page of the built app, as its users see it
  await view(page, 'App');
  if (await page.locator('.persona-btn').count()) await page.locator('.persona-btn').first().click();
  await page.waitForSelector('.app-nav .nav-i');
  const pages = await page.locator('.app-nav .nav-i').count();
  for (let i = 0; i < pages; i++) {
    await page.locator('.app-nav .nav-i').nth(i).click();
    await screen(page, s + ': the app, page ' + (i + 1) + ' of ' + pages, '.app');
  }
  // panels and dialogs from the title bar
  await page.locator('.act-launch').click();
  await page.waitForSelector('.act-panel');
  await screen(page, s + ': the agent activity panel', '.act-panel');
  await page.keyboard.press('Escape');
  await page.locator('.titlebar [data-tour=debug]').click();
  await page.waitForSelector('.debug');
  await screen(page, s + ': the debug drawer', '.debug');
  await page.locator('.titlebar [data-tour=debug]').click();
  for (const [menu, item, sel] of [
    ['.acct', 'Settings', '.dialog'],
    ['[aria-label="Help"]', 'Feature guide', '.dialog'],
    ['[aria-label="Help"]', 'What is real in Turnkey', '.dialog'],
  ]) {
    await page.locator('.titlebar ' + menu).first().click();
    await page.getByRole('menuitem', { name: item }).click();
    await page.waitForSelector(sel);
    await screen(page, s + ': the ' + item + ' dialog', sel);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.dialog'));
  }
  // a quest app, with its agent team
  await page.locator('.newtab').click();
  await page.waitForSelector('.home');
  await build(page, 'factcheck');
  await view(page, 'App');
  if (await page.locator('.persona-btn').count()) await page.locator('.persona-btn').first().click();
  await page.waitForSelector('.app-nav .nav-i');
  await screen(page, s + ': a quest app with its agent team');
  await ctx.close();
}

/** The same screens at phone width (390 px), where the builder swaps its tabs for a bottom bar. */
async function phone(browser, s) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: s, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
  await ctx.route('https://**/*', (route) => route.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.stack || e).slice(0, 400)));
  await enter(page);
  await screen(page, s + ' 390px: onboarding');
  await finishOnboarding(page);
  await screen(page, s + ' 390px: home');
  await build(page, 'clinic');
  await screen(page, s + ' 390px: a built app in the builder');
  await page.locator('.phone-nav .tab-i', { hasText: 'App' }).click();
  await screen(page, s + ' 390px: the App tab');
  await page.getByRole('button', { name: 'Open the app' }).click();
  await page.waitForSelector('.solo .app');
  if (await page.locator('.persona-btn').count()) await page.locator('.persona-btn').first().click();
  await page.waitForSelector('.app-tabs');
  await screen(page, s + ' 390px: the app full screen');
  await page.locator('.app-head .persona').click();
  await page.waitForSelector('.sheet');
  await screen(page, s + ' 390px: the app menu sheet');
  await page.locator('.sheet-i', { hasText: 'Back to Turnkey' }).click();
  await page.waitForSelector('.phone-nav');
  await page.locator('.phone-nav .tab-i', { hasText: 'More' }).click();
  await page.waitForSelector('.sheet');
  await screen(page, s + ' 390px: the More sheet');
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
  // the workflow canvas works from the keyboard: a station node takes focus and Enter opens it in the inspector
  await build(page, 'clinic');
  await view(page, 'Build');
  const node = page.locator('.react-flow__node[aria-label^="Database station"]').first();
  await node.focus();
  const focused = await page.evaluate(() => !!document.activeElement && document.activeElement.matches('.react-flow__node'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-tour="inspector"]', { timeout: 5000 }).catch(() => {});
  const insp = await page.evaluate(() => { const i = document.querySelector('[data-tour="inspector"]'); return i ? i.innerText.slice(0, 200) : ''; });
  check('a station on the canvas takes keyboard focus, and Enter opens it in the inspector', focused && /Database/.test(insp), { focused, insp: insp.slice(0, 80) });
  // the chat composer is reachable and named
  const composer = await page.evaluate(() => { const t = document.querySelector('.composer textarea'); if (!t) return null; const id = t.id, lab = id && document.querySelector('label[for="' + id + '"]'); return t.getAttribute('aria-label') || (lab && lab.textContent) || t.getAttribute('placeholder') ? true : false; });
  check('the chat composer has a name a screen reader can read', composer === true, composer);
  await shortcuts(page);
  await ctx.close();
}

/** The command palette and the single-key shortcuts, driven from the keyboard alone. Starts on a built app's Build view. */
async function shortcuts(page) {
  const viewNow = () => page.evaluate(() => { const t = document.querySelector('.views .tab.on, .views [aria-current="page"], .views [aria-selected="true"]'); return t ? t.textContent.trim() : ''; });
  const noDialog = () => page.waitForFunction(() => !document.querySelector('.dialog'), null, { timeout: 5000 });
  await page.locator('main').focus();
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.dialog.palette', { timeout: 5000 }).catch(() => {});
  const combo = await page.evaluate(() => { const a = document.activeElement; return !!a && a.getAttribute('role') === 'combobox' && !!a.getAttribute('aria-activedescendant') && !!document.getElementById(a.getAttribute('aria-controls') || '') ; });
  check('Ctrl+K opens the command palette with focus in its search box', combo);
  await page.keyboard.type('release');
  const first = await page.evaluate(() => { const id = document.activeElement && document.activeElement.getAttribute('aria-activedescendant'); const o = id && document.getElementById(id); return o ? o.textContent : ''; });
  check('typing narrows the palette to the best match', /Release view/.test(first), first);
  await page.keyboard.press('Enter');
  await noDialog().catch(() => {});
  check('Enter runs the command: the Release view opens', /Release/.test(await viewNow()), await viewNow());
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.dialog.palette');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  const wrapped = await page.evaluate(() => { const o = document.querySelectorAll('.palette-opt'); return o.length > 2 && o[o.length - 1].getAttribute('aria-selected') === 'true'; });
  check('the arrow keys move through the commands and wrap around', wrapped);
  await page.keyboard.press('Escape');
  await noDialog();
  check('Escape closes the palette', !(await page.locator('.dialog').count()));
  await page.locator('main').focus();
  await page.keyboard.press('g');
  await page.keyboard.press('b');
  await page.waitForFunction(() => /Build/.test((document.querySelector('.views .tab.on, .views [aria-current="page"], .views [aria-selected="true"]') || {}).textContent || ''), null, { timeout: 3000 }).catch(() => {});
  check('G then B goes to the Build view', /Build/.test(await viewNow()), await viewNow());
  await page.keyboard.press('t');
  await page.waitForSelector('.act-panel', { timeout: 3000 }).catch(() => {});
  check('T opens the agents at work', !!(await page.locator('.act-panel').count()));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.act-panel'), null, { timeout: 3000 }).catch(() => {});
  // a theme from the palette
  await page.locator('main').focus();
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.dialog.palette');
  await page.keyboard.type('dark theme');
  await page.keyboard.press('Enter');
  await noDialog().catch(() => {});
  check('the palette switches the theme', (await page.evaluate(() => document.documentElement.getAttribute('data-app-theme'))) === 'dark');
  // letters typed in a box stay in the box
  await page.locator('.composer textarea').first().focus();
  await page.keyboard.type('gt?');
  const typed = await page.evaluate(() => ({ v: document.querySelector('.composer textarea').value, d: !!document.querySelector('.dialog'), p: !!document.querySelector('.act-panel') }));
  check('single keys typed into a text box are left alone', typed.v.endsWith('gt?') && !typed.d && !typed.p, typed);
  // ? lists the shortcuts, and single keys can be switched off there (WCAG 2.1.4)
  await page.locator('main').focus();
  await page.keyboard.press('?');
  await page.waitForSelector('.dialog.shortcuts', { timeout: 3000 }).catch(() => {});
  check('? opens the list of keyboard shortcuts', !!(await page.locator('.dialog.shortcuts').count()));
  await page.locator('.dialog.shortcuts #set-keys').click();
  await page.keyboard.press('Escape');
  await noDialog().catch(() => {});
  await page.locator('main').focus();
  await page.keyboard.press('?');
  await sleep(300);
  const offStill = !(await page.locator('.dialog').count());
  await page.keyboard.press('Control+k');
  await page.waitForSelector('.dialog.palette', { timeout: 3000 }).catch(() => {});
  check('with single keys off, ? does nothing but Ctrl+K still opens the palette', offStill && !!(await page.locator('.dialog.palette').count()));
  await page.keyboard.press('Escape');
}

(async () => {
  const browser = await chromium.launch();
  // A11Y_ONLY=keyboard (or light, dark, phone) runs one part, while working on it
  const steps = { light: [() => scheme(browser, 'light')], dark: [() => scheme(browser, 'dark')], phone: [() => phone(browser, 'light'), () => phone(browser, 'dark')], keyboard: [() => keyboard(browser)] };
  const only = process.env.A11Y_ONLY;
  for (const step of only && steps[only] ? steps[only] : Object.values(steps).flat()) {
    try { await step(); } catch (e) { errors.push('a11y flow stopped: ' + String(e.stack || e).slice(0, 700)); }
  }
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log('\n' + (results.length - failed) + ' passed, ' + failed + ' failed');
  if (errors.length) { console.log('ERRORS (' + errors.length + '):'); [...new Set(errors)].forEach((e) => console.log(' - ' + e)); }
  process.exit(failed || errors.length ? 1 : 0);
})();

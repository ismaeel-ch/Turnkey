// A judge's walk through the live site: the README's five-minute walk-through and the demo video's shot list
// (docs/hackathon/demo-video.md), done the way a person would do it, by clicking what is on screen. Part 1 is the
// guided build of the clinic (questions, plan, build, first use, demo data, release 1.0, a fix, release 1.1); part 2,
// in a fresh browser, is Try a sample and the agents' teamwork. Each step saves a
// screenshot, so the run doubles as a picture book of the demo path. Demo mode only: it calls no model.
//
//   TK_URL=https://turnkey-bay.vercel.app node tests/e2e/judge.cjs
//   TK_URL=http://localhost:3000 JUDGE_SHOTS=/tmp/judge node tests/e2e/judge.cjs
//   npm run test:e2e -- judge          against a local production build, like the other flows
//
// The "Judge walk" workflow runs it by hand against the live site and keeps the screenshots as an artifact.
// Unlike flows.cjs it does not read or set the app's state through the test hook: what a judge cannot see or click,
// it does not check. It only reads the hook to wait for a build to finish, never to change anything.
// Exits 1 if any step fails. Writes a table to $GITHUB_STEP_SUMMARY when that is set.
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const base = String(process.env.TK_URL || process.argv[2] || '').replace(/\/+$/, '');
const shots = process.env.JUDGE_SHOTS || path.join(__dirname, 'shots', 'judge');
if (!/^https?:\/\/[^/\s]+$/.test(base)) {
  console.error('Give the site address, for example: TK_URL=https://turnkey-bay.vercel.app node tests/e2e/judge.cjs');
  process.exit(2);
}
fs.mkdirSync(shots, { recursive: true });

/** @type {{ n: number, name: string, status: 'pass' | 'fail', detail: string, ms: number }[]} */
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const firstLine = (e) =>
  String(e && e.message ? e.message : e)
    .split('\n')[0]
    .slice(0, 300);

/** Runs one step of the walk, saves a screenshot after it (also when it fails), and records the result. A step
 *  returns a short note for the summary, or throws with what went wrong. */
async function step(page, name, fn) {
  const n = results.length + 1;
  const started = Date.now();
  let status = 'pass';
  let detail = '';
  try {
    detail = (await fn()) || '';
  } catch (e) {
    status = 'fail';
    detail = firstLine(e);
  }
  const file = `${String(n).padStart(2, '0')}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)}.png`;
  await page.screenshot({ path: path.join(shots, file) }).catch(() => {});
  results.push({ n, name, status, detail, ms: Date.now() - started });
  console.log(`${status.toUpperCase().padEnd(4)} ${n}. ${name}${detail ? '  (' + detail + ')' : ''}`);
  return status === 'pass';
}

function expect(ok, what) {
  if (!ok) throw new Error(what);
}

/** Waits for the open app to be built and its agents to go quiet. Reads the test hook only to know when it is done. */
async function waitBuilt(page, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const s = await page.evaluate(() => {
      const st = window.__formwork && window.__formwork.state();
      if (!st) return null;
      const t = (st.tabs[st.session] || []).find((x) => x.id === st.active[st.session]);
      const a = t && t.app ? st.apps[t.app] : null;
      return a ? { status: a.status, name: a.name, tests: a.tests || null } : null;
    });
    const busy = await page.locator('.work-head .spin').count();
    if (s && (s.status === 'ready' || s.status === 'failed') && !busy) return s;
    await sleep(500);
  }
  throw new Error(`the build did not finish in ${Math.round(ms / 1000)} s`);
}

/** Opens one of the workspace's main tabs (Build, App, Release, Details) by its visible name. */
async function openTab(page, name) {
  await page.locator('.views .tab', { hasText: name }).first().click();
  await sleep(400);
}

const CLINIC = 'A clinic books appointments for patients with its doctors';

/** Part 1: the guided build, as the README's "See it in two minutes" tells it. Demo, so it calls no model. */
async function guidedWalk(page) {
  await step(page, 'Guided: Describe your own opens an empty workspace in Demo', async () => {
    await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.ob-card', { timeout: 45000 });
    await page.getByRole('button', { name: 'Describe your own' }).click();
    await page.waitForSelector('#home-prompt', { timeout: 30000 });
    // with a model connected the workspace starts in Live; the walk-through switches it off to replay the saved build
    const live = await page.locator('#sw-live').isChecked();
    if (live) await page.locator('#sw-live').click();
    await sleep(300);
    expect(!(await page.locator('#sw-live').isChecked()), 'Live is still on');
    return live ? 'Live was on; switched off for Demo' : 'Demo';
  });
  await step(page, 'Guided: the clinic sentence gets a question from the Planner', async () => {
    await page.fill('#home-prompt', CLINIC);
    await page.press('#home-prompt', 'Enter');
    await page.waitForSelector('.iv-ask', { timeout: 30000 });
    await sleep(500);
    const q = clean(await page.locator('.iv-ask').first().innerText());
    expect(/visit notes/i.test(q), 'question: ' + q.slice(0, 160));
    return q.slice(0, 120);
  });
  await step(page, 'Guided: usual answers lead to the plan, nothing built yet', async () => {
    for (let i = 0; i < 20 && !(await page.locator('.iv-act .iv-build').count()); i++) {
      const next = page.locator('.iv-ask .iv-usual, .iv-done .iv-review').first();
      if (await next.count()) await next.click();
      await sleep(400);
    }
    const plan = clean(await page.locator('body').innerText());
    expect(/Nothing is built until you press Build it/.test(plan), 'no "Nothing is built" line on the plan');
    expect(/Who uses it/.test(plan) && /Who can see and do what/.test(plan), 'plan: ' + plan.slice(0, 160));
    expect(!(await page.locator('.work-head').count()), 'an app was made before Build it');
    return (plan.match(/\d+ lists?, \d+ kinds? of people[^.]*?agents/) || [''])[0];
  });
  await step(page, 'Guided: Build it, every step done and every check passes', async () => {
    await page.locator('.iv-act .iv-build').click();
    const a = await waitBuilt(page, 180000);
    expect(a.status === 'ready' && a.tests && a.tests.failed === 0, 'status ' + a.status + ', tests ' + JSON.stringify(a.tests));
    await page.waitForSelector('.steps-view', { timeout: 15000 });
    const rows = await page.locator('.steps-list .step').evaluateAll((l) => l.map((x) => x.dataset.state));
    expect(rows.length >= 5 && rows.every((x) => x === 'done'), 'steps: ' + rows.join(', '));
    const first = clean(await page.locator('.steps-list .step').first().innerText());
    expect(/Planner/.test(first), 'first step: ' + first.slice(0, 120));
    return `${a.name}: ${rows.length} steps, ${a.tests.total} tests pass`;
  });
  await step(page, 'Guided: the app welcomes Sara, the receptionist', async () => {
    await openTab(page, 'App');
    await page.locator('.persona-btn', { hasText: 'Sara' }).first().click();
    await page.waitForSelector('.fr-welcome', { timeout: 15000 });
    const w = clean(await page.locator('.fr-welcome').innerText());
    expect(/Welcome, Sara/.test(w) && /Receptionist/.test(w), 'welcome: ' + w.slice(0, 160));
    return w.slice(0, 120);
  });
  await step(page, 'Guided: the app tour runs to the end', async () => {
    await page.locator('.fr-welcome button', { hasText: 'Show me around' }).click();
    let n = 0;
    while ((await page.locator('.fr-pop').count()) && n < 12) {
      n++;
      await page.locator('.fr-pop .btn.primary').click();
      await sleep(400);
    }
    expect(n >= 2 && !(await page.locator('.fr-pop').count()), `${n} stops, still open: ${await page.locator('.fr-pop').count()}`);
    return `${n} stops`;
  });
  await step(page, 'Guided: demo data is removed in one step', async () => {
    const bar = clean(await page.locator('.app .demo-bar').innerText());
    expect(/demo data/i.test(bar), 'no demo data bar');
    await page.locator('.app .demo-bar .btn', { hasText: 'Remove demo data' }).click();
    await page.locator('.dialog .btn.danger', { hasText: 'Remove demo data' }).click();
    await page.waitForSelector('.app .demo-bar:has-text("Demo data removed")', { timeout: 30000 });
    return bar.slice(0, 120);
  });
  await step(page, 'Guided: release 1.0, then a change gets a plan before it is made', async () => {
    await openTab(page, 'Release');
    await page.waitForSelector('#rel-go', { timeout: 15000 });
    await page.locator('#rel-go').click();
    await page.waitForFunction(() => /Version 1\.0 · up to date/.test((document.getElementById('rel-state') || {}).innerText || ''), null, {
      timeout: 60000,
    });
    await page.fill('#improve-text', 'Add a notes field to patients');
    await page.locator('#improve-go').click();
    const go = page.locator('.gcard.cplan [data-act="go"]');
    for (let i = 0; i < 100 && !(await go.count()); i++) {
      const o = page.locator('.gcard.ask .opt:not([disabled])');
      if (await o.count()) await o.first().click().catch(() => {});
      await sleep(300);
    }
    expect(await go.count(), 'no plan card with Go ahead');
    const plan = clean(await page.locator('.gcard.cplan').last().innerText());
    await go.last().click();
    await page.waitForSelector('.gcard.tryit', { timeout: 120000 });
    const a = await waitBuilt(page, 120000);
    expect(a.tests && a.tests.failed === 0, 'tests ' + JSON.stringify(a.tests));
    return plan.slice(0, 120);
  });
  await step(page, 'Guided: try it, then release the change as 1.1', async () => {
    await page.locator('.gcard.tryit [data-act="works"]').last().click();
    await page.locator('.gcard.tryit [data-act="release"]').last().click({ timeout: 30000 });
    await page.waitForSelector('#rel-go', { timeout: 15000 });
    await page.locator('#rel-go').click();
    await page.waitForFunction(() => /Version 1\.1 · up to date/.test((document.getElementById('rel-state') || {}).innerText || ''), null, {
      timeout: 60000,
    });
    await page.locator('.rel-hist').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await sleep(400);
    const v = clean(await page.locator('.rel-hist').innerText());
    expect(/1\.1/.test(v) && /1\.0/.test(v), 'versions: ' + v.slice(0, 160));
    return v.slice(0, 120);
  });
}

async function main() {
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => {
    page.on('pageerror', (e) => errors.push(firstLine(e)));
    // a server error a judge would run into; short links answer 503 on purpose where they are not set up
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (r.status() >= 500 && !(r.status() === 503 && u.pathname.startsWith('/api/share'))) errors.push(`HTTP ${r.status()} on ${u.pathname}`);
    });
  };
  const opts = { viewport: { width: 1440, height: 900 }, acceptDownloads: true };
  const gctx = await browser.newContext(opts);
  const gpage = await gctx.newPage();
  watch(gpage);
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  watch(page);

  try {
    // ---- part 1: the guided build ----
    await guidedWalk(gpage);
    await gctx.close();

    // ---- part 2: Try a sample and the agents' teamwork, in a fresh browser ----
    // ---- 1. the welcome screen (shot 1) ----
    await step(page, 'Welcome screen shows the headline and the stations', async () => {
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('.ob-card', { timeout: 45000 });
      await sleep(800);
      const text = clean(await page.locator('.ob-card').innerText());
      for (const b of ['Try a sample', 'Describe your own', 'Get started'])
        expect(await page.getByRole('button', { name: b }).isVisible(), `no ${b} button`);
      return text.slice(0, 120);
    });

    // ---- 2. first run: Try a sample signs in with the demo account, keeps Demo and builds the Sales bidding desk (shot 2) ----
    await step(page, 'Try a sample starts the Sales bidding desk build', async () => {
      await page.getByRole('button', { name: 'Try a sample' }).click();
      await page.waitForSelector('.work-head', { timeout: 30000 });
      await page.waitForSelector('.tour-pop', { timeout: 10000 });
      return clean(await page.locator('.tour-pop').innerText()).slice(0, 80);
    });

    // the guided tour starts with the workspace; a judge reads it through
    await step(page, 'Guided tour runs to the end', async () => {
      let n = 0;
      while ((await page.locator('.tour-pop').count()) && n < 25) {
        n++;
        if (n === 2) await page.screenshot({ path: path.join(shots, '02a-tour.png') });
        await page.locator('.tour-pop .btn.primary').click();
        await sleep(500);
      }
      expect(!(await page.locator('.tour-pop').count()), 'the tour is still open after 25 steps');
      expect(n === 4, `the short tour should have 4 steps, it had ${n}`);
      return n ? `${n} steps` : 'no tour shown';
    });

    // ---- 3, 4. the build: stations, checks, the Tester's planted slip and the repair ----
    await step(page, 'Build finishes with every test passing', async () => {
      await openTab(page, 'Build');
      const a = await waitBuilt(page, 180000);
      expect(a.status === 'ready', 'build status ' + a.status);
      expect(a.tests && a.tests.total > 0 && a.tests.failed === 0, 'tests ' + JSON.stringify(a.tests));
      await sleep(800);
      return `${a.name}: ${a.tests.total} tests pass`;
    });
    // the Build tab opens on a plain list of steps; the workflow canvas is one press away
    await step(page, 'Build lists the steps in plain words, all done', async () => {
      await page.waitForSelector('.steps-view', { timeout: 15000 });
      const rows = await page.locator('.steps-list .step').evaluateAll((l) => l.map((x) => x.dataset.state));
      const head = clean(await page.locator('.steps-head').innerText());
      expect(rows.length >= 6 && rows.every((x) => x === 'done'), 'steps: ' + rows.join(', '));
      expect(/is built/.test(head) && /Every check passes/.test(head), 'heading: ' + head.slice(0, 160));
      expect(!(await page.locator('.react-flow').count()), 'the workflow canvas shows before it is asked for');
      return `${rows.length} steps; ${head.slice(0, 80)}`;
    });
    await step(page, 'Show how it was built opens the workflow canvas', async () => {
      await page.getByRole('button', { name: 'Show how it was built' }).click();
      await page.waitForSelector('.react-flow .fl-node.station', { timeout: 15000 });
      await sleep(600);
      return `${await page.locator('.fl-node.station').count()} stations on the canvas`;
    });
    await step(page, 'Tests station shows the repair and is ready to release', async () => {
      await page.waitForSelector('.react-flow .fl-node.station', { timeout: 15000 });
      const nodes = await page.locator('.fl-node.station').allInnerTexts();
      const tests = nodes.find((t) => /repair/i.test(t));
      expect(tests, 'no station mentions the repair: ' + nodes.map(clean).join(' | ').slice(0, 200));
      return clean(tests).slice(0, 120);
    });
    await step(page, 'Tester panel tells run 1, the repair and run 2', async () => {
      const node = page.locator('.fl-node.station', { hasText: /repair/i }).first();
      await node.click();
      await page.waitForSelector('.review-insp', { timeout: 10000 });
      const tp = clean(await page.locator('.review-insp').innerText());
      expect(/Run 1/.test(tp) && /1 of \d+ failed/.test(tp), 'no failed run 1: ' + tp.slice(0, 200));
      expect(/repaired/i.test(tp) && /Run 2/.test(tp) && /all \d+ passed/.test(tp), 'no repaired run 2: ' + tp.slice(0, 200));
      return (tp.match(/1 of \d+ failed/) || [''])[0] + ', then ' + (tp.match(/all \d+ passed/) || [''])[0];
    });

    // ---- 5. the same run four ways, and the agents panel ----
    await step(page, 'Timeline view of the run', async () => {
      await page.keyboard.press('Escape').catch(() => {});
      await page.getByRole('button', { name: 'Timeline' }).click();
      await sleep(600);
      const u = clean(await page.locator('.tl-usage').innerText().catch(() => ''));
      return u.slice(0, 120);
    });
    await step(page, 'Log view of the run', async () => {
      await page.getByRole('button', { name: 'Log', exact: true }).click();
      await sleep(600);
    });
    await step(page, 'Meeting view: a tile per agent, the build line on the shared screen', async () => {
      await page.getByRole('button', { name: 'Meeting', exact: true }).click();
      await page.waitForSelector('.meet-tile', { timeout: 10000 });
      await sleep(600);
      const tiles = await page.locator('.meet-tile').count();
      const screen = clean(await page.locator('.meet-screen-head').innerText().catch(() => ''));
      expect(tiles >= 6, `${tiles} tiles`);
      expect(/6 of 6 stations checked/.test(screen), 'shared screen: ' + screen.slice(0, 120));
      return `${tiles} tiles; ${screen.slice(0, 80)}`;
    });
    await step(page, 'Agents panel: activity', async () => {
      await page.getByRole('button', { name: 'Workflow', exact: true }).click();
      await page.locator('.act-launch').click();
      await page.waitForSelector('.act-panel .act-agent', { timeout: 10000 });
      await sleep(400);
      const agents = await page.locator('.act-panel .act-agent').count();
      expect(agents >= 6, `${agents} agents listed`);
      return `${agents} agents listed`;
    });
    await step(page, 'Agents panel: how it works', async () => {
      await page.locator('.act-tab-how').click();
      await page.waitForSelector('.act-how', { timeout: 10000 });
      await sleep(400);
      await page.locator('.act-launch').click();
      await sleep(400);
    });

    // ---- 6. the app it built: sign in as Sana, then preview as Omar ----
    await step(page, 'App tab: sign in as Sana Malik', async () => {
      await openTab(page, 'App');
      await page.waitForSelector('.login-card', { timeout: 15000 });
      await page.screenshot({ path: path.join(shots, '13a-app-sign-in.png') });
      await page.locator('.persona-btn', { hasText: 'Sana' }).first().click();
      await page.waitForSelector('.app-nav', { timeout: 15000 });
      await sleep(500);
      const nav = (await page.locator('.app-nav .nav-i').allInnerTexts()).map(clean);
      return 'pages: ' + nav.join(', ');
    });
    await step(page, 'Preview as Omar Farooq, the sales director', async () => {
      await page.selectOption('select[aria-label="Preview as"]', { label: 'Omar Farooq · Sales director' });
      await sleep(600);
      const nav = (await page.locator('.app-nav .nav-i').allInnerTexts()).map(clean);
      return 'pages: ' + nav.join(', ');
    });

    // ---- 7. the Bid room: the app's own agent team, with a pause for a person ----
    await step(page, 'Bid room: run the team on the port authority tender', async () => {
      await page.selectOption('select[aria-label="Preview as"]', { label: 'Sana Malik · Bid manager' });
      await sleep(400);
      await page.locator('.app-nav .nav-i', { hasText: 'Bid room' }).click();
      await page.waitForSelector('.team.room', { timeout: 15000 });
      const chip = page.locator('.team-start .chip', { hasText: /port/i }).first();
      expect(await chip.count(), 'no example tender for the port authority');
      await chip.click();
      await sleep(100);
      await page.locator('.team-start button[type=submit]').click();
      await page.waitForSelector('.team-log .gcard.ask', { timeout: 60000 });
      await sleep(400);
      const scores = await page.locator('.bdp-scores .bd-srows li').count();
      const prices = await page.locator('.bdp-options .bd-opt').count();
      expect(scores > 0 && prices > 0, `scores ${scores}, prices ${prices}`);
      return `paused for you after ${scores} score lines and ${prices} prices`;
    });
    await step(page, 'Bid room: add a condition, continue, Red team verdict', async () => {
      await page.fill('.team-log .gcard.ask input', 'Ask for a site visit first');
      await page.locator('.team-log .gcard.ask .btn', { hasText: 'Add' }).click();
      await sleep(150);
      await page.locator('.team-log .gcard.ask .btn.primary').click();
      await page.waitForSelector('.verdict', { timeout: 60000 });
      await sleep(800);
      const v = clean(await page.locator('.verdict').innerText());
      expect(/Bid|No bid|bid/.test(v), 'verdict: ' + v.slice(0, 120));
      return v.slice(0, 120);
    });

    // ---- 8. a change from chat ----
    await step(page, 'Chat: "Add a notes field to score lines"', async () => {
      await openTab(page, 'Build');
      const chip = page.getByRole('button', { name: /Add a notes field to score lines/ }).first();
      if (await chip.count()) await chip.click();
      else {
        await page.fill('.chat textarea, .chat input[type=text]', 'Add a notes field to score lines');
        await page.keyboard.press('Enter');
      }
      await sleep(1000);
      const a = await waitBuilt(page, 120000);
      expect(a.status === 'ready', 'status ' + a.status);
      expect(a.tests && a.tests.failed === 0, 'tests ' + JSON.stringify(a.tests));
      await sleep(600);
      const applied = page.locator('.gcard', { hasText: 'Add Notes' }).last();
      expect(await applied.count(), 'no Applied card for the notes field in chat');
      const ran = clean(await applied.innerText()).match(/Ran again (.*)$/);
      return `ran again: ${ran ? ran[1] : '?'}; ${a.tests.total} tests pass`;
    });

    // ---- 8b. edits on the canvas: a field on the Data page, the look on the App page ----
    await step(page, 'Data page: add a field, only the touched stations run again', async () => {
      await openTab(page, 'Details');
      await page.locator('.subtabs').getByRole('tab', { name: 'Data', exact: true }).click();
      await page.locator('.split .side-i', { hasText: 'tenders' }).first().click();
      await page.getByRole('tab', { name: 'Columns' }).click();
      await page.waitForSelector('.field-edit', { timeout: 10000 });
      await page.getByLabel('New field name').fill('Site visit date');
      await page.getByLabel('New field type').selectOption('date');
      await page.locator('.field-edit .btn', { hasText: 'Add field' }).click();
      await sleep(1000);
      const a = await waitBuilt(page, 120000);
      expect(a.status === 'ready' && a.tests && a.tests.failed === 0, 'status ' + a.status + ', tests ' + JSON.stringify(a.tests));
      const row = page.locator('.main-body tr', { hasText: 'site_visit_date' });
      expect(await row.count(), 'the Columns tab does not list site_visit_date');
      const plan = page.locator('.gcard', { hasText: /Site visit date/i }).last();
      return clean(await plan.innerText().catch(() => '')).slice(0, 140) || clean(await row.innerText()).slice(0, 120);
    });
    await step(page, 'App page: Look menu moves the navigation to an icon rail', async () => {
      await openTab(page, 'App');
      await page.waitForSelector('.stage-bar .look-btn', { timeout: 15000 });
      await page.locator('.stage-bar .look-btn').click();
      await page.locator('.menu .mi', { hasText: 'Icon rail' }).click();
      await sleep(1000);
      const a = await waitBuilt(page, 120000);
      expect(a.status === 'ready', 'status ' + a.status);
      const said = await page.getByText(/On the App page: Use an icon rail/).count();
      expect(said, 'the chat does not record the Look change as yours');
      return 'chat: "On the App page: Use an icon rail"';
    });

    // ---- 9. release and share ----
    await step(page, 'Release version 1.0', async () => {
      await openTab(page, 'Release');
      await page.waitForSelector('#rel-go', { timeout: 15000 });
      await page.locator('#rel-go').click();
      await page.waitForFunction(() => /Version 1\.0 · up to date/.test((document.getElementById('rel-state') || {}).innerText || ''), null, {
        timeout: 60000,
      });
      return clean(await page.locator('#rel-state').innerText());
    });
    await step(page, 'Share by link', async () => {
      await page.locator('#rel-share').click();
      await page.waitForSelector('.dialog.share', { timeout: 10000 });
      await page.waitForFunction(() => /#app=1\./.test((document.getElementById('sh-link') || {}).value || ''), null, { timeout: 20000 });
      await sleep(1500);
      const short = await page.inputValue('#sh-short').catch(() => '');
      return short ? 'short link ' + short : 'long link only';
    });

    // ---- 10. debug mode ----
    await step(page, 'Debug drawer: AG-UI events and tool calls', async () => {
      await page.locator('.dialog .dhead .btn[aria-label="Close"]').click();
      await sleep(300);
      await page.locator('.titlebar [data-tour=debug]').click();
      await page.waitForSelector('.debug', { timeout: 10000 });
      await sleep(400);
      const rows = await page.locator('.dbg-body tr').count();
      expect(rows > 2, `${rows} rows`);
      await page.locator('.dbg-head').getByRole('tab', { name: /^Tool calls/ }).click();
      await sleep(300);
      return `${rows} events`;
    });

    // ---- 11. back to the finished workflow ----
    await step(page, 'Finished workflow canvas', async () => {
      await page.locator('.dbg-head .btn[aria-label="Close debug"]').click();
      await openTab(page, 'Build');
      await page.getByRole('button', { name: 'Workflow', exact: true }).click();
      await sleep(800);
    });

    // the page itself must not have thrown along the way
    await step(page, 'No errors on the page', async () => {
      expect(!errors.length, errors.slice(0, 3).join(' | '));
    });
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => r.status === 'fail').length;
  console.log(`\n${results.length - failed} of ${results.length} steps passed. Screenshots in ${shots}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map((r) => `| ${r.status === 'pass' ? '✅' : '❌'} | ${r.n}. ${r.name} | ${Math.round(r.ms / 1000)} s | ${r.detail.replace(/\|/g, '\\|')} |`);
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [`### Judge walk of ${base}`, '', '| | Step | Took | Detail |', '| - | - | - | - |', ...rows, ''].join('\n'),
    );
  }
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

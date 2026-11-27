// Live builds against a REAL model. Not part of CI: it spends model budget.
//
//   LLM_PROVIDER=claude-code npx next dev -p 3107 > /tmp/dev.log 2>&1 &
//   TK_URL=http://localhost:3107 TK_LOG=/tmp/dev.log node tests/e2e/live-real.cjs clinic,helpdesk,leave,gym,factcheck,priorart,debate
//
// For each sample it types the sample's sentence into Home with Live on (so every agent is a real model call), answers
// any approval card with its first option, and waits for the build to finish. For each quest it builds the quest app,
// opens the team page and runs the team on one of its sample inputs, live, on the server. It prints one JSON line per
// run with the outcome, the stations that failed, fell back or were sent back, and, when TK_LOG names the server's log,
// the model calls, tokens and cost read from its `[llm]` lines.
const fs = require('fs');
const { chromium } = require('playwright');

const url = process.env.TK_URL || 'http://localhost:3000';
const logPath = process.env.TK_LOG;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SENTENCES = {
  clinic: 'A clinic front desk books patient appointments, doctors work from their own schedule and write visit notes, and the manager tracks no-shows.',
  helpdesk: 'An IT helpdesk where employees raise tickets, support agents work a queue by priority, and the team lead watches what is due.',
  leave: 'Employees request leave, managers approve or reject it, and HR keeps balances and the team calendar.',
  gym: 'A gym tracks members, class bookings and trainers',
  biddesk: 'A sales team bids on tenders: bid managers prepare each bid with a price, three agents score the tender, price it and challenge it, the sales director approves it before it goes out, and everyone sees what was won or lost.',
  grants: 'A community foundation reviews grant applications: programme officers record each one, three agents score it, size the award and check it, the board chair approves every grant, and trustees can read everything.',
  purchasing: 'Staff raise purchase requests, their budget holder approves or rejects each one, the buyer orders from an approved supplier, and the person who asked confirms delivery.',
};
const QUEST_CHIP = { factcheck: 'Company blog draft', priorart: 'Smart bottle cap', debate: 'One codebase first' };

const CLI_OVERHEAD = 1849;
const logSize = () => (logPath && fs.existsSync(logPath) ? fs.statSync(logPath).size : 0);
function usageSince(offset) {
  if (!logPath) return null;
  const text = fs.readFileSync(logPath, 'utf8').slice(offset);
  const u = { apiUsd: 0, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, byTier: {}, errors: [] };
  for (const line of text.split('\n')) {
    const m = /\[llm\] (\S+) (\S+) (\S+) in=(\d+) out=(\d+)(?: cache_read=(\d+))?(?: cache_write=(\d+))?(?: \$([\d.]+))?/.exec(line);
    if (m) {
      u.calls++;
      u.input += +m[4];
      u.output += +m[5];
      u.cacheRead += +(m[6] || 0);
      u.cacheWrite += +(m[7] || 0);
      u.costUsd += +(m[8] || 0);
      // what the same call would cost on the Claude API: the Claude Code command adds its own scaffolding (about 1,850
      // tokens read from its cache on every call), which a direct API call does not send; nothing is cached on the API
      const prompt = Math.max(0, +m[4] + +(m[6] || 0) + +(m[7] || 0) - CLI_OVERHEAD);
      const p = /haiku/.test(m[2]) ? [0.1, 0.5] : [2, 10];
      u.apiUsd += (prompt * p[0] + +m[5] * p[1]) / 1e6;
      const t = m[3].split('/')[0];
      u.byTier[t] = (u.byTier[t] || 0) + 1;
    } else if (/error|fail|refus/i.test(line) && !/GET \/api\/health/.test(line)) u.errors.push(line.slice(0, 300));
  }
  u.costUsd = Math.round(u.costUsd * 10000) / 10000;
  u.apiUsd = Math.round(u.apiUsd * 10000) / 10000;
  u.errors = u.errors.slice(0, 12);
  return u;
}

const current = (page) =>
  page.evaluate(() => {
    const s = window.__formwork.state(),
      t = (s.tabs[s.session] || []).find((x) => x.id === s.active[s.session]),
      a = t && t.app ? s.apps[t.app] : null;
    if (!a) return null;
    return {
      name: a.name,
      status: a.status,
      busy: !!window.__formwork.wf.runs()[a.id],
      qa: a.qa ? { status: a.qa.status, by: a.qa.by, rounds: a.qa.rounds.map((r) => [r.failed, r.total, r.fixes.map((f) => (f.ok ? '+' : '-') + f.text)]), dropped: a.qa.dropped.length } : null,
      tables: a.def.tables.map((x) => x.name + '(' + x.columns.length + ')'),
      screens: a.def.screens.length,
      line: Object.fromEntries(Object.keys(a.line).map((k) => [k, a.line[k].status])),
      attempts: Object.fromEntries(Object.keys(a.line).map((k) => [k, a.line[k].attempt])),
      fellBack: Object.keys(a.line).filter((k) => a.line[k].fellBack),
      retries: a.runs.map((r) => r.retries),
      tour: a.line.walkthrough && a.line.walkthrough.results ? a.line.walkthrough.results.map((r) => r.ok) : [],
      chat: a.chat.slice(-6).map((c) => (c.who || c.agent || '') + ': ' + String(c.text || (c.card && (c.card.title || c.card.type)) || '').slice(0, 300)),
    };
  });

/** The whole app record, for reading what the agents made (TK_DUMP names a folder). */
async function dumpApp(page, id) {
  if (!process.env.TK_DUMP) return;
  const app = await page.evaluate(() => {
    const s = window.__formwork.state(),
      t = (s.tabs[s.session] || []).find((x) => x.id === s.active[s.session]);
    return t && t.app ? s.apps[t.app] : null;
  });
  fs.mkdirSync(process.env.TK_DUMP, { recursive: true });
  fs.writeFileSync(`${process.env.TK_DUMP}/${id}.json`, JSON.stringify(app, null, 1));
}

async function enterLive(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text().slice(0, 300)));
  await page.goto(url);
  await page.waitForSelector('.ob-card', { timeout: 60000 });
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: /Skip and use the demo account/ }).click();
  await page.waitForFunction(() => !document.querySelectorAll('.choice')[1]?.disabled, null, { timeout: 30000 });
  await page.locator('.choice').nth(1).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /empty workspace/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.ob-body .switch').click();
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await page.waitForSelector('.home');
  await page.evaluate((tier) => {
    const st = window.__formwork.state().settings;
    st.speed = 'instant';
    if (tier) st.tier = tier; // TK_TIER=quick builds on the fast model
  }, process.env.TK_TIER || '');
  return { ctx, page, errors };
}

async function waitDone(page, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const a = await current(page);
    if (a && !a.busy && (a.status === 'ready' || a.status === 'failed' || a.status === 'stopped')) return a;
    const o = page.locator('.gcard.ask .opt:not([disabled])');
    if (await o.count()) await o.first().click().catch(() => {});
    await sleep(1000);
  }
  return { ...(await current(page)), timedOut: true };
}

async function runSample(browser, id) {
  const { ctx, page, errors } = await enterLive(browser);
  const off = logSize(), t0 = Date.now();
  await page.fill('#home-prompt', SENTENCES[id]);
  await page.locator('#home-go').click();
  // the Planner's questions come first: take the usual choices, then approve the plan it writes
  await page.waitForSelector('.iv-ask, .iv-act .iv-build', { timeout: 3 * 60_000 });
  if (await page.locator('.iv-usual').count()) await page.locator('.iv-usual').click();
  await page.locator('.iv-act .iv-build').click({ timeout: 3 * 60_000 });
  const a = await waitDone(page, 15 * 60_000);
  await page.screenshot({ path: `/tmp/live-real-${id}.png` }).catch(() => {});
  await dumpApp(page, id);
  const out = { run: id, seconds: Math.round((Date.now() - t0) / 1000), ...a, pageErrors: errors.slice(0, 8), usage: usageSince(off) };
  await ctx.close();
  return out;
}

async function runQuest(browser, id) {
  const { ctx, page, errors } = await enterLive(browser);
  await page.locator(`[data-tpl="${id}"] .tpl-build`).click();
  await waitDone(page, 300_000);
  await page.locator('.views .tab', { hasText: 'App' }).first().click();
  await sleep(300);
  if (await page.locator('.persona-btn').count()) await page.locator('.persona-btn').first().click();
  await page.waitForSelector('.app-nav .nav-i');
  await page.locator('.app-nav .nav-i').nth(1).click();
  await page.waitForSelector('.team');
  const off = logSize(), t0 = Date.now();
  await page.locator('.team-start .chip', { hasText: QUEST_CHIP[id] }).click();
  await sleep(100);
  await page.locator('.team-start button[type=submit]').click();
  const end = Date.now() + 15 * 60_000;
  let T;
  while (Date.now() < end) {
    T = await page.evaluate(() => {
      const s = window.__formwork.state(),
        t = s.tabs[s.session].find((x) => x.id === s.active[s.session]),
        T = window.__formwork.teams()[t.app];
      return T
        ? { status: T.status, live: T.live, wait: !!T.wait, error: T.error, steps: T.steps.map((x) => ({ s: x.status, rows: x.rows.length, upd: x.updated, problems: x.problems.length, tools: x.tools.length, say: String(x.say || x.text || '').slice(0, 160) })) }
        : null;
    });
    if (T && T.wait) {
      const box = page.locator('.team-log .gcard.ask input');
      if (await box.count()) {
        await box.fill('We have no on-call rota yet');
        await page.locator('.team-log .gcard.ask .btn', { hasText: 'Add' }).click().catch(() => {});
      }
      const go = page.locator('.team-log .gcard.ask .btn.primary');
      if (await go.count()) await go.first().click().catch(() => {});
    }
    if (T && T.status !== 'running' && !T.wait) break;
    await sleep(1500);
  }
  await page.screenshot({ path: `/tmp/live-real-${id}.png` }).catch(() => {});
  const out = { run: 'team:' + id, seconds: Math.round((Date.now() - t0) / 1000), team: T, pageErrors: errors.slice(0, 8), usage: usageSince(off) };
  await ctx.close();
  return out;
}

(async () => {
  const which = (process.argv[2] || 'clinic,helpdesk,leave,gym,factcheck,priorart,debate').split(',');
  const browser = await chromium.launch();
  for (const id of which) {
    let r;
    try {
      r = SENTENCES[id] ? await runSample(browser, id) : await runQuest(browser, id);
    } catch (e) {
      r = { run: id, crashed: String(e).slice(0, 500) };
    }
    console.log(JSON.stringify(r));
  }
  await browser.close();
})();

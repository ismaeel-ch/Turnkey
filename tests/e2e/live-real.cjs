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
  'expense-me': 'I want to build an expense management app.',
  'expense-company': 'I want to build an expense management app.',
  purchasing: 'Staff raise purchase requests, their budget holder approves or rejects each one, the buyer orders from an approved supplier, and the person who asked confirms delivery.',
  // the way an owner with no technical words would put it: nothing here matches a saved build
  members: 'I run a small gym and want to keep track of memberships, who has paid this month and when each membership runs out.',
  schoolleave: 'Parents ask for their child to have days off school, the class teacher says yes or no, and the head teacher sees who is away each day.',
  shop: 'My corner shop needs to know what stock we have, what is running low and what we have ordered from suppliers.',
  rota: 'We are a small charity and need a rota so volunteers can sign up for shifts at our food bank.',
  salon: 'A hair salon where customers book appointments with a stylist and we keep a note of what was done each visit.',
  repairs: 'A phone repair shop logs each phone that comes in, the technician fixes it, and the front desk tells the customer when it is ready to collect.',
  tutor: 'I am a private tutor. I want to keep track of my students, their lessons and which lessons have been paid for.',
  hall: 'People book our community hall for events and the committee approves or turns down each booking.',
  faults: 'Staff in our office report broken things like lights or chairs, and the caretaker fixes them and marks them done.',
  reading: 'Just for me: a list of books I want to read, the ones I am reading and what I thought of each.',
  // a second round of everyday prompts (27 Nov): more domains, one-person and team apps
  dogwalk: 'I walk dogs for people in my neighbourhood and need to keep track of the dogs, my walks and who still owes me money.',
  cakes: 'Our bakery takes custom cake orders: the customer orders, the baker makes it, and a driver delivers it on the day.',
  loans: 'Our office lends out laptops and projectors. Staff borrow them and IT checks them back in and chases late returns.',
  allotment: 'A community garden with plots: people apply for a plot, the committee gives them one, and the treasurer records the yearly fee.',
  habits: 'Just for me: my daily habits like exercise, reading and drinking water, and how many days in a row I kept each one.',
  invoices: 'I am a freelance designer. I want to send invoices to my clients and see which ones are still unpaid.',
  hiring: 'A small company hiring people: candidates apply for a job, interviewers leave feedback, and the hiring manager decides who gets an offer.',
  vans: 'We have five delivery vans and need to track who drives each one, what we spend on fuel and when each van is due for a service.',
  wedding: 'I am planning my wedding and need to keep track of guests, who has replied and what each of them will eat.',
  football: 'Our kids football club needs to register players, collect the season fees and pick the squad for each match.',
  // apps that work things out (28 Nov): totals from lines, budgets, bookings that must not clash, moves with a condition
  quotes: 'We are a print shop. Staff write quotes made of line items with a quantity and a unit price, the app adds up the total, quotes over 2,000 need the owner to approve them, and an accepted quote cannot be changed any more.',
  rooms: 'Our company has six meeting rooms. Staff book a room for a start and end time, a room cannot be booked twice at the same time, the office manager approves bookings longer than four hours, and we want to see how many hours each room is used.',
  builder: 'I run a small building firm. Each job has a budget, we log costs for materials and labour against it, the app shows what is spent and what is left, and a job cannot be marked finished while it is over budget unless the director signs it off.',
  garage: 'A car garage: reception books cars in for a mechanic and a time slot without double-booking the mechanic, the mechanic records parts and hours, the app works out the bill, and the car can only be handed back once the bill is paid.',
};
// which answer to give when the Planner asks who the app is for; every other question takes the usual choice
const PREFER = { 'expense-me': /just me|myself|only me|personal|my own/i, 'expense-company': /company|team|business|staff|employees/i };
const QUEST_CHIP = { factcheck: 'Company blog draft', priorart: 'Smart bottle cap', debate: 'One codebase first' };

const CLI_OVERHEAD = 1849;
const logSize = () => (logPath && fs.existsSync(logPath) ? fs.statSync(logPath).size : 0);
function usageSince(offset) {
  if (!logPath) return null;
  const text = fs.readFileSync(logPath, 'utf8').slice(offset);
  const u = { apiUsd: 0, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, byTier: {}, errors: [] };
  for (const line of text.split('\n')) {
    let m = /\[llm\] (\S+) (\S+) (\S+) in=(\d+) out=(\d+)(?: cache_read=(\d+))?(?: cache_write=(\d+))?(?: \$([\d.]+))?/.exec(line);
    if (!m && line.startsWith('{') && line.includes('"event":"model_call"')) {
      try {
        const j = JSON.parse(line);
        m = [line, j.provider, j.model, j.tier || '', j.inputTokens || 0, j.outputTokens || 0, j.cacheReadTokens || 0, j.cacheWriteTokens || 0, j.costUsd || 0];
      } catch {}
    }
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
      plan: a.plan ? { name: a.plan.name, people: a.plan.people.map((p) => p.id), lists: a.plan.lists.map((l) => l.name), stages: a.plan.stages ? a.plan.stages.stages.map((x) => x.id) : null } : null,
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
  let said = 0;
  while (Date.now() < end) {
    const a = await current(page);
    if (process.env.TK_TRACE && a && Date.now() - said > 30_000) {
      said = Date.now();
      console.error(new Date().toISOString().slice(11, 19), a.status, a.busy ? 'busy' : '', JSON.stringify(a.line), (a.chat || []).slice(-2).join(' / ').slice(0, 300));
    }
    if (a && !a.busy && (a.status === 'ready' || a.status === 'failed' || a.status === 'stopped')) return a;
    const o = page.locator('.gcard.ask .opt:not([disabled])');
    if (await o.count()) await o.first().click().catch(() => {});
    // a pause the plan asked for: approve it, in the chat card or on the list of steps
    const go = page.getByRole('button', { name: /^(Approve and continue|Looks right, continue)$/ });
    if (await go.count()) await go.first().click().catch(() => {});
    await sleep(1000);
  }
  return { ...(await current(page)), timedOut: true };
}

/** TK_UNUSUAL names runs that answer every card otherwise than usual, so the Planner writes the plan a second time. */
const unusual = (process.env.TK_UNUSUAL || '').split(',');
async function answerOtherwise(page) {
  for (let n = 0; n < 8; n++) {
    await page.waitForFunction(() => { const iv = window.__formwork.view().home.interview; return iv && (iv.error || iv.plan || (!iv.busy && document.querySelector('.iv-ask, .iv-review'))); }, null, { timeout: 3 * 60_000 });
    const ask = page.locator('.iv-ask');
    if (!(await ask.count())) {
      // every card is answered: "Review the plan" has the Planner write it from the answers
      if (await page.locator('.iv-review').count()) await page.locator('.iv-review').click();
      return;
    }
    const card = await page.evaluate((cid) => window.__formwork.view().home.interview.cards.find((c) => c.id === cid), await ask.getAttribute('data-card'));
    if (card.id === 'demo_data' || card.options.length < 2) await page.locator(`.iv-ask .iv-opt[data-opt="${card.usual[0] || card.options[0].id}"]`).click();
    else if (card.kind === 'many') {
      for (const o of card.options) if (!card.usual.includes(o.id)) await page.locator(`.iv-ask .iv-opt[data-opt="${o.id}"]`).click();
      await page.locator('.iv-ask .iv-next').click();
    } else await page.locator(`.iv-ask .iv-opt[data-opt="${(card.options.find((o) => !card.usual.includes(o.id)) || card.options[0]).id}"]`).click();
    await sleep(400);
  }
}

async function runSample(browser, id) {
  const { ctx, page, errors } = await enterLive(browser);
  const off = logSize(), t0 = Date.now();
  await page.fill('#home-prompt', SENTENCES[id]);
  await page.locator('#home-go').click();
  // the Planner's questions come first: take the usual choices, then approve the plan it writes
  await page.waitForFunction(() => { const iv = window.__formwork.view().home.interview; return iv && (iv.error || (!iv.busy && (iv.cards.length || iv.plan))); }, null, { timeout: 3 * 60_000 });
  const asked = await page.evaluate(() => JSON.parse(JSON.stringify(window.__formwork.view().home.interview)));
  const ivFailed = asked.error;
  const picks = [];
  if (!ivFailed && PREFER[id]) {
    // answer card by card: the preferred option where one matches, else the usual one, else the first
    for (let i = 0; i < 8; i++) {
      await page.waitForSelector('.iv-ask, .iv-review, .iv-act .iv-build', { timeout: 3 * 60_000 });
      const card = page.locator('.iv-ask');
      if (!(await card.count())) break;
      const title = (await card.locator('h3').innerText()).trim();
      const opts = card.locator('.iv-opt');
      const labels = await opts.locator('strong').allInnerTexts();
      let k = labels.findIndex((l) => PREFER[id].test(l));
      if (k < 0) k = Math.max(0, await opts.evaluateAll((els) => els.findIndex((e) => /Usual choice/.test(e.textContent))));
      picks.push(title + ' -> ' + labels[k] + ' [' + labels.join(' | ') + ']');
      await opts.nth(k).click();
      if (await card.locator('.iv-next').count()) await card.locator('.iv-next').click().catch(() => {});
      await page.waitForFunction((t) => !document.querySelector('.iv-ask h3') || document.querySelector('.iv-ask h3').textContent.trim() !== t, title, { timeout: 3 * 60_000 });
      if (process.env.TK_TRACE) console.error('[' + id + '] ' + picks[picks.length - 1]);
    }
    // answers that differ from the usual ones are sent back to the Planner, which rewrites the plan
    if (await page.locator('.iv-review').count()) await page.locator('.iv-review').click();
  } else if (!ivFailed && unusual.includes(id)) await answerOtherwise(page);
  else if (!ivFailed && (await page.locator('.iv-usual').count())) await page.locator('.iv-usual').click();
  if (!ivFailed) await page.waitForFunction(() => { const iv = window.__formwork.view().home.interview; return iv && (iv.error || (!iv.busy && iv.plan)); }, null, { timeout: 3 * 60_000 });
  const planned = await page.evaluate(() => JSON.parse(JSON.stringify(window.__formwork.view().home.interview)));
  if (process.env.TK_DUMP) {
    fs.mkdirSync(process.env.TK_DUMP, { recursive: true });
    fs.writeFileSync(`${process.env.TK_DUMP}/${id}.interview.json`, JSON.stringify({ asked, planned }, null, 1));
  }
  if (ivFailed || planned.error) {
    const out = { run: id, seconds: Math.round((Date.now() - t0) / 1000), interviewError: ivFailed || planned.error, pageErrors: errors.slice(0, 8), usage: usageSince(off) };
    await ctx.close();
    return out;
  }
  await page.locator('.iv-act .iv-build').click({ timeout: 3 * 60_000 });
  const a = await waitDone(page, 15 * 60_000);
  await page.screenshot({ path: `/tmp/live-real-${id}.png` }).catch(() => {});
  await dumpApp(page, id);
  const out = { run: id, seconds: Math.round((Date.now() - t0) / 1000), asked, picks, ...a, pageErrors: errors.slice(0, 8), usage: usageSince(off) };
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

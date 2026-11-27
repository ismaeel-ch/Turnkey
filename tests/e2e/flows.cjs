// End-to-end checks in a real browser, against the running app (TK_URL, set by tests/e2e/run.mjs).
// These are the prototype's 286 checks, kept as they were written: they drive the workspace through the page and
// through the window.__formwork test hook. Only the harness around them changed (no CDN stand-ins, no own server).
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const shots = path.join(__dirname, 'shots');
fs.mkdirSync(shots, { recursive: true });
const NO_CANVAS = 'window.__turnkeyOptions = { canvas: false };'; // ask the page for the plain line of stations, as if the canvas library were missing
const which = process.argv[2] || 'all', results = [], errors = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail !== undefined && (!ok || process.env.V) ? '  → ' + JSON.stringify(detail) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser, opts) {
  const ctx = await browser.newContext({ viewport: (opts && opts.viewport) || { width: 1440, height: 900 }, colorScheme: (opts && opts.scheme) || 'light' });
  await ctx.route('https://**/*', (route) => route.abort()); // the app is self-contained: nothing outside its own origin is needed
  if (opts && opts.init) await ctx.addInitScript(opts.init);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.stack || e).slice(0, 500)));
  return { ctx, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(shots, name + '.png') });
const st = (page, fn, arg) => page.evaluate(fn, arg);
const appState = (page) => st(page, () => { const s = window.__formwork.state(); const tabs = s.tabs[s.session] || [], t = tabs.find((x) => x.id === s.active[s.session]); const a = t && t.app ? s.apps[t.app] : null; if (!a) return null; return { id: a.id, name: a.name, status: a.status, tables: a.def.tables.map((x) => x.name), cols: Object.fromEntries(a.def.tables.map((x) => [x.name, x.columns.map((c) => c.name)])), screens: a.def.screens.map((x) => x.name), accent: a.def.theme.accent, nav: a.def.theme.nav, mig: a.def.migrations.length, line: Object.fromEntries(Object.keys(a.line).map((k) => [k, a.line[k].status])), retries: a.runs.map((r) => r.retries), attempts: Object.fromEntries(Object.keys(a.line).map((k) => [k, a.line[k].attempt])), views: Object.fromEntries(Object.keys(a.def.views || {}).map((k) => [k, a.def.views[k].map((v) => v.type)])), widgets: a.def.dash ? a.def.dash.widgets.length : 0, team: a.def.team ? a.def.team.agents.map((x) => x.id) : null, dashRoles: (a.def.screens.find((x) => x.type === 'dashboard') || { roles: [] }).roles.length, runs: a.runs.map((r) => r.kind + ':' + r.status), tour: a.line.walkthrough.results.map((r) => r.ok), tourLen: a.def.tour.length, access: a.def.access, chat: a.chat.length, last: a.chat[a.chat.length - 1] }; });
const waitReady = (page, ms) => page.waitForFunction(() => { const s = window.__formwork.state(); const tabs = s.tabs[s.session] || [], t = tabs.find((x) => x.id === s.active[s.session]); const a = t && t.app ? s.apps[t.app] : null; return a && (a.status === 'ready' || a.status === 'failed') && !document.querySelector('.work-head .spin'); }, null, { timeout: ms || 90000 });
const waitIdle = async (page) => { await sleep(250); await page.waitForFunction(() => !document.querySelector('.work-head .spin') && !document.querySelector('.titlebar .wtab.on .spin'), null, { timeout: 60000 }); await sleep(150); };
const say = async (page, text) => { await page.fill('.composer textarea', text); await page.press('.composer textarea', 'Enter'); await sleep(200); };
const view = async (page, name) => { if (['Tests', 'Data', 'API', 'Connections'].includes(name)) { const on = await page.locator('.subtabs').count(); if (!on) await page.locator('.views .tab', { hasText: 'Details' }).click(); return page.locator('.subtabs').getByRole('tab', { name, exact: true }).click(); } return page.locator('.views .tab', { hasText: name }).first().click(); };
const setSpeed = (page, v) => st(page, (x) => { window.__formwork.state().settings.speed = x; }, v);
const waitTeam = (page, ms) => page.waitForFunction(() => { const s = window.__formwork.state(), t = (s.tabs[s.session] || []).find((x) => x.id === s.active[s.session]), T = t && window.__formwork.teams()[t.app]; return T && T.status !== 'running'; }, null, { timeout: ms || 40000 });
const teamNow = (page) => st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]), T = window.__formwork.teams()[t.app]; return T ? { status: T.status, live: T.live, steps: T.steps.map((x) => x.status), rows: T.steps.map((x) => x.rows.length), updated: T.steps.map((x) => x.updated), tools: T.steps.map((x) => x.tools.length), notes: T.notes.length, wait: !!T.wait, error: T.error } : null; });
async function enter(page, url) { // first run, demo account, empty workspace, no tour
  await page.goto(url); await page.waitForSelector('.ob-card', { timeout: 20000 });
  await page.getByRole('button', { name: 'Get started' }).click(); await page.getByRole('button', { name: /Skip and use the demo account/ }).click(); await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /empty workspace/ }).click(); await page.getByRole('button', { name: 'Continue' }).click(); await page.locator('.ob-body .switch').click(); await page.getByRole('button', { name: 'Open my workspace' }).click();
  await page.waitForSelector('.home'); await setSpeed(page, 'instant');
}
const buildTpl = async (page, id) => { await page.locator('[data-tpl="' + id + '"] .tpl-build').click(); for (let i = 0; i < 300; i++) { const a = await appState(page); if (a && (a.status === 'ready' || a.status === 'failed')) break; const o = page.locator('.gcard.ask .opt:not([disabled])'); if (await o.count()) await o.first().click().catch(() => {}); await sleep(120); } await waitReady(page); };
const land = async (page) => { await page.waitForSelector('.app-nav .nav-i'); await page.locator('.app-nav .nav-i').nth(1).click(); await sleep(80); }; // the Overview is first now, so the page that used to open first is the second one
const nav = (page, name) => page.locator('.app-nav .nav-i', { hasText: name }).first().click();
const vtab = async (page, name) => { await page.locator('.vswitch [role=tab]', { hasText: name }).click(); await sleep(90); };

async function quickStarts(browser, url) { // the two ways in from the first screen, for a judge who opens the URL cold
  for (const vp of [null, { width: 390, height: 844 }]) {
    const tag = vp ? 'phone: ' : '';
    const { ctx, page } = await newPage(browser, vp ? { viewport: vp } : undefined);
    await page.goto(url); await page.waitForSelector('#ob-sample', { timeout: 20000 });
    check(tag + 'first screen says what Turnkey does in one line and offers both quick starts', /turns one sentence into a working business app/.test(await page.locator('.ob-body .lead').innerText()) && await page.locator('#ob-own').isVisible());
    await page.click('#ob-sample');
    await page.waitForSelector('.tour-pop', { timeout: 8000 });
    const s = await st(page, () => { const F = window.__formwork, S = F.state(), t = (S.tabs[S.session] || []).find((x) => x.id === S.active[S.session]), a = t && t.app ? S.apps[t.app] : null; return { demo: S.settings.demo, tpl: a && a.tpl, status: a && a.status, steps: document.querySelector('.tour-pop').innerText }; });
    check(tag + 'Try a sample: the sales bidding desk is building in Demo within a second, with a short tour', s.demo && s.tpl === 'biddesk' && s.status === 'building' && /1 of 4/.test(s.steps), s);
    await shot(page, vp ? '00-phone-sample' : '00-sample');
    await ctx.close();
  }
  const { ctx, page } = await newPage(browser);
  await page.goto(url); await page.waitForSelector('#ob-own', { timeout: 20000 });
  await page.click('#ob-own'); await page.waitForSelector('#home-prompt'); await sleep(500);
  const h = await st(page, () => ({ focus: document.activeElement && document.activeElement.id, apps: Object.keys(window.__formwork.state().apps).length, tour: !!document.querySelector('.tour-pop') }));
  check('Describe your own: an empty workspace with the sentence box focused, no build and no tour', h.focus === 'home-prompt' && h.apps === 0 && !h.tour, h);
  await ctx.close();
}

async function flowDemo(browser, url) {
  await quickStarts(browser, url);
  const { ctx, page } = await newPage(browser);
  await page.goto(url); await page.waitForSelector('.ob-card', { timeout: 20000 });
  check('onboarding shows on first run', await page.locator('.ob-steps li').count() === 5);
  await shot(page, '01-onboarding');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: /Skip and use the demo account/ }).click();
  check('live choice is offered whenever the device is online, wherever the page runs', !(await page.locator('.choice').nth(1).isDisabled()) && /Model connected|No model connected|Checking the model/.test(await page.locator('.choice').nth(1).innerText()));
  await page.getByRole('button', { name: 'Continue' }).click();
  await shot(page, '02-onboarding-pick');
  await page.getByRole('button', { name: 'Continue' }).click();
  await setSpeed(page, 'fast');
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await page.waitForSelector('.tour-pop', { timeout: 8000 });
  await sleep(500); await shot(page, '03-tour-start');
  let n = 0; while (await page.locator('.tour-pop').count() && n++ < 20) { await page.locator('.tour-pop .btn.primary').click(); await sleep(450); if (n === 3) await shot(page, '04-tour-station'); }
  check('guided tour runs to the end', n >= 11 && !(await page.locator('.tour-pop').count()), n);
  await view(page, 'Build');
  await page.waitForSelector('.gcard.ask .opt:not([disabled])', { timeout: 40000 });
  await shot(page, '05-question');
  check('line pauses for the owner (needs you)', (await appState(page)).line.research === 'waiting');
  await page.locator('.gcard.ask .opt').first().click();
  await sleep(2500); await shot(page, '06-building');
  await waitReady(page);
  let a = await appState(page);
  check('clinic build is ready', a.status === 'ready' && a.name === 'CareDesk', a.status + ' ' + a.name + ' ' + JSON.stringify(a.last));
  check('every station checked', Object.values(a.line).every((x) => x === 'ok'), a.line);
  check('database was sent back once', a.retries[0] === 1, a.retries);
  check('3 tables, 8 screens', a.tables.length === 3 && a.screens.length === 8, [a.tables, a.screens]);
  check('acceptance test passed', a.tour.length === 7 && a.tour.every(Boolean), a.tour);
  // the agent activity panel: who worked, the hand-offs, the send-back, and the workflow they ran on
  await page.locator('.act-launch').click(); await page.waitForSelector('.act-panel .act-agent');
  await page.waitForSelector('.act-panel .act-usage'); await sleep(300);
  const spend = await st(page, () => { const u = document.querySelector('.act-panel .act-usage'); return { calls: u.dataset.calls, text: u.textContent }; });
  check('agent panel shows spend: today on the server, and nothing for a saved build', spend.calls === '0' && /Spent today/.test(spend.text) && /No model connected|of \$/.test(spend.text), spend);
  const act = await st(page, (aid) => ({ agents: [...document.querySelectorAll('.act-panel .act-agent')].map((x) => x.dataset.agent + ':' + x.dataset.state), kinds: [...document.querySelectorAll('.act-panel .act-item')].map((x) => x.dataset.kind), model: (({ items, agents }) => ({ handoffs: items.filter((i) => i.kind === 'handoff').map((i) => i.from + '>' + i.agent), back: agents.database.sentBack }))(window.__formwork.activity(aid)) }), a.id);
  check('agent panel lists every builder agent as done', act.agents.join(',') === 'researcher:done,database:done,backend:done,views:done,ui:done,tester:done', act.agents);
  check('agent panel shows the hand-offs in order and the send-back to the Database agent', act.model.handoffs.join(',') === 'researcher>database,database>backend,backend>views,views>ui,ui>tester' && act.model.back === 1 && act.kinds.includes('sent_back') && act.kinds.includes('tool_call') && act.kinds.includes('checks'), act.model);
  await shot(page, '07a-agent-activity');
  await page.locator('.act-panel [role=tab]', { hasText: 'Tool calls' }).click(); await page.locator('.act-panel .act-more').first().click();
  check('a tool call opens to show its input and result', (await page.locator('.act-panel pre').count()) >= 1 && (await page.locator('.act-panel .act-item').evaluateAll((l) => l.every((x) => x.dataset.kind === 'tool_call'))));
  await page.locator('.act-tab-how').click(); await page.waitForSelector('.act-how');
  const how = await st(page, () => [...document.querySelectorAll('.act-how .hiw-station')].map((x) => x.dataset.station + (x.dataset.state ? ':' + x.dataset.state : '')));
  check('"How it works" draws the workflow: you, seven stations, the app', how.join(',') === 'request,research:done,database:done,backend:done,views:done,screens:done,walkthrough:done,tests:done,app', how);
  await shot(page, '07b-how-it-works');
  await page.locator('.act-launch').click(); await page.waitForSelector('.act-panel', { state: 'detached' });
  await sleep(300); await shot(page, '07-built-line');
  await page.locator('.station').nth(1).click(); await page.getByRole('tab', { name: /^Attempts/ }).click(); await sleep(150); await shot(page, '08-attempts');
  await page.getByRole('button', { name: 'Timeline' }).click(); await sleep(150); await shot(page, '09-timeline');
  check('the timeline says a saved build replayed with no model calls and nothing spent', /no model calls, nothing spent/.test(await page.locator('.tl-usage').innerText()));
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();

  // the built app
  await view(page, 'App'); await page.waitForSelector('.login-card'); await shot(page, '10-app-login');
  await page.locator('.persona-btn').first().click(); await land(page); await page.waitForSelector('.kb-col');
  check('receptionist lands on the front desk board', await page.locator('.kb-col').count() === 6);
  await shot(page, '11-app-board');
  await page.locator('.kb-card').first().click(); await page.waitForSelector('.drawer'); await sleep(100); await shot(page, '12-app-drawer');
  await page.locator('.drawer-head .btn').click();
  await page.locator('.app-nav .nav-i', { hasText: 'Schedule' }).click(); await page.waitForSelector('.cal-grid'); await shot(page, '13-app-calendar');
  await page.locator('.app-nav .nav-i', { hasText: 'Patients' }).click(); await page.waitForSelector('.app .tbl tbody tr');
  check('patients list has 14 rows', await page.locator('.app .tbl tbody tr').count() === 14);
  await page.locator('.scr-head .btn.primary').click(); await page.waitForSelector('.app-dialog');
  await page.locator('.app-dialog button[type=submit]').click(); await sleep(100);
  check('required field is validated by the backend', await page.locator('.app-dialog .field-err').count() >= 1);
  await page.locator('.app-dialog input[type=text], .app-dialog input:not([type])').first().fill('Test Patient'); await page.locator('.app-dialog button[type=submit]').click(); await sleep(150);
  check('new patient was created', await page.locator('.drawer strong.t-sub2').innerText() === 'Test Patient');
  await page.locator('.app-nav .nav-i', { hasText: 'Book appointment' }).click(); await page.waitForSelector('.form-page'); await shot(page, '14-app-form');
  await page.selectOption('.stage-bar select', { index: 3 }); await sleep(150);
  check('every role lands on the Overview, the first page', (await page.locator('.app-nav .nav-i').first().innerText()).trim() === 'Overview' && await page.locator('.app-main .dash').count() === 1);
  await land(page);
  check('doctor sees only own day', (await page.locator('.scr-head .t-cap').innerText()).includes('only yours'));
  await shot(page, '15-app-doctor');
  await page.locator('.stage-bar .btn', { hasText: 'Two users' }).click(); await sleep(200);
  check('two users side by side', await page.locator('.device').count() === 2);
  await shot(page, '16-app-two-users');
  await page.locator('.stage-bar .btn', { hasText: 'Two users' }).click();
  await page.locator('.stage-bar .btn', { hasText: 'Play walkthrough' }).click(); await page.waitForSelector('.walk');
  await page.locator('.walk .btn.primary').click(); await sleep(150); await shot(page, '17-walk-step');
  await page.locator('.walk .btn.subtle', { hasText: 'Run all' }).click(); await sleep(200);
  check('walkthrough player passes 7 of 7', (await page.locator('.walk').innerText()).includes('7 of 7 steps passed'), await page.locator('.walk').innerText());
  await page.locator('.walk .btn.primary').click();
  await page.locator('.app-head .persona').first().click(); await page.locator('.menu .mi', { hasText: 'Imran' }).click(); await page.locator('.app-nav .nav-i', { hasText: 'Overview' }).click(); await page.waitForSelector('.kpis'); await sleep(100); await shot(page, '18-app-dashboard');

  // data, API, connections, debug
  await view(page, 'Data'); await page.waitForSelector('.split .side-i');
  check('five SQLite tables', await page.locator('.split .side-i').count() === 5);
  await shot(page, '19-data');
  await page.getByRole('tab', { name: 'SQL console' }).click(); await page.locator('.console .btn.primary').click(); await sleep(100);
  check('SQL console returns rows', await page.locator('.console .tbl tbody tr').count() === 3);
  const hid = await st(page, (aid) => { const F = window.__formwork, other = F.sql(aid, 'SELECT id FROM visit_notes WHERE doctor_id <> (SELECT MIN(id) FROM users WHERE role = ?) LIMIT 1', ['doctor'])[0].id, step = { role: 'doctor', do: 'denied', table: 'visit_notes', action: 'update' }; return { other: F.tourStep(aid, step, { visit_notes: other }), missing: F.tourStep(aid, step, { visit_notes: 9999 }) }; }, a.id);
  check('a test counts "not found" as refused when the record exists but is hidden from that person, and not when it is missing', hid.other.ok === true && /^404/.test(hid.other.detail) && hid.missing.ok === false, hid);
  await view(page, 'API'); await page.waitForSelector('.api-grid');
  await page.locator('.side-i', { hasText: '/visit_notes' }).nth(2).click(); await page.locator('.api-grid .btn.primary').click(); await sleep(100);
  check('receptionist is refused on POST /visit_notes', (await page.locator('.api-grid .badge').first().innerText()).trim() === '403', await page.locator('.api-grid .badge').first().innerText());
  await shot(page, '20-api');
  await page.getByRole('tab', { name: 'Permission matrix' }).click(); await sleep(100); await shot(page, '21-api-matrix');
  await view(page, 'Connections'); await page.waitForSelector('.conn-card');
  await page.route('**/api/connectors/**', (route) => route.fulfill({ json: { ok: true, items: [{ title: 'Appointment (scheduling)', url: 'https://en.wikipedia.org/wiki/Appointment', text: 'A made-up answer from the server route.', source: 'Wikipedia' }] } }));
  await page.locator('.conn-detail .btn', { hasText: 'Test' }).first().click(); await page.waitForSelector('.conn-detail .badge.b-success');
  check('connection test calls the source through the server route and shows its live answer', await page.locator('.conn-detail .json').count() === 1 && /Live response/.test(await page.locator('.conn-detail').innerText()) && /items \[1\]/.test(await page.locator('.conn-detail .json').innerText()), await page.locator('.conn-detail').innerText());
  await page.route('**/api/connectors/**', (route) => route.fulfill({ json: { ok: false, code: 'upstream', message: 'Wikipedia did not answer.' } }));
  await page.locator('.conn-detail .btn', { hasText: 'Test' }).first().click(); await page.waitForFunction(() => /did not answer/.test((document.querySelector('.conn-detail .json') || {}).innerText || ''));
  check('when the source fails, the test says why and shows the labelled sample beside it', /Sample response/.test(await page.locator('.conn-detail').innerText()), await page.locator('.conn-detail').innerText());
  await page.unroute('**/api/connectors/**');
  await shot(page, '22-connections');
  await page.locator('.titlebar .net').click(); await sleep(200);
  check('offline disables connection tests', await page.locator('.conn-detail .btn', { hasText: 'Test' }).first().isDisabled());
  await shot(page, '23-offline');
  await page.locator('.titlebar .net').click();
  await page.locator('.titlebar [data-tour=debug]').click(); await page.waitForSelector('.debug'); await sleep(150); await shot(page, '24-debug-events');
  for (const t of ['Tool calls', 'Model', 'SQL', 'API', 'State', 'Storage']) { await page.locator('.dbg-head').getByRole('tab', { name: new RegExp('^' + t) }).click(); await sleep(80); if (t === 'Tool calls') await shot(page, '25-debug-tools'); if (t === 'SQL') await shot(page, '26-debug-sql'); }
  check('debug drawer has rows', await page.locator('.dbg-body tr').count() > 2);
  await page.locator('.dbg-head .btn[aria-label="Close debug"]').click();

  // changes from chat
  await view(page, 'Build'); await setSpeed(page, 'instant');
  await say(page, 'Add an insurance provider field to patients'); await waitIdle(page); a = await appState(page);
  check('add field ran a migration', a.cols.patients.includes('insurance_provider') && a.mig === 1, [a.cols.patients, a.mig, a.last]);
  await sleep(100); await shot(page, '27-change-applied');
  const touch = await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]), a = s.apps[t.app]; return { col: a.touched && a.touched['col:patients.insurance_provider'], table: a.touched && a.touched['table:patients'], phone: a.touched && a.touched['col:patients.phone'] }; });
  check('who touched what: the new field is marked as the Database agent\'s change at your request, the fields from the build keep their maker', touch.col && touch.col.by === 'database' && touch.col.via === 'change' && touch.phone && touch.phone.by === 'database' && touch.phone.via === 'build', touch);
  await view(page, 'Data'); await page.locator('.split .side-i', { hasText: 'patients' }).first().click(); await page.getByRole('tab', { name: 'Columns' }).click(); await sleep(100);
  const head = await page.locator('.main-head .touch-note').innerText(), madeBy = await page.locator('.main-body tr', { hasText: 'insurance_provider' }).innerText();
  check('who touched what: the Data page says who made the table and who changed it last, and each field says who made it', /^Made by the Database agent/.test(head) && /Last change: changed by the Database agent at your request/.test(head) && /Database agent, your request/.test(madeBy), [head, madeBy]);
  await page.getByRole('tab', { name: 'Rows' }).click(); await view(page, 'Build');
  await say(page, 'Remove the front desk note field from patients'); await page.waitForSelector('.gcard.ask .btn.danger', { timeout: 8000 }); await shot(page, '28-approval');
  await page.locator('.gcard.ask .btn.danger').click(); await waitIdle(page); a = await appState(page);
  check('remove field needed approval and dropped the column', !a.cols.patients.includes('front_desk_note') && a.mig === 2, [a.cols.patients, a.mig]);
  await say(page, 'Add a board of appointments by room'); await waitIdle(page); a = await appState(page);
  check('add board view', a.screens.length === 9, a.screens);
  await say(page, 'Let doctors create appointments'); await waitIdle(page); a = await appState(page);
  check('permission change applied', a.access.appointments.doctor.create === true, a.last);
  await say(page, 'Let receptionists create visit notes'); await waitIdle(page); a = await appState(page);
  check('conflicting tour step is dropped with the permission change', a.access.visit_notes.receptionist.create === true && a.tourLen === 6 && a.tour.every(Boolean), [a.tourLen, a.tour, a.last]);
  await say(page, 'Stop receptionists from creating appointments'); await waitIdle(page); a = await appState(page);
  check('a change that breaks the walkthrough is rolled back', a.access.appointments.receptionist.create === true && a.runs[a.runs.length - 1] === 'change:failed', [a.runs, a.last]);
  await sleep(100); await shot(page, '29-rollback');
  await say(page, 'Remove the reason field from appointments'); await sleep(300); a = await appState(page);
  check('title field cannot be removed', /title, owner or status/.test(a.last.text), a.last.text);
  await say(page, 'Make it purple'); await waitIdle(page); await say(page, 'Use top navigation'); await waitIdle(page); await say(page, 'Rename the app to Sunrise Clinic'); await waitIdle(page); a = await appState(page);
  check('theme, navigation and name changed', a.accent === 'purple' && a.nav === 'top' && a.name === 'Sunrise Clinic', [a.accent, a.nav, a.name]);
  await say(page, 'make me a sandwich'); await sleep(300); a = await appState(page);
  check('unknown request gets the help reply', /Demo mode I understand/.test(a.last.text), a.last.text);
  await view(page, 'App'); await sleep(200); await shot(page, '30-app-after-changes');
  check('walkthrough still passes after the changes', a.tour.every(Boolean), a.tour);

  // reset data, sign out and in, reload
  await view(page, 'Data'); await page.locator('.side-foot .btn', { hasText: 'Reset data' }).click(); await page.locator('.dialog .btn.primary').click(); await sleep(400);
  const cnt = await page.locator('.side-i', { hasText: 'patients' }).locator('.t-cap').innerText();
  check('reset data restores 14 patients', cnt.trim() === '14', cnt);
  await page.locator('.titlebar .acct').click(); await page.locator('.menu .mi', { hasText: 'Sign out' }).click(); await page.waitForSelector('.signin');
  check('sign-in screen says the work is still here', (await page.locator('.signin').innerText()).includes('1 app'));
  await shot(page, '31-signin');
  await page.fill('#si-user', 'demo'); await page.fill('#si-pass', 'wrong'); await page.locator('.signin button[type=submit]').click(); await sleep(100);
  check('wrong password is refused', (await page.locator('.signin').innerText()).includes('Wrong username or password'));
  await page.fill('#si-pass', 'demo'); await page.locator('.signin button[type=submit]').click(); await page.waitForSelector('.work-head');
  await sleep(700); await page.reload(); await page.waitForSelector('.work-head', { timeout: 20000 });
  a = await appState(page);
  check('after reload: signed in, app and changes still there', a && a.name === 'Sunrise Clinic' && a.cols.patients.includes('insurance_provider'), a && a.name);
  await view(page, 'Data'); await page.waitForSelector('.split .side-i');
  const cnt2 = await page.locator('.side-i', { hasText: 'patients' }).locator('.t-cap').innerText();
  check('after reload: SQLite data came back from browser storage', cnt2.trim() === '14', cnt2);

  // more saved builds from the home page, run in parallel tabs
  await page.locator('.newtab').click(); await page.waitForSelector('.home'); await shot(page, '32-home');
  await page.fill('#home-prompt', 'something about spaceships'); await page.locator('.prompt .btn.primary').click(); await sleep(100);
  check('demo mode explains an unmatched sentence', await page.locator('.home .mbar').count() === 1);
  await page.fill('#home-prompt', 'employees request leave and managers approve'); await page.locator('.prompt .btn.primary').click();
  await page.waitForSelector('.gcard.ask .opt:not([disabled])', { timeout: 30000 }); await page.locator('.gcard.ask .opt').nth(1).click(); await waitReady(page); a = await appState(page);
  check('leave build ready, no send-backs, second answer applied', a.status === 'ready' && a.name === 'TimeOff' && a.retries[0] === 0 && a.tour.every(Boolean), [a.status, a.name, a.retries, a.tour, a.last]);
  await view(page, 'App'); await page.locator('.persona-btn').nth(4).click(); await land(page); await page.waitForSelector('.kb-col'); await shot(page, '33-leave-board');
  await page.locator('.app-nav .nav-i', { hasText: 'Team calendar' }).click(); await page.waitForSelector('.cal-grid'); await shot(page, '34-leave-calendar');
  await page.locator('.app-head .persona').first().click(); await page.locator('.menu .mi', { hasText: 'Fatima' }).click(); await nav(page, 'My balance'); await page.waitForSelector('.app .tbl tfoot');
  const bal = await st(page, () => ({ year: document.querySelector('.app .tbl tbody td:nth-child(2)').innerText.trim(), foot: [...document.querySelectorAll('.app .tbl tfoot td')].map((x) => x.innerText.trim()) }));
  check('a year reads as 2026, not 2,026, and the total row does not add years up', bal.year === '2026' && bal.foot[1] === '' && /^Total of 3$/.test(bal.foot[0]), bal);
  await page.locator('.newtab').click(); await page.waitForSelector('.home'); await page.locator('[data-tpl="helpdesk"] .tpl-build').click();
  await page.waitForSelector('.gcard.ask .opt:not([disabled])', { timeout: 30000 }); await page.locator('.gcard.ask .opt').first().click(); await waitReady(page); a = await appState(page);
  check('helpdesk build ready', a.status === 'ready' && a.name === 'DeskLine' && a.tour.length === 8 && a.tour.every(Boolean), [a.status, a.name, a.tour, a.last]);
  check('helpdesk: the View advisor was sent back once for a view that does not fit', a.retries[0] === 1 && a.attempts.views === 2, [a.retries, a.attempts]);
  await view(page, 'App'); await page.locator('.persona-btn').nth(4).click(); await land(page); await page.waitForSelector('.kb-col'); await sleep(100); await shot(page, '35-helpdesk-queue');
  await page.locator('.kb-card').first().click(); await page.waitForSelector('.drawer'); await page.locator('.drawer .btn', { hasText: 'Suggest docs' }).click(); await sleep(100);
  check('connector action shows sample results', await page.locator('.conn-out .rel-i').count() >= 1);
  await shot(page, '36-helpdesk-docs');
  check('three workspace tabs open', await page.locator('.wtab').count() === 3);

  // dark theme and a phone-width look
  await st(page, () => { document.documentElement.setAttribute('data-theme', 'dark'); }); await sleep(150); await shot(page, '37-dark-app');
  await view(page, 'Build'); await sleep(150); await shot(page, '38-dark-build');
  await st(page, () => { document.documentElement.removeAttribute('data-theme'); });
  await page.setViewportSize({ width: 400, height: 800 }); await sleep(300); await shot(page, '39-phone-build');
  check('phone: the builder swaps tabs and menus for a title bar and bottom navigation', await page.locator('.titlebar.phone').count() === 1 && await page.locator('.phone-nav .tab-i').count() === 5 && await page.locator('.tabstrip').count() === 0);
  await page.locator('.phone-nav .tab-i', { hasText: 'App' }).click(); await sleep(250); await shot(page, '40-phone-app');
  check('phone: the App tab is a launcher, not an app squeezed inside the builder', await page.locator('.launch .launch-hero').count() === 1 && await page.locator('.launch .app').count() === 0);
  await page.getByRole('button', { name: 'Open the app' }).click(); await page.waitForSelector('.solo .app'); if (await page.locator('.persona-btn').count()) await page.locator('.persona-btn').first().click(); await page.waitForSelector('.app-tabs'); await sleep(200); await shot(page, '40b-phone-app-full');
  const ph = await st(page, () => ({ builder: !!document.querySelector('.titlebar, .phone-nav, .work-head'), tabs: [...document.querySelectorAll('.app-tabs .tab-l')].map((x) => x.textContent), side: !!document.querySelector('.app-nav'), title: (document.querySelector('.app-name') || {}).textContent }));
  check('phone: the app opens full screen with its own bottom tabs, Overview first', !ph.builder && !ph.side && ph.tabs[0] === 'Overview' && ph.tabs.length >= 3 && ph.title === 'Overview', ph);
  const rowSel = '.kb-card, .tbl tr.clickable, .rcard, .cal-chip, .tree-leaf';
  for (let i = 1; i < ph.tabs.length; i++) { await page.locator('.app-tabs .tab-i').nth(i).click(); await sleep(250); if (await page.locator(rowSel).count()) break; }
  await page.locator(rowSel).first().click(); await page.waitForSelector('.drawer'); await sleep(250);
  const box = await page.locator('.drawer').boundingBox();
  check('phone: a record opens as a full page with a back button', box && box.width >= 398 && await page.getByRole('button', { name: 'Back' }).count() === 1, box);
  await page.getByRole('button', { name: 'Back' }).click(); await sleep(150);
  await page.locator('.app-head .persona').click(); await page.waitForSelector('.sheet'); await shot(page, '40c-phone-sheet');
  check('phone: people and account open as a bottom sheet', await page.locator('.sheet .sheet-i').count() >= 4);
  await page.locator('.sheet-i', { hasText: 'Back to Turnkey' }).click(); await page.waitForSelector('.phone-nav');
  const over = await st(page, () => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('no sideways page scroll at phone width', !over);
  await page.setViewportSize({ width: 1440, height: 900 });

  // erase everything
  await page.locator('.titlebar .acct').click(); await page.locator('.menu .mi', { hasText: 'Reset data' }).click(); await page.locator('.dialog .btn.danger').click(); await page.waitForSelector('.ob-card');
  const keys = await st(page, () => window.__turnkeyStorage.keys().length + Object.keys(localStorage).filter((k) => k.indexOf('formwork:') === 0).length);
  check('erase everything clears storage and returns to onboarding', keys === 0, keys);
  await ctx.close();
}

const GYM = {
  research: { name: 'FitTrack', summary: 'A gym tracks members, class bookings and trainers.', roles: [{ id: 'front_desk', name: 'Front desk', can: 'Registers members and books classes' }, { id: 'trainer', name: 'Trainer', can: 'Runs classes and marks attendance' }, { id: 'owner', name: 'Owner', can: 'Sees everything' }], entities: [{ name: 'members', what: 'People with a membership' }, { name: 'classes', what: 'Scheduled group sessions' }, { name: 'bookings', what: 'A place in a class' }], process: { entity: 'bookings', states: ['booked', 'attended', 'missed', 'cancelled'], note: 'Trainers mark attendance' }, stories: [{ role: 'front_desk', want: 'book a member into a class', so: 'the trainer expects them' }, { role: 'trainer', want: 'mark who attended', so: 'records are right' }, { role: 'owner', want: 'see attendance', so: 'I can plan' }], rules: ['Trainers see only their own bookings'], question: null },
  database: (bad) => ({ tables: [
    { name: 'members', label: 'Members', one: 'Member', title: 'full_name', owner: null, columns: [{ name: 'full_name', label: 'Full name', type: 'text', required: true }, { name: 'phone', type: 'string' }, { name: 'plan', type: 'select', options: ['Monthly', 'Annual'] }, { name: 'joined_on', type: 'date' }], rows: [{ full_name: 'Sam Hill', phone: '555-0101', plan: 'monthly', joined_on: -200 }, { full_name: 'Rita Mora', phone: '555-0102', plan: 'annual', joined_on: -90 }, { full_name: 'Jon Blake', plan: 'monthly', joined_on: -30 }] },
    { name: 'classes', label: 'Classes', one: 'Class', title: 'title', owner: 'trainer_id', columns: [{ name: 'title', type: 'text', required: true }, { name: 'trainer_id', type: 'user', role: 'trainer', required: true }, { name: 'starts_at', type: 'datetime', required: true }, { name: 'capacity', type: 'integer' }], rows: [{ title: 'Spin', trainer_id: 3, starts_at: '1 07:00', capacity: 12 }, { title: 'Yoga', trainer_id: 4, starts_at: '2 18:30', capacity: 16 }] },
    { name: 'bookings', label: 'Bookings', one: 'Booking', title: 'note', owner: 'trainer_id', columns: [{ name: 'member_id', type: 'ref', ref: 'members', required: true }, { name: 'class_id', type: 'ref', ref: bad ? 'sessions' : 'classes', required: true }, { name: 'trainer_id', type: 'user', role: 'trainer', required: true }, { name: 'status', type: 'select', options: ['booked', 'attended', 'missed', 'cancelled'], required: true }, { name: 'note', type: 'text' }], rows: [{ member_id: 1, class_id: 1, trainer_id: 3, status: 'booked', note: 'First class' }, { member_id: 2, class_id: 2, trainer_id: 4, status: 'attended', note: 'Regular' }, { member_id: 3, class_id: 1, trainer_id: 3, status: 'missed', note: '' }] }
  ], users: [{ name: 'Aisha Khan', role: 'front_desk' }, { name: 'Ben Carter', role: 'front_desk' }, { name: 'Tom Reid', role: 'trainer' }, { name: 'Lina Park', role: 'trainer' }, { name: 'Omar Aziz', role: 'owner' }] }),
  backend: { status: { table: 'bookings', column: 'status', states: [{ id: 'booked', label: 'Booked', tone: 'info' }, { id: 'attended', label: 'Attended', tone: 'success' }, { id: 'missed', label: 'Missed', tone: 'danger' }, { id: 'cancelled', label: 'Cancelled', tone: 'neutral' }], initial: 'booked', transitions: [{ id: 'attend', label: 'Mark attended', from: ['booked'], to: 'attended', roles: ['trainer'] }, { id: 'miss', label: 'Mark missed', from: ['booked'], to: 'missed', roles: ['trainer'] }, { id: 'cancel', label: 'Cancel', from: ['booked'], to: 'cancelled', roles: ['front_desk', 'owner'] }] },
    access: [{ table: 'members', role: 'front_desk', list: 'all', create: true, update: 'all', delete: false }, { table: 'members', role: 'trainer', list: 'all', create: false, update: 'none', delete: false }, { table: 'members', role: 'owner', list: 'all', create: true, update: 'all', delete: true }, { table: 'classes', role: 'front_desk', list: 'all', create: false, update: 'none', delete: false }, { table: 'classes', role: 'trainer', list: 'own', create: false, update: 'own', delete: false }, { table: 'classes', role: 'owner', list: 'all', create: true, update: 'all', delete: true }, { table: 'bookings', role: 'front_desk', list: 'all', create: true, update: 'all', delete: false }, { table: 'bookings', role: 'trainer', list: 'own', create: false, update: 'none', delete: false }, { table: 'bookings', role: 'owner', list: 'all', create: false, update: 'none', delete: true }] },
  screens: { theme: { accent: 'pumpkin', nav: 'top', icon: 'dumbbell' }, screens: [{ name: 'Bookings', type: 'board', table: 'bookings', roles: ['front_desk', 'owner'], group: 'status', columns: ['member_id', 'class_id', 'trainer_id'], label: 'member_id' }, { name: 'Book a class', type: 'form', table: 'bookings', roles: ['front_desk'] }, { name: 'Members', type: 'table', table: 'members', roles: ['front_desk', 'trainer', 'owner'], columns: ['full_name', 'phone', 'plan', 'joined_on'] }, { name: 'My bookings', type: 'table', table: 'bookings', roles: ['trainer'], columns: ['member_id', 'class_id', 'status'] }, { name: 'Timetable', type: 'calendar', table: 'classes', roles: ['front_desk', 'trainer', 'owner'], date: 'starts_at' }, { name: 'Overview', type: 'dashboard', table: 'bookings', roles: ['owner'], widgets: [{ kind: 'count', label: 'Bookings', table: 'bookings' }, { kind: 'by', label: 'By status', table: 'bookings', column: 'status' }, { kind: 'recent', label: 'Latest', table: 'bookings' }] }],
    tour: [{ role: 'front_desk', do: 'create', table: 'bookings', values: { member_id: 1, class_id: 1, trainer_id: 3, note: 'Walk-in' }, say: 'Aisha books Sam into Spin.' }, { role: 'trainer', do: 'see', table: 'bookings', say: 'Tom sees the booking.' }, { role: 'trainer', do: 'transition', table: 'bookings', transition: 'attend', say: 'Tom marks it attended.' }, { role: 'front_desk', do: 'denied', table: 'classes', action: 'create', say: 'Aisha cannot add a class.' }, { role: 'owner', do: 'open', screen: 'Overview', say: 'Omar opens the overview.' }] },
  views: { views: [{ table: 'bookings', use: [{ type: 'kanban', by: 'status', why: 'Bookings move through states.' }, 'table', { type: 'graph', x: 'status', split: 'trainer_id', why: 'Attendance per trainer.' }, { type: 'pivot', rows: 'trainer_id', cols: 'status' }] }, { table: 'classes', use: [{ type: 'calendar', date: 'starts_at' }, { type: 'timeline', start: 'starts_at', lane: 'trainer_id' }, { type: 'table' }] }, { table: 'members', use: [{ type: 'table' }, { type: 'cards' }, { type: 'chart', x: 'plan' }] }],
    dashboard: { title: 'Gym overview', date: { table: 'classes', column: 'starts_at' }, widgets: [{ kind: 'kpi', label: 'Bookings', table: 'bookings' }, { kind: 'kpi', label: 'Attended', table: 'bookings', where: { status: 'attended' } }, { kind: 'bar', label: 'Bookings by status', table: 'bookings', x: 'status' }, { kind: 'stack', label: 'Bookings per trainer', table: 'bookings', x: 'trainer_id', split: 'status' }, { kind: 'line', label: 'Classes per day', table: 'classes', x: 'starts_at' }, { kind: 'bar', label: 'Broken widget', table: 'bookings', x: 'no_such_column' }, { kind: 'recent', label: 'Latest', table: 'bookings' }] } },
  change: { reply: 'Adding it.', ops: [{ op: 'add_field', table: 'members', name: 'emergency_contact', label: 'Emergency contact', type: 'text' }] }
};
const TEAM_OUT = {
  Extractor: { say: 'Two claims found.', rows: [{ statement: 'The Pacific is the largest ocean', topic: 'geography' }, { statement: 'Our app has a million users', topic: 'not_a_topic' }] },
  Researchers: { say: 'Worked from what the model knows.', rows: [{ claim_id: 1, source: 'model_knowledge', title: 'Pacific Ocean', finding: 'It is the largest and deepest ocean.', stance: 'supports' }, { claim_id: 2, source: 'model_knowledge', title: 'No public source', finding: 'Nothing public backs the figure.', stance: 'neutral' }, { claim_id: 9, source: 'wikipedia', title: 'Points at a claim that does not exist', stance: 'neutral' }] },
  Verifier: { say: 'One holds, one cannot be checked.', update: [{ row: 1, verdict: 'supported', confidence: 96, reason: 'Well established.' }, { row: 2, verdict: 'unverifiable', confidence: 10, reason: 'No public source.' }], summary: { summary: 'One of two claims holds.', accuracy: 50, checked_on: '2026-11-17', status: 'published' } }
};
async function flowLive(browser, url) {
  const init = 'window.__GYM = ' + JSON.stringify({ research: GYM.research, db1: GYM.database(true), db2: GYM.database(false), backend: GYM.backend, views: GYM.views, screens: GYM.screens, change: GYM.change }) + ';\nwindow.__TEAM = ' + JSON.stringify(TEAM_OUT) + ';\n' + `
    window.__calls = [];
    window.claude = { use: async function (name) {
      if (name !== 'sample') return null;
      const fn = async function (input, opts) {
        const tm = /^You are (\\w+), one of/.exec(input); if (tm) { window.__calls.push('team:' + tm[1]); if (opts && opts.onText) opts.onText({ text: '{' }); await new Promise((r) => setTimeout(r, 60)); return { text: JSON.stringify(window.__TEAM[tm[1]] || { say: 'Nothing to add.' }), truncated: false }; }
        const who = /You are the ([\\w ]+?) agent/.exec(input)[1]; window.__calls.push(who); const G = window.__GYM; let out;
        if (opts && opts.onUsage) opts.onUsage({ model: 'claude-haiku-5-5', tier: 'quick', input: 400, output: 100, cacheRead: 1500, cacheWrite: 0, costUsd: 0.001, ms: 100, estimated: false });
        if (/STANDING INSTRUCTION FROM THE OWNER/.test(input)) (window.__noted = window.__noted || []).push(who + ': ' + input.split('STANDING INSTRUCTION FROM THE OWNER')[1].split('\\n')[1]);
        if (/reviewer$/.test(who)) { await new Promise((r) => setTimeout(r, 60)); return { text: JSON.stringify({ findings: window.__findings || [] }), truncated: false }; }
        if (window.__mode === 'deny') { const e = new Error('not granted'); e.code = 'not_granted'; throw e; }
        if (window.__mode === 'drop') { const e = new Error('the connection to the server was lost'); e.code = 'network'; throw e; }
        if (window.__mode === 'budget') { const e = new Error('used up'); e.code = 'budget'; throw e; }
        if (window.__mode === 'badjson' && who === 'Researcher') return { text: 'Sorry, I would rather chat about it.', truncated: false };
        if (who === 'Tester') { const sc = G.screens.screens.find((s) => s.roles && s.roles.length); return { text: JSON.stringify({ cases: [{ name: 'The first page opens for its role', why: 'Every role needs a way in.', steps: [{ role: sc.roles[0], do: 'open', screen: sc.name, say: 'Opens the page.' }] }, { name: 'Opening a page twice is safe', why: 'Reading changes nothing.', steps: [{ role: sc.roles[0], do: 'open', screen: sc.name }, { role: sc.roles[0], do: 'open', screen: sc.name }] }] }), truncated: false }; }
        if (who === 'Researcher') out = G.research;
        else if (who === 'Database') out = window.__mode === 'baddb' || window.__calls.filter((x) => x === 'Database').length === 1 ? G.db1 : G.db2;
        else if (who === 'Backend') out = window.__mode === 'badbackend' ? { status: { table: 'bookings', column: 'status', states: [{ id: 'booked' }], initial: 'booked', transitions: [] }, access: [] } : G.backend; else if (who === 'View advisor') out = window.__mode === 'badviews' ? { views: [{ table: 'members', use: [{ type: 'board' }, { type: 'gantt chart' }] }], dashboard: { widgets: [{ kind: 'pie' }] } } : G.views; else if (who === 'UI') out = G.screens; else out = G.change;
        const text = (who === 'Backend' ? 'Here is the JSON you asked for:\\n\\u0060\\u0060\\u0060json\\n' : '') + JSON.stringify(out) + (who === 'Backend' ? '\\n\\u0060\\u0060\\u0060' : '');
        if (opts && opts.onText) opts.onText({ text: text.slice(0, 40), delta: text.slice(0, 40) });
        await new Promise((r) => setTimeout(r, 120));
        return { text: text, truncated: false };
      };
      return fn;
    } };`;
  const { ctx, page } = await newPage(browser, { init });
  await page.goto(url); await page.waitForSelector('.ob-card');
  await page.getByRole('button', { name: 'Get started' }).click(); await page.getByRole('button', { name: /Skip and use the demo account/ }).click();
  await sleep(700);
  check('live choice is offered when the model is reachable', !(await page.locator('.choice').nth(1).isDisabled()));
  await page.locator('.choice').nth(1).click(); await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /empty workspace/ }).click(); await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.ob-body .switch').click(); await page.getByRole('button', { name: 'Open my workspace' }).click();
  await page.waitForSelector('.home'); await setSpeed(page, 'instant');
  await page.fill('#home-prompt', 'A gym tracks members, class bookings and trainers'); await page.locator('.prompt .btn.primary').click();
  await waitReady(page, 60000); const a = await appState(page);
  check('live build is ready from model output', a.status === 'ready' && a.name === 'FitTrack', [a.status, a.name, a.last]);
  check('live: database sent back once, then passed', a.retries[0] === 1 && Object.values(a.line).every((x) => x === 'ok'), [a.retries, a.line]);
  check('live: acceptance test passed', a.tour.length === 5 && a.tour.every(Boolean), a.tour);
  const calls = await st(page, () => window.__calls);
  check('live: one model call per agent plus one retry', calls.join(',') === 'Researcher,Database,Database,Backend,View advisor,UI,Tester', calls);
  const qaL = await appFull(page); check('live: the Tester\'s cases come from the model, are run with the generated tests, and all pass', qaL.qa && qaL.qa.by === 'model' && qaL.cases === 2 && JSON.stringify(qaL.qa.rounds) === '[[0,0]]' && qaL.tests.failed === 0, [qaL.qa, qaL.cases, qaL.tests]);
  check('live: the View advisor\'s plan was normalised (aliases mapped, broken widget left out, dashboard for every role)', a.views.bookings.includes('board') && a.views.bookings.includes('chart') && a.views.classes.includes('timeline') && a.widgets === 6 && a.dashRoles === 3, [a.views, a.widgets, a.dashRoles, a.attempts]);
  await page.getByRole('button', { name: 'Timeline' }).click(); await page.waitForSelector('.tl-usage');
  const tlu = await st(page, () => { const u = document.querySelector('.tl-usage'); return { calls: u.dataset.calls, cost: u.dataset.cost, text: u.textContent, db: [...document.querySelectorAll('.tl-row')].map((r) => r.querySelector('.tl-cost')?.textContent || '').join('|') }; });
  check('live: the timeline shows the cost, tokens and cache hits the server reported for every model call, and each agent\'s cost', tlu.calls === '7' && tlu.cost === '0.007000' && /7 model calls · 14k tokens · 79% from cache · \$0\.007/.test(tlu.text) && tlu.db.split('|')[2] === '$0.002', tlu);
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();
  await sleep(200); await shot(page, '50-live-built');
  await view(page, 'App'); await page.locator('.persona-btn').first().click(); await land(page); await page.waitForSelector('.kb-col'); await shot(page, '51-live-app');
  await view(page, 'Build'); await say(page, 'Members need an emergency contact'); await waitIdle(page); const b = await appState(page);
  check('live: chat change through the model ran a migration', b.cols.members.includes('emergency_contact') && b.mig === 1, [b.cols.members, b.last]);
  // Live: a review step is one model call; a fix the built-in reader understands is tried out, and applying it costs no further call
  await st(page, () => { window.__calls = []; window.__findings = [{ level: 'low', text: 'One for your judgement only.', why: '', fix: null }, { level: 'high', text: 'Members has nowhere to note a locker.', why: 'People will ask at the desk.', fix: 'Add a locker number field to members.' }, { level: 'medium', text: 'A fix only the model can read.', why: '', fix: 'Give trainers a nicer overview of their week' }]; });
  await say(page, 'Add a security review'); let L1 = await waitFree(page);
  check('live: a review step added in chat is one model call, and its findings are the model\'s, ranked', L1.reviews.security && L1.reviews.security.by === 'model' && (await st(page, () => window.__calls)).join() === 'Security reviewer' && L1.reviews.security.f.map((x) => String(x.test)).join() === 'pass,unknown,null' && L1.reviews.security.f[0].fix === 'Add a locker number field to members', [L1.reviews, await st(page, () => window.__calls)]);
  await page.locator('.gcard .finding .btn.primary').first().click(); L1 = await waitFree(page);
  check('live: applying a tried-out fix runs exactly what was tested, with no further model call', L1.reviews.security.f[0].state === 'applied' && L1.cols.members.includes('locker_number') && (await st(page, () => window.__calls)).join() === 'Security reviewer' && L1.run.kind === 'change' && L1.run.status === 'ok', [L1.cols.members, await st(page, () => window.__calls), L1.run]);
  // Live: a standing instruction reaches the agent, and a run from a later station calls the model for those stations only
  await say(page, 'Tell the UI agent to keep page names to two words'); await sleep(300); L1 = await appFull(page);
  check('live: an instruction for an agent of a model-built app queues a run from that agent\'s station', L1.flow.notes.ui === 'Keep page names to two words' && !/takes effect in Live builds/.test(L1.chat[L1.chat.length - 1].text) && /Screens and Walkthrough run again in \d s/.test(await page.locator('.gcard').last().innerText()), [L1.flow, L1.chat]);
  await st(page, () => { window.__calls = []; window.__noted = []; }); const keepL = L1; await page.locator('.gcard .rerun-wait .btn', { hasText: 'Run now' }).last().click(); L1 = (await drive(page)).a;
  check('live: running again from Screens makes one model call, carries the instruction, and keeps the four stations before it', L1.status === 'ready' && L1.run.kind === 'rerun' && L1.run.status === 'ok' && (await st(page, () => window.__calls)).join() === 'UI,Tester' && (await st(page, () => window.__noted)).join() === 'UI: Keep page names to two words' && ['research', 'database', 'backend', 'views'].every((k) => L1.line[k].note === 'Kept') && L1.rows === keepL.rows && L1.cols.members.includes('locker_number') && L1.tests.failed === 0, [L1.status, L1.run, await st(page, () => window.__calls), await st(page, () => window.__noted), L1.line]);
  await page.locator('.titlebar .net').click(); await sleep(250); const pm = await st(page, () => { const m = window.__formwork.wf.mode(), sw = document.getElementById('sw-live'); return [m.id, sw.checked, sw.disabled]; }); await page.locator('.titlebar .net').click(); await sleep(250); const bm = await st(page, () => { const m = window.__formwork.wf.mode(), sw = document.getElementById('sw-live'); return [m.id, sw.checked, sw.disabled]; });
  check('live: with a model connected, Live still pauses with the connection and comes back with it', pm.join() === 'offline,false,true' && bm.join() === 'live,true,false', [pm, bm]);
  await page.locator('.titlebar [data-tour=debug]').click(); await page.locator('.dbg-head').getByRole('tab', { name: /^Model/ }).click(); await sleep(100); await shot(page, '52-live-debug-model');
  await page.locator('.dbg-head .btn[aria-label="Close debug"]').click();
  const build = async (mode, text) => { await st(page, (m) => { window.__mode = m; window.__calls = []; }, mode); await page.locator('.newtab').click(); await page.waitForSelector('.home'); await page.fill('#home-prompt', text); await page.locator('.prompt .btn.primary').click(); await waitReady(page, 60000); return appState(page); };
  let c = await build('badbackend', 'A gym with a stubborn backend agent');
  const fell = await st(page, () => { const s = window.__formwork.state(); return Object.values(s.apps).map((a) => [a.name, !!a.line.backend.fellBack, !!a.line.walkthrough.fellBack]); });
  check('live: an agent that keeps failing falls back to the safe default and the build still finishes', c.status === 'ready' && fell.some((f) => f[1] && f[2]), [c.status, fell, c.last]);
  c = await build('badviews', 'A gym whose view advisor recommends views that do not fit');
  check('live: on the last attempt code keeps the views that fit and fills the gaps by rule', c.status === 'ready' && c.attempts.views === 3 && Object.values(c.views).every((v) => v.length >= 2) && !c.views.members.includes('gantt chart') && c.widgets >= 3, [c.status, c.attempts, c.views, c.widgets, c.last]);
  c = await build('baddb', 'A gym whose database agent never fixes its link');
  check('live: on the last attempt code repairs the schema and the build finishes', c.status === 'ready' && c.retries[0] >= 2 && !c.cols.bookings.includes('class_id') && c.tour.every(Boolean), [c.status, c.retries, c.cols.bookings, c.last]);
  c = await build('badjson', 'A gym where the researcher will not answer in JSON');
  check('live: unusable researcher output fails the build cleanly', c.status === 'failed' && c.line.research === 'failed' && c.last.card && c.last.card.type === 'error', [c.status, c.line, c.last]);
  await shot(page, '53-live-failed');
  await page.locator('.titlebar .net').click(); await page.locator('.newtab').click(); await page.waitForSelector('.home'); await page.fill('#home-prompt', 'anything'); await page.locator('.prompt .btn.primary').click(); await sleep(200);
  check('live: offline blocks a live build', await page.locator('.wtab').count() === 6 && (await page.locator('.toast').allInnerTexts()).join(' ').includes('offline'), await page.locator('.toast').allInnerTexts());
  await page.locator('.titlebar .net').click();
  // an app's own agents in Live: the team runs on the server (/api/agent/team, stood in for here with the same AG-UI
  // events it streams), and the browser writes each agent's answer through the app's API, turning row numbers into ids
  const teamRuns = [];
  await page.route('**/api/agent/team', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}'), agents = (body.team && body.team.agents) || [], runId = body.runId || 'run';
    teamRuns.push(agents.map((a) => 'team:' + a.name).join(','));
    const ev = [{ type: 'RUN_STARTED', threadId: runId, runId }];
    for (const a of agents) {
      const out = Object.assign({ rows: [], update: [], summary: null }, TEAM_OUT[a.name] || { say: 'Nothing to add.' });
      ev.push({ type: 'STEP_STARTED', stepName: a.id }, { type: 'CUSTOM', name: 'check', value: { agent: a.id, ok: true, sentBack: false, by: 'rules' } });
      // the researchers' lookup finds Wikipedia down: the server says so in the tool result, and the run carries on
      if (a.id === 'researchers') ev.push({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'wikipedia.page_summary' }, { type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"title":"Pacific Ocean"}' }, { type: 'TOOL_CALL_END', toolCallId: 'tc1' }, { type: 'TOOL_CALL_RESULT', messageId: 'mt1', toolCallId: 'tc1', role: 'tool', content: JSON.stringify({ agent: a.id, ok: false, unavailable: true, text: 'SOURCE UNAVAILABLE: Wikipedia cannot be used right now.' }) });
      ev.push({ type: 'TEXT_MESSAGE_START', messageId: 'm_' + a.id, role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm_' + a.id, delta: out.say }, { type: 'TEXT_MESSAGE_END', messageId: 'm_' + a.id });
      ev.push({ type: 'STATE_DELTA', delta: [{ op: 'add', path: '/outputs/' + a.id, value: out }] }, { type: 'STEP_FINISHED', stepName: a.id });
    }
    ev.push({ type: 'RUN_FINISHED', threadId: runId, runId, result: { status: 'done' } });
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ev.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') });
  });
  await st(page, () => { window.__mode = ''; window.__calls = []; }); await page.locator('.newtab').click(); await page.waitForSelector('.home'); await page.locator('[data-tpl="factcheck"] .tpl-build').click(); await waitReady(page, 60000);
  await st(page, () => { window.__formwork.view().calls = 0; }); await view(page, 'App'); await page.locator('.persona-btn').first().click(); await land(page); await page.waitForSelector('.team');
  await page.fill('#tm0_title', 'Launch note'); await page.fill('#tm0_text', 'The Pacific is the largest ocean. Our app has a million users.'); await page.locator('.team-start button[type=submit]').click(); await waitTeam(page);
  const tr = await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]), T = window.__formwork.teams()[t.app]; return { status: T.status, live: T.live, steps: T.steps.map((x) => [x.status, x.rows.length, x.updated, x.problems.length]), made: Object.keys(T.made).map((k) => k + ':' + T.made[k].length).join(','), error: T.error }; });
  check('live team: one server run of three agents, rows written through the API, a bad row refused without stopping the run', tr.status === 'done' && tr.live && JSON.stringify(tr.steps) === '[["ok",2,0,0],["ok",2,0,1],["ok",0,3,0]]' && tr.made === 'claims:2,evidence:2' && teamRuns.join('|') === 'team:Extractor,team:Researchers,team:Verifier' && !(await st(page, () => window.__calls)).some((x) => x.startsWith('team:')), [tr, teamRuns, await st(page, () => window.__calls)]);
  check('live team: a public source that is down is said plainly, once, and the run still finishes', tr.status === 'done' && (await page.locator('.toasts').innerText()).split('Wikipedia is not answering right now').length === 2, await page.locator('.toasts').innerText());
  check('live team: the agent could not set the status itself, the workflow did', (await page.locator('.team-log .badge').first().innerText()).trim() === 'Checked', await page.locator('.team-log .badge').first().innerText());
  await shot(page, '54-live-team');
  await st(page, () => { window.__formwork.view().calls = 0; }); // this flow now makes more model calls than one session's cap allows, so start the count again for the last case
  c = await build('drop', 'A gym whose connection drops halfway');
  check('live: a connection lost during a call fails the run and says what to do', c.status === 'failed' && JSON.stringify(c.last || '').includes('could not reach its server'), [c.status, c.last]);
  c = await build('budget', 'A gym built after the allowance ran out');
  check("live: a spent daily allowance says so, and that saved builds still work", c.status === 'failed' && JSON.stringify(c.last || '').includes('allowance') && JSON.stringify(c.last || '').includes('Saved builds'), [c.status, c.last]);
  c = await build('deny', 'A gym nobody granted access to');
  check('live: a refused permission stops the run and switches Live off', c.status === 'failed' && (await st(page, () => window.__formwork.view().live)) === 'none', [c.status, c.last]);
  check('live: the failed run says plainly that no model is connected', JSON.stringify(c.last || '').includes('No model is connected'), c.last);
  await ctx.close();
  await liveOnStepAgent(browser, url);
}
// Live without a stand-in on the page: every prompt goes to the server's step agent over AG-UI. The agent's stream is
// scripted here (the test server has no model), so this proves the browser side: events in, answer out, steps on the timeline.
async function liveOnStepAgent(browser, url) {
  const { ctx, page } = await newPage(browser);
  const seen = [];
  await page.route('**/api/health', (route) => route.fulfill({ json: { ok: true, live: true, provider: 'scripted' } }));
  await page.route('**/api/copilotkit/agent/step/run', async (route) => {
    const body = route.request().postDataJSON(), prompt = body.forwardedProps.prompt, who = (/^You are the ([\w ]+?) agent/.exec(prompt) || [])[1] || 'other';
    seen.push(who + ':' + body.forwardedProps.maxAttempts);
    let out;
    if (who === 'Tester') { const sc = GYM.screens.screens.find((x) => x.roles && x.roles.length); out = { cases: [{ name: 'The first page opens for its role', why: 'Every role needs a way in.', steps: [{ role: sc.roles[0], do: 'open', screen: sc.name }] }] }; }
    else out = { Researcher: GYM.research, Database: GYM.database(false), Backend: GYM.backend, 'View advisor': GYM.views, UI: GYM.screens }[who] || { findings: [] };
    const text = JSON.stringify(out), id = 'draft-1', ev = [
      { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
      { type: 'STEP_STARTED', stepName: 'guard' }, { type: 'STEP_FINISHED', stepName: 'guard' },
      { type: 'STEP_STARTED', stepName: 'draft' }, { type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: text.slice(0, 50) }, { type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: text.slice(50) },
      { type: 'TEXT_MESSAGE_END', messageId: id }, { type: 'STEP_FINISHED', stepName: 'draft' },
      { type: 'STEP_STARTED', stepName: 'validate' }, { type: 'STEP_FINISHED', stepName: 'validate' },
      { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId, result: { text, role: 'any', attempts: 1, repaired: false, truncated: false } }];
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: ev.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') });
  });
  await page.goto(url); await page.waitForSelector('.ob-card');
  await page.getByRole('button', { name: 'Get started' }).click(); await page.getByRole('button', { name: /Skip and use the demo account/ }).click();
  await page.waitForFunction(() => window.__formwork.view().live === 'ready');
  await page.locator('.choice').nth(1).click(); await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /empty workspace/ }).click(); await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.ob-body .switch').click(); await page.getByRole('button', { name: 'Open my workspace' }).click();
  await page.waitForSelector('.home'); await setSpeed(page, 'instant');
  await page.fill('#home-prompt', 'A gym tracks members, class bookings and trainers'); await page.locator('.prompt .btn.primary').click();
  await waitReady(page, 60000); const a = await appState(page);
  const steps = await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]), A = s.apps[t.app], r = A.runs[A.runs.length - 1]; return r.steps.filter((x) => x.station === 'database').map((x) => x.label + ':' + x.ok); });
  check('live on the step agent: the build is ready, with one server run per agent and one model call each', a.status === 'ready' && a.name === 'FitTrack' && seen.join(',') === 'Researcher:1,Database:1,Backend:1,View advisor:1,UI:1,Tester:1', [a.status, a.name, seen, a.last]);
  check('live on the step agent: the server\'s draft and format check show on the timeline inside the station\'s model call', steps.join(',') === 'Model call:true,Draft:true,Format check:true,Checks:true', steps);
  await ctx.close();
}
async function flowMisc(browser, url) {
  const { ctx, page } = await newPage(browser, { scheme: 'dark' });
  await page.goto(url); await page.waitForSelector('.ob-card'); await shot(page, '60-dark-onboarding');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.fill('#ob-name', 'Muhammad Ismaeel'); await page.fill('#ob-user', 'Ismaeel'); await page.fill('#ob-pass', 'abc'); await page.getByRole('button', { name: 'Continue' }).click(); await sleep(80);
  check('short password is refused', (await page.locator('.ob-body').innerText()).includes('at least 4'));
  await page.fill('#ob-pass', 'secret12'); await page.getByRole('button', { name: 'Continue' }).click(); await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /empty workspace/ }).click(); await page.getByRole('button', { name: 'Continue' }).click(); await page.locator('.ob-body .switch').click(); await page.getByRole('button', { name: 'Open my workspace' }).click();
  await page.waitForSelector('.home'); await setSpeed(page, 'instant');
  check('home greets the account by name', (await page.locator('.home h1').innerText()).includes('Muhammad'));
  await page.locator('[data-tpl="clinic"] .tpl-build').click(); await page.waitForSelector('.gcard.ask .opt:not([disabled])', { timeout: 30000 }); await page.locator('.gcard.ask .opt').nth(1).click(); await waitReady(page);
  let a = await appState(page);
  check('second answer lets the front desk read visit notes', a.access.visit_notes.receptionist.list === 'all' && a.tour.every(Boolean), a.access.visit_notes);
  // the canvas fits itself a moment after it changes; if it is hidden by then (0 pixels wide), it must not be drawn at NaN
  const nan = []; const onNan = (m) => { if (/NaN/.test(m.text())) nan.push(m.text().slice(0, 120)); }; page.on('console', onNan);
  await view(page, 'Build'); await page.waitForSelector('.flow-canvas .react-flow__node'); await sleep(800);
  await page.evaluate(async () => { document.querySelector('button[title="Put every node back where it started"]').click(); await new Promise((r) => setTimeout(r, 20)); const el = document.createElement('style'); el.id = 'tk-hide-canvas'; el.textContent = '.flow-canvas{display:none !important}'; document.head.appendChild(el); });
  await sleep(1200); await page.evaluate(() => document.getElementById('tk-hide-canvas').remove()); await sleep(600); page.off('console', onNan);
  check('the workflow canvas hidden just after a change is not drawn at NaN, and shows its nodes again', nan.length === 0 && await page.locator('.flow-canvas .react-flow__node').first().isVisible(), nan.slice(0, 3));
  await page.getByRole('button', { name: 'Log', exact: true }).click(); await sleep(100); check('log view lists steps', await page.locator('.line-wrap .tbl tbody tr').count() > 8); await shot(page, '61-log');
  for (let i = 0; i < 4; i++) { await page.getByRole('button', { name: 'Workflow', exact: true }).click(); await page.locator('.station').nth(i).click(); await sleep(60); if (i === 1) { await page.locator('.insp-body .switch').click(); await sleep(60); await shot(page, '62-schema-sql'); } if (i === 2) await shot(page, '63-backend-out'); }
  // dialogs
  await page.locator('.work-head .menu-wrap .btn').click(); await page.locator('.menu .mi', { hasText: 'Export build pack' }).click(); await page.waitForSelector('.dialog .pack');
  const pack = await page.locator('.dialog .pack').innerText();
  check('build pack has SQL, endpoints, the view plan, the dashboard and the acceptance test', /CREATE TABLE "appointments"/.test(pack) && /\/api\/appointments\/:id\/check_in/.test(pack) && /PASS/.test(pack) && /Views per table/.test(pack) && /Dashboard: Overview/.test(pack) && /Timeline/.test(pack), pack.slice(0, 200));
  await shot(page, '64-pack'); await page.locator('.dialog .dhead .btn').click();
  await page.locator('.work-head .menu-wrap .btn').click(); await page.locator('.menu .mi', { hasText: 'Rename app' }).click(); await page.fill('#rn-name', 'North Clinic'); await page.locator('.dialog button[type=submit]').click(); await waitIdle(page);
  check('rename dialog runs as a change', (await appState(page)).name === 'North Clinic');
  await page.locator('.titlebar .acct').click(); await page.locator('.menu .mi', { hasText: 'Settings' }).click(); await page.waitForSelector('.set-list'); await shot(page, '65-settings');
  await page.locator('.set-row .seg button', { hasText: 'Light' }).click(); await sleep(80);
  check('theme setting overrides the system theme', await st(page, () => document.documentElement.getAttribute('data-app-theme')) === 'light');
  await page.locator('.dialog .dfoot .btn.primary').click();
  await page.locator('.titlebar .btn', { hasText: 'Install' }).click(); await page.waitForSelector('.install-app'); await shot(page, '66-install'); await page.locator('.dialog .dfoot .btn.primary').click(); await sleep(80);
  check('install flow marks the app as installed', await st(page, () => window.__formwork.state().settings.installed) === true);
  await page.locator('.titlebar .menu-wrap .btn[aria-label=Help]').click(); await page.locator('.menu .mi', { hasText: 'What is real' }).click(); await page.waitForSelector('.about'); await shot(page, '67-about'); await page.locator('.dialog .dfoot .btn.primary').click();
  await view(page, 'Connections'); await page.locator('.connv .btn.primary').click(); await page.fill('#ac-name', 'Our CRM'); await page.fill('#ac-url', 'https://crm.example.com/mcp'); await page.locator('.dialog button[type=submit]').click(); await sleep(100);
  check('custom connection is added', await page.locator('.conn-card').count() === 7, await page.locator('.conn-card').count());
  // app details: sort, filter, search, related, calendar add, form screen, board drag
  await view(page, 'App'); await page.locator('.persona-btn').nth(2).click(); await land(page); await page.waitForSelector('.app .tbl');
  await page.locator('.app-nav .nav-i', { hasText: 'Patients' }).click(); await page.locator('.th-btn').first().click(); await sleep(60);
  check('sorting by name works', (await page.locator('.app .tbl tbody tr td').first().innerText()).trim() === 'Adeel Rashid', await page.locator('.app .tbl tbody tr td').first().innerText());
  await page.fill('.search input', 'khad'); await sleep(80); check('search narrows the list', await page.locator('.app .tbl tbody tr').count() === 1);
  await page.fill('.search input', ''); await page.locator('.vx-bar .btn', { hasText: 'Filter' }).click(); await page.locator('.fbox select').nth(0).selectOption('gender'); await page.locator('.fbox select').nth(2).selectOption('male'); await page.locator('.fbox button[type=submit]').click(); await sleep(80);
  check('the filter builder narrows the list and shows a chip', await page.locator('.app .tbl tbody tr').count() === 7 && (await page.locator('.vx .chips .chip').first().innerText()).includes('Gender is Male'), await page.locator('.app .tbl tbody tr').count());
  await page.locator('.vx .chips .btn', { hasText: 'Clear all' }).click();
  await page.locator('.app-nav .nav-i', { hasText: 'My schedule' }).click(); await page.waitForSelector('.cal-chip'); await page.locator('.cal-chip').first().click(); await page.waitForSelector('.drawer');
  check('record drawer lists related visit notes', (await page.locator('.drawer').innerText()).includes('Visit notes ('));
  await shot(page, '68-drawer-related');
  await page.selectOption('.stage-bar select', { index: 1 }); await sleep(100);
  await page.locator('.app-nav .nav-i', { hasText: 'Book appointment' }).click(); await page.waitForSelector('.form-page');
  await page.locator('.form-page select').nth(0).selectOption({ index: 2 }); await page.locator('.form-page select').nth(1).selectOption({ index: 1 }); await page.locator('.form-page input[type=datetime-local]').fill('2026-11-18T10:15'); await page.locator('.form-page input[type=text]').fill('Walk-in consultation'); await page.locator('.form-page button[type=submit]').click(); await sleep(120);
  check('form screen creates a record', (await page.locator('.form-page').innerText()).includes('was created'), await page.locator('.form-page').innerText());
  await page.locator('.app-nav .nav-i', { hasText: 'Front desk' }).click(); await page.waitForSelector('.kb-card');
  const before = await page.locator('.kb-col').nth(1).locator('.kb-card').count();
  await page.locator('.kb-col').nth(0).locator('.kb-card').first().dragTo(page.locator('.kb-col').nth(1)); await sleep(200);
  check('dragging a card runs the workflow action', await page.locator('.kb-col').nth(1).locator('.kb-card').count() === before + 1, [before, await page.locator('.kb-col').nth(1).locator('.kb-card').count()]);
  await page.locator('.kb-col').nth(1).locator('.kb-card').first().dragTo(page.locator('.kb-col').nth(3)); await sleep(200);
  check('a move the role may not make is refused', (await page.locator('.toast').allInnerTexts()).join(' ').includes('cannot move'), await page.locator('.toast').allInnerTexts());
  await view(page, 'API'); await page.locator('.side-i', { hasText: '/patients' }).nth(2).click(); await page.locator('.api-grid .btn.primary').click(); await sleep(100);
  check('API view can create a patient', (await page.locator('.api-grid .badge').first().innerText()).trim() === '201', await page.locator('.api-grid .badge').first().innerText());
  await view(page, 'Data'); await page.getByRole('tab', { name: 'Columns' }).click(); await sleep(50); await page.getByRole('tab', { name: 'CREATE TABLE' }).click(); await sleep(50);
  check('CREATE TABLE is shown from sqlite_master', (await page.locator('.main-body .code').innerText()).includes('CREATE TABLE'));
  // files: export the app's database, import it back, back up the workspace and restore it
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tk-files-')), acts = () => st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); return window.__formwork.dbCount(t.app, 'activity'); });
  const n0 = await acts(); const [sq] = await Promise.all([page.waitForEvent('download'), page.locator('.side-foot .btn', { hasText: 'Export .sqlite' }).click()]); const sqPath = path.join(tmp, sq.suggestedFilename()); await sq.saveAs(sqPath);
  check('Export .sqlite downloads the app as a SQLite file', /\.sqlite$/.test(sqPath) && fs.readFileSync(sqPath).subarray(0, 15).toString() === 'SQLite format 3', sq.suggestedFilename());
  await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); window.__formwork.sql(t.app, "INSERT INTO \"activity\" (\"at\", \"table_name\", \"action\") VALUES ('2026-11-26', 'patients', 'test')"); });
  const fc1 = page.waitForEvent('filechooser'); await page.locator('.side-foot .btn', { hasText: 'Import .sqlite' }).click(); await (await fc1).setFiles(sqPath); await page.locator('.dialog .dfoot .btn.danger', { hasText: 'Import' }).click(); await sleep(200);
  check('Import .sqlite puts the exported file back', await acts() === n0 && (await page.locator('.toast').allInnerTexts()).join(' ').includes('Imported'), [n0, await acts()]);
  const fc2 = page.waitForEvent('filechooser'); await page.locator('.side-foot .btn', { hasText: 'Import .sqlite' }).click(); await (await fc2).setFiles({ name: 'notes.sqlite', mimeType: 'application/octet-stream', buffer: Buffer.from('not a database at all') }); await page.locator('.dialog .dfoot .btn.danger', { hasText: 'Import' }).click(); await sleep(200);
  check('a file that is not a database is refused and the data stays', await acts() === n0 && (await page.locator('.toast').allInnerTexts()).join(' ').includes('not a SQLite database'), await page.locator('.toast').allInnerTexts());
  await page.locator('.titlebar .acct').click(); await page.locator('.menu .mi', { hasText: 'Reset data' }).click(); await page.waitForSelector('.dialog .set-list');
  const [bk] = await Promise.all([page.waitForEvent('download'), page.locator('.dialog .set-row .btn', { hasText: 'Back up' }).click()]); const bkPath = path.join(tmp, bk.suggestedFilename()); await bk.saveAs(bkPath);
  const bkj = JSON.parse(fs.readFileSync(bkPath, 'utf8'));
  check('Back up workspace saves state and every database as JSON', bkj.f === 'turnkey-backup' && !!bkj.items.state && Object.keys(bkj.items).some((k) => k.indexOf('db:') === 0), Object.keys(bkj.items));
  await page.locator('.dialog .set-row .btn', { hasText: 'Delete apps' }).click(); await page.waitForSelector('.home');
  await page.locator('.titlebar .acct').click(); await page.locator('.menu .mi', { hasText: 'Reset data' }).click(); await page.waitForSelector('.dialog .set-list');
  const fc3 = page.waitForEvent('filechooser'); await page.locator('.dialog .set-row .btn', { hasText: 'Restore' }).first().click(); await (await fc3).setFiles(bkPath);
  await Promise.all([page.waitForEvent('load'), page.locator('.dialog .dfoot .btn.danger', { hasText: 'Restore' }).click()]); await page.waitForSelector('.work-head', { timeout: 20000 }); await view(page, 'Data'); await sleep(200);
  const rs = await st(page, () => ({ apps: Object.values(window.__formwork.state().apps).map((x) => x.name), mode: window.__turnkeyStorage && window.__turnkeyStorage.mode }));
  check('Restore brings back the apps and their data after a reload', rs.apps.includes('North Clinic') && await acts() === n0 && rs.mode === 'indexeddb', [rs, n0]);
  await page.reload(); await page.waitForSelector('.work-head', { timeout: 20000 }); await view(page, 'Data');
  check('a reload keeps everything (IndexedDB)', (await appState(page)).name === 'North Clinic' && await acts() === n0);
  // stop and run again, then a reload in the middle of a build
  await setSpeed(page, 'normal'); await page.locator('.newtab').click(); await page.waitForSelector('.home'); await page.locator('[data-tpl="leave"] .tpl-build').click(); await sleep(1500);
  await page.locator('.build-bar .btn', { hasText: 'Stop' }).click(); await sleep(400); let b = await appState(page);
  check('stop halts the run', b.status === 'stopped' && b.runs[0] === 'build:stopped', [b.status, b.runs]);
  await setSpeed(page, 'instant'); await page.locator('.build-bar .btn', { hasText: 'Run again' }).click(); await page.waitForSelector('.gcard.ask .opt:not([disabled])', { timeout: 20000 }); await page.locator('.gcard.ask .opt:not([disabled])').first().click(); await waitReady(page); b = await appState(page);
  check('run again finishes the build', b.status === 'ready' && b.name === 'TimeOff', [b.status, b.name]);
  await setSpeed(page, 'normal'); await page.locator('.newtab').click(); await page.waitForSelector('.home'); await page.locator('[data-tpl="helpdesk"] .tpl-build').click(); await sleep(1500); await page.reload(); await page.waitForSelector('.work-head', { timeout: 20000 }); b = await appState(page);
  check('a reload during a build leaves a clear, restartable state', b.status === 'stopped' && /reloaded/.test(b.last.text), [b.status, b.last && b.last.text]);
  const sizes = await st(page, () => { let n = 0, per = {}; const all = window.__turnkeyStorage.entries(); Object.keys(all).forEach((k) => { n += all[k].length; per[k] = all[k].length; }); return { total: n, per }; });
  console.log('STORAGE:', JSON.stringify(sizes.total));
  await ctx.close();
  // a view where browser storage is blocked (like an embedded preview): everything still works, in memory
  const blocked = await newPage(browser, { init: "Storage.prototype.setItem = function () { throw new Error('storage disabled'); }; Object.defineProperty(window, 'indexedDB', { get() { return undefined; } });" });
  const p2 = blocked.page; await p2.goto(url); await p2.waitForSelector('.ob-card');
  await p2.getByRole('button', { name: 'Get started' }).click(); await p2.getByRole('button', { name: /Skip and use the demo account/ }).click(); await p2.getByRole('button', { name: 'Continue' }).click(); await p2.getByRole('button', { name: 'Continue' }).click();
  await setSpeed(p2, 'instant'); await p2.locator('.ob-body .switch').click(); await p2.getByRole('button', { name: 'Open my workspace' }).click();
  await p2.waitForSelector('.gcard.ask .opt:not([disabled])', { timeout: 20000 }); await p2.locator('.gcard.ask .opt').first().click(); await waitReady(p2); const m = await appState(p2);
  check('without browser storage the app still builds and says nothing will be kept', m.status === 'ready' && (await p2.locator('.mbar.bar').first().innerText()).includes('not available'), m.status);
  await blocked.ctx.close();
  // storage that fills up: the next save is refused, a banner and a toast say so plainly, and both go once saving works again
  const full = await newPage(browser, { init: "window.__turnkeyOptions = { storage: 'localstorage' };" });
  const p3 = full.page; await enter(p3, url);
  await st(p3, () => { window.__realSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); }; });
  await p3.locator('.newtab').click();
  const fullBar = await p3.waitForSelector('.storage-problem', { timeout: 10000 }).then(() => true, () => false);
  check('a full browser storage shows a plain banner and a toast with a way forward', fullBar && (await p3.locator('.storage-problem').innerText()).includes('storage is full') && (await p3.locator('.toasts').innerText()).includes('Delete an app'), fullBar);
  await st(p3, () => { Storage.prototype.setItem = window.__realSetItem; });
  await p3.locator('.newtab').click();
  check('the storage banner goes once saving works again', await p3.waitForSelector('.storage-problem', { state: 'detached', timeout: 10000 }).then(() => true, () => false));
  await full.ctx.close();
  // the SQLite engine cannot be downloaded: the start screen says why and offers a reload, never a blank page
  const noSql = await newPage(browser);
  await noSql.ctx.route('**/vendor/sql-wasm.js*', (route) => route.abort());
  await noSql.page.goto(url);
  const sqlMsg = await noSql.page.waitForSelector('.splash[role=alert]', { timeout: 20000 }).then((el) => el.innerText(), () => '');
  check('when the SQLite engine does not load, the page says so and offers a reload', /could not start/.test(sqlMsg) && /check the connection/.test(sqlMsg) && (await noSql.page.getByRole('button', { name: 'Reload the page' }).count()) === 1, sqlMsg);
  errors.splice(0, errors.length, ...errors.filter((e) => !/sql-wasm|SQLite engine|Failed to load resource|ERR_FAILED/i.test(e)));
  await noSql.ctx.close();
  await canvasFieldEdits(browser, url);
}

async function canvasFieldEdits(browser, url) { // the owner edits fields on the Data page itself; only the touched stations run again
  const { ctx, page } = await newPage(browser); await enter(page, url); await buildTpl(page, 'clinic');
  await view(page, 'Data'); await page.locator('.split .side-i', { hasText: 'patients' }).first().click(); await page.getByRole('tab', { name: 'Columns' }).click();
  await page.waitForSelector('.field-edit'); await shot(page, '64-field-editor');
  await page.getByLabel('New field name').fill('Allergies'); await page.getByLabel('New field type').selectOption('longtext');
  await page.locator('.field-edit .btn', { hasText: 'Add field' }).click(); await waitIdle(page);
  let a = await appState(page);
  const touch = await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); const a = s.apps[t.app]; return { ...a.touched['col:patients.allergies'], said: a.chat.some((m) => m.from === 'user' && /On the Data page: Add Allergies/.test(m.text)) }; });
  check('an edit on the Data page adds the field with a migration, is written to the chat as yours, and re-runs only from the Database station', a.cols.patients.includes('allergies') && a.mig === 1 && a.line.database === 'ok' && touch.said && touch.by === 'database' && touch.via === 'change', [a.cols.patients, a.mig, a.line, touch]);
  const plan = await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); const c = s.apps[t.app].chat.filter((m) => m.card && m.card.type === 'plan').pop(); return c && c.card; });
  check('the Data page edit shows the same plan card as a chat change: Research is kept', plan && plan.skip.includes('Research') && plan.rerun[0] === 'Database', plan);
  check('the Columns tab lists the new field with who made it', /allergies[\s\S]*your request/i.test(await page.locator('.main-body tr', { hasText: 'allergies' }).innerText()));
  await page.getByLabel('Field to change').selectOption('allergies'); await page.getByLabel('New name for the field').fill('Known allergies');
  await page.locator('.field-edit .btn', { hasText: 'Rename' }).click(); await waitIdle(page); a = await appState(page);
  check('renaming a field on the Data page renames the column', a.cols.patients.includes('known_allergies') && !a.cols.patients.includes('allergies') && a.mig === 2, a.cols.patients);
  await page.getByLabel('Field to change').selectOption('front_desk_note'); await page.locator('.field-edit .btn', { hasText: 'Remove' }).click();
  await page.waitForSelector('.gcard.ask .btn.danger', { timeout: 8000 });
  check('removing a field with stored values asks first, and the editor waits', await page.locator('.field-edit .btn', { hasText: 'Add field' }).isDisabled());
  await page.locator('.gcard.ask .btn.danger').click(); await waitIdle(page); a = await appState(page);
  check('after a yes, the field is dropped', !a.cols.patients.includes('front_desk_note') && a.mig === 3, a.cols.patients);
  await page.getByLabel('New field name').fill('phone'); await page.locator('.field-edit .btn', { hasText: 'Add field' }).click(); await sleep(200);
  check('a field that already exists is refused on the page with the reason, and nothing runs', /already has a phone field/i.test(await page.locator('.field-edit').innerText()) && (await appState(page)).mig === 3);
  await ctx.close();
}
async function flowViews(browser, url) {
  const { ctx, page } = await newPage(browser);
  await enter(page, url); await shot(page, '70-home-library');
  check('home lists three quests and six business apps', await page.locator('.tpl').count() === 9 && await page.locator('.tpl .badge', { hasText: /^Quest/ }).count() === 3);
  await page.locator('[data-tpl="clinic"] .tpl-build').click(); await page.waitForSelector('.gcard.ask .opt:not([disabled])', { timeout: 30000 }); await page.locator('.gcard.ask .opt').first().click(); await waitReady(page);
  let a = await appState(page);
  check('six stations, and the Views station passed', Object.keys(a.line).length === 6 && a.line.views === 'ok', a.line);
  check('the View advisor recommended views for every table and a dashboard for every role', a.views.appointments.length === 7 && a.views.patients.length === 3 && a.views.visit_notes.length === 5 && a.widgets === 9 && a.dashRoles === 3, [a.views, a.widgets, a.dashRoles]);
  await page.locator('.station').nth(3).click(); await sleep(120); await shot(page, '71-views-station');
  check('the inspector shows which views fit each table', await page.locator('.viewplan tbody tr').count() === 3 && await page.locator('.viewplan .badge.b-success').count() === 15, await page.locator('.viewplan .badge.b-success').count());
  await view(page, 'App'); await page.locator('.persona-btn').nth(5).click(); await land(page); await page.waitForSelector('.kb-col'); await nav(page, 'Schedule'); await page.waitForSelector('.cal-grid');
  const tabs = (await page.locator('.vswitch [role=tab]').allInnerTexts()).map((x) => x.trim());
  check('the switcher offers the seven recommended views', tabs.join(',') === 'Board,Calendar,Timeline,Table,Chart,Pivot,Tree', tabs);
  const expect = { Board: '.kb-col', Calendar: '.cal-grid .cal-chip', Timeline: '.gt .gt-item', Table: '.vx .tbl tbody tr', Chart: '.hb-row .hb-seg', Pivot: '.tbl.pivot .pv-b', Tree: '.tree .tree-row' }, drawn = {};
  for (const name of tabs) { await vtab(page, name); drawn[name] = await page.locator(expect[name]).count(); await shot(page, '72-view-' + name.toLowerCase()); }
  check('every view draws the same 39 appointments', Object.values(drawn).every((n) => n > 0) && drawn.Board === 6, drawn);
  // table: paging, grouping
  await vtab(page, 'Table');
  check('table pages at 25 rows', await page.locator('.vx .tbl tbody tr').count() === 25 && (await page.locator('.pager').innerText()).includes('Page 1 of 2'));
  await page.locator('.pager .btn').nth(1).click(); await sleep(60); check('second page has the other 14', await page.locator('.vx .tbl tbody tr').count() === 14);
  await page.locator('.vopts .pick select').first().selectOption('doctor_id'); await sleep(80);
  check('grouping by doctor gives three groups with counts', await page.locator('.vx .tbl tr.grp').count() === 3 && (await page.locator('.vx .tbl tr.grp').first().innerText()).includes('13'), await page.locator('.vx .tbl tr.grp').first().innerText());
  await page.locator('.grp-b').first().click(); await sleep(60); check('a group collapses', await page.locator('.vx .tbl tbody tr.clickable').count() === 26);
  await page.locator('.vopts .pick select').first().selectOption('');
  // chart: drill into the records behind a mark, then a time series with a hover tip
  await vtab(page, 'Chart'); const seg = page.locator('.hb-seg').first(), lab = await seg.getAttribute('aria-label'), want = parseInt(lab.split(': ')[1], 10);
  await seg.hover(); await sleep(80); check('a bar shows a hover tip with the value first', (await page.locator('.ctip strong').first().innerText()).trim() === String(want), await page.locator('.ctip').innerText().catch(() => 'none'));
  check('two or more series get a legend', await page.locator('.lg .lg-i').count() === 3);
  await seg.click(); await sleep(100);
  check('selecting a mark opens the records behind it', await page.locator('.vx .tbl tbody tr').count() === want && await page.locator('.vx .chips .chip').count() === 2, [lab, await page.locator('.vx .tbl tbody tr').count()]);
  await shot(page, '73-drill'); await page.locator('.vx .chips .btn', { hasText: 'Clear all' }).click();
  await vtab(page, 'Chart'); await page.locator('.vopts .pick select').nth(1).selectOption('starts_at'); await sleep(100);
  check('a date on the axis turns the chart into a time series', await page.locator('svg.plot path').count() >= 3 && await page.locator('svg.plot .hit').count() === 12, [await page.locator('svg.plot path').count(), await page.locator('svg.plot .hit').count()]);
  await page.locator('svg.plot .hit').nth(5).hover(); await sleep(80); check('the time series has a crosshair tip', await page.locator('.ctip').count() === 1 && await page.locator('svg.plot .cross').count() === 1);
  await shot(page, '74-timeseries');
  await page.locator('.vopts .seg button', { hasText: 'Columns' }).click(); await sleep(80); check('columns stack the split', await page.locator('svg.plot path').count() > 12);
  await page.locator('.vopts .switch').click(); await sleep(60); check('the data table is one click away', await page.locator('.tbl.compact tbody tr').count() === 12);
  await page.locator('.vopts .pick select').nth(1).selectOption('status');
  // pivot, calendar, timeline, tree
  await vtab(page, 'Pivot'); const cell = page.locator('.pv-b').first(), cv = parseInt(await cell.innerText(), 10);
  check('pivot totals add up', (await page.locator('.tbl.pivot tfoot td').last().innerText()).trim() === '39');
  await cell.click(); await sleep(100); check('a pivot cell opens its records', await page.locator('.vx .tbl tbody tr').count() === cv && await page.locator('.vx .chips .chip').count() === 2, cv);
  await page.locator('.vx .chips .btn', { hasText: 'Clear all' }).click();
  await vtab(page, 'Calendar'); await page.locator('.vopts .seg button', { hasText: 'Week' }).click(); await sleep(80); check('calendar has a week span', await page.locator('.cal-grid.wk .cal-day').count() === 7);
  await page.locator('.vopts .seg button', { hasText: 'Month' }).click();
  await vtab(page, 'Timeline'); const lanes = await page.locator('.gt-lane').count(); await page.locator('.vopts .seg button', { hasText: 'Quarter' }).click(); await sleep(80);
  check('timeline has a lane per doctor and zooms', lanes === 3 && await page.locator('.gt-item').count() === 39, [lanes, await page.locator('.gt-item').count()]);
  await vtab(page, 'Tree'); const rows0 = await page.locator('.tree-row').count(); await page.locator('.tree-tog').first().click(); await sleep(60);
  check('tree groups collapse', await page.locator('.tree-row').count() < rows0, [rows0, await page.locator('.tree-row').count()]);
  // a view the advisor did not recommend, and one that cannot fit
  await nav(page, 'Patients'); await vtab(page, 'Cards'); check('cards view shows every patient', await page.locator('.rcard').count() === 14);
  await page.locator('.vswitch .menu-wrap > button').click(); await sleep(60);
  check('other views say whether they fit', (await page.locator('.vswitch .menu .mi', { hasText: 'Pivot' }).innerText()).includes('does not fit') && await page.locator('.vswitch .menu .mi', { hasText: 'Pivot' }).isDisabled());
  await page.locator('.vswitch .menu .mi', { hasText: 'Board' }).click(); await sleep(80); check('a fitting view that was not recommended still works', await page.locator('.kb-col').count() === 3);
  // dashboard
  await nav(page, 'Overview'); await page.waitForSelector('.kpis'); await sleep(100); await shot(page, '75-dashboard');
  const kv = async () => (await page.locator('.kpi-v').allInnerTexts()).map((x) => x.trim());
  check('dashboard has four numbers and five widgets', (await kv()).join(',') === '39,13,2,14' && await page.locator('.dash-grid .widget').count() === 5, await kv());
  await page.locator('.dash-bar .seg button', { hasText: 'Past 7 days' }).click(); await sleep(80); const k7 = await kv();
  check('the date range filters everything on its table', +k7[0] < 39 && +k7[0] > 0 && k7[3] === '14', k7);
  await page.locator('.dash-bar .seg button', { hasText: 'All time' }).click();
  await page.locator('.dash .hb-seg').first().click(); await sleep(100);
  check('selecting a bar filters the dashboard and keeps the other bars', (await kv())[0] === '17' && await page.locator('.dash-bar .chip').count() === 1 && await page.locator('.dash-grid .widget').first().locator('.hb-row.dim').count() === 5, [await kv(), await page.locator('.dash-grid .widget').first().locator('.hb-row').count()]);
  await shot(page, '76-dashboard-filtered'); await page.locator('.dash-bar .chip-x').click(); await sleep(60);
  await page.locator('.kpi').nth(2).click(); await sleep(100);
  check('a number opens its records', await page.locator('.vx .tbl tbody tr').count() === 2 && (await page.locator('.vx .chips').innerText()).includes('No-show'), await page.locator('.vx .chips').innerText().catch(() => ''));
  await nav(page, 'Overview'); await page.locator('.dash-grid .widget').nth(1).locator('.btn.icon').click(); await sleep(100); check('a widget opens in the chart view', await page.locator('.vswitch .vs-b.on').innerText() === 'Chart' && await page.locator('.lg .lg-i').count() >= 4);
  await page.selectOption('.stage-bar select', { index: 3 }); await sleep(120); await nav(page, 'Overview'); await page.waitForSelector('.kpis');
  check('a doctor\'s dashboard counts only the rows that doctor may see', (await kv())[0] === '13', await kv());
  // changes from chat that touch views
  await view(page, 'Build'); await say(page, 'Add a timeline of visit notes'); await waitIdle(page); a = await appState(page);
  check('chat adds a page in a recommended view', a.screens.length === 9 && a.screens.includes('Visit notes timeline'), a.screens);
  await say(page, 'Add a chart of patients by gender to the dashboard'); await waitIdle(page); a = await appState(page);
  check('chat adds a chart to the dashboard, and only Views onward re-ran', a.widgets === 10 && a.last.card && a.last.card.reran.join(',') === 'Views,Screens,Walkthrough', [a.widgets, a.last]);
  await say(page, 'Add a pivot of patients'); await sleep(300); a = await appState(page);
  check('a view that does not fit is refused with the reason', /needs two category fields/.test(a.last.text), a.last.text);
  await say(page, 'Add a board of patients by gender'); await waitIdle(page); a = await appState(page);
  check('a view the advisor had not recommended is added to the plan first', a.views.patients.includes('board') && a.screens.length === 10, [a.views.patients, a.screens]);
  await say(page, 'Use rail navigation'); await waitIdle(page); a = await appState(page); await view(page, 'App'); await sleep(150);
  check('chat switches the layout to an icon rail', a.nav === 'rail' && await page.locator('.app-nav.rail .nav-i').count() >= 4, a.nav); await shot(page, '77-rail');
  // an app saved by the earlier version: no view plan, no dashboard for everyone
  await sleep(800);
  await st(page, async () => { const T = window.__turnkeyStorage, s = JSON.parse(T.get('state')); Object.values(s.apps).forEach((x) => { delete x.def.views; delete x.def.dash; delete x.def.team; delete x.line.views; delete x.def.theme.density; x.def.screens = x.def.screens.filter((y) => y.type !== 'dashboard'); }); T.set('state', JSON.stringify(s)); await T.flush(); });
  await page.reload(); await page.waitForSelector('.work-head', { timeout: 20000 }); a = await appState(page);
  check('an app saved by the earlier version gets views and a dashboard on load', a.line.views === 'ok' && a.views.appointments.length >= 5 && a.widgets >= 4 && a.dashRoles === 3, [a.line, a.views, a.widgets, a.dashRoles]);
  await view(page, 'App'); await page.selectOption('.stage-bar select', { index: 1 }); await sleep(100); await nav(page, 'Dashboard'); await page.waitForSelector('.kpis'); check('the migrated dashboard draws', await page.locator('.kpi').count() >= 3);
  await page.selectOption('.stage-bar select', { index: 6 }); await sleep(100); await nav(page, 'Schedule'); await sleep(100);
  check('after a reload the page opens in the view this person left it in', (await page.locator('.vswitch .vs-b.on').innerText()).trim() === 'Tree', await page.locator('.vswitch .vs-b.on').innerText());
  // the library: duplicate with data
  await page.locator('.brand').click(); await page.waitForSelector('.home');
  check('the built app is in the library', await page.locator('.app-row').count() === 1 && await page.locator('[data-tpl="clinic"] .badge.b-success').count() === 1);
  await page.locator('.app-row .btn[aria-label^="Duplicate"]').click(); await sleep(200);
  check('duplicate adds a second saved app', await page.locator('.app-row').count() === 2 && (await page.locator('.app-row strong').first().innerText()).includes('copy'), await page.locator('.app-row strong').allInnerTexts());
  await shot(page, '78-library'); await page.locator('.app-open').first().click(); await page.waitForSelector('.work-head'); await view(page, 'Data'); await page.waitForSelector('.split .side-i');
  check('the copy has its own SQLite file with the same rows', (await page.locator('.side-i', { hasText: 'patients' }).locator('.t-cap').innerText()).trim() === '14');
  await ctx.close();
}
async function flowQuests(browser, url) {
  const { ctx, page } = await newPage(browser);
  await enter(page, url);
  await page.locator('[data-tour="quests"] .btn').click();
  await page.waitForFunction(() => { const s = window.__formwork.state(), apps = Object.values(s.apps); return apps.length === 3 && apps.every((x) => x.status === 'ready' || x.status === 'failed'); }, null, { timeout: 90000 }); await sleep(300);
  const all = await st(page, () => Object.values(window.__formwork.state().apps).map((x) => ({ tpl: x.tpl, name: x.name, status: x.status, team: x.def.team ? x.def.team.agents.map((y) => y.name).join('>') : '', nav: x.def.theme.nav, tour: x.line.walkthrough.results.every((r) => r.ok), views: Object.values(x.def.views).reduce((n, v) => n + v.length, 0), agents: x.def.screens.filter((y) => y.type === 'agents').length })).sort((p, q) => p.tpl.localeCompare(q.tpl)));
  check('build all three: three separate apps, each with its own team of three agents', all.length === 3 && all.every((x) => x.status === 'ready' && x.tour && x.agents === 1) && all.map((x) => x.team).join(' | ') === 'For>Against>Moderator | Extractor>Researchers>Verifier | Search>Analyst>Critic', all);
  check('each quest app has its own layout', all.map((x) => x.nav).join(',') === 'top,side,rail', all.map((x) => x.nav));
  check('three workspace tabs, one per app', await page.locator('.wtab').count() === 3);
  const open = async (name) => { await page.locator('.wtab', { hasText: name }).click(); await page.waitForSelector('.work-head'); await view(page, 'App'); await sleep(100); if (await page.locator('.persona-btn').count()) await page.locator('.persona-btn').first().click(); await land(page); await page.waitForSelector('.team'); };
  // quest 1: fact-check desk
  await open('Fact Desk'); await shot(page, '80-factcheck-console');
  check('the console shows the three agents and their connections', await page.locator('.team-a').count() === 3 && (await page.locator('.team-flow').innerText()).includes('World Bank Open Data'));
  await page.fill('#tm0_title', 'My own text'); await page.fill('#tm0_text', 'Cats can fly.'); await sleep(60);
  check('Demo explains that it replays saved runs', (await page.locator('.team-start .mbar').innerText()).includes('Demo replays saved runs'));
  await page.locator('.team-start .chip', { hasText: 'Company blog draft' }).click(); await sleep(60); await page.locator('.team-start button[type=submit]').click(); await waitTeam(page); let T = await teamNow(page);
  check('fact-check run: three agents finish, three claims, three pieces of evidence, three verdicts', T.status === 'done' && T.steps.join(',') === 'ok,ok,ok' && T.rows.join(',') === '3,3,0' && T.updated[2] === 4 && T.tools[1] === 3, T);
  await sleep(150); await shot(page, '81-factcheck-run');
  check('the check moved through the workflow and has a summary', (await page.locator('.team-log .badge').first().innerText()).trim() === 'Checked' && (await page.locator('.team-done').innerText()).includes('Two of three claims hold'));
  const ev = await st(page, () => { const L = window.__formwork.logs; return { steps: L.EV.filter((e) => e.type === 'STEP_STARTED' && ['extractor', 'researchers', 'verifier'].includes(e.agent)).length, tools: L.TOOLCALLS.filter((x) => x.agent === 'researchers' && x.kind === 'connector').length, api: L.APILOG.filter((x) => x.src === 'team').length }; });
  check('the run is visible as AG-UI events, connector calls and API calls', ev.steps === 3 && ev.tools === 3 && ev.api >= 11, ev);
  await page.locator('.act-launch').click(); await page.waitForSelector('.act-panel .act-agent');
  const tact = await st(page, () => ({ agents: [...document.querySelectorAll('.act-panel .act-agent')].map((x) => x.dataset.agent + ':' + x.dataset.state).filter((x) => /^(extractor|researchers|verifier):/.test(x)), tools: [...document.querySelectorAll('.act-panel .act-item[data-kind=tool_call]')].filter((x) => x.dataset.agent === 'researchers').length }));
  check('agent panel shows the app team at work: three agents done, the researchers\' connector calls', tact.agents.join(',') === 'extractor:done,researchers:done,verifier:done' && tact.tools >= 3, tact);
  await page.locator('.act-tab-how').click(); await page.waitForSelector('.act-how .hiw-team');
  check('"How it works" shows the app\'s own team and the sources it calls', await page.locator('.act-how .hiw-team').count() === 3 && (await page.locator('.act-how').innerText()).includes('worldbank'));
  await shot(page, '81a-team-activity');
  await page.locator('.act-launch').click(); await page.waitForSelector('.act-panel', { state: 'detached' });
  await page.locator('.team-done .btn', { hasText: 'See the claims' }).click(); await sleep(120);
  check('"See the claims" opens them filtered to this check', await page.locator('.vx .tbl tbody tr').count() === 3 && (await page.locator('.vx .tbl').innerText()).includes('Unverifiable'), await page.locator('.vx .tbl tbody tr').count());
  await vtab(page, 'Board'); check('claims as a board by verdict', await page.locator('.kb-col').count() === 5); await vtab(page, 'Tree'); check('claims as a tree', await page.locator('.tree-row').count() >= 2); await shot(page, '82-factcheck-tree');
  await nav(page, 'Evidence'); await sleep(100); check('evidence opens as a tree under its claims', await page.locator('.tree .tree-row').count() >= 12, await page.locator('.tree .tree-row').count());
  await nav(page, 'Desk overview'); await page.waitForSelector('.kpis'); check('the quest app has a dashboard', (await page.locator('.kpi-v').first().innerText()).trim() === '5' && await page.locator('.dash-grid .widget').count() === 5, await page.locator('.kpi-v').allInnerTexts()); await shot(page, '83-factcheck-dashboard');
  await nav(page, 'Check room'); await page.locator('.team .rel .btn', { hasText: 'Run' }).first().click(); await waitTeam(page); T = await teamNow(page);
  check('a queued check can be run from the list', T.status === 'done' && T.rows.join(',') === '3,3,0', T);
  await page.locator('.titlebar .net').click(); await sleep(100); await page.locator('.team-start .chip', { hasText: 'Travel article' }).click(); await sleep(60);
  check('offline: a team that needs connections cannot start', (await page.locator('.team-start .mbar').innerText()).includes('offline'));
  await page.locator('.titlebar .net').click(); await sleep(60);
  await page.selectOption('.stage-bar select', { index: 4 }); await sleep(120);
  check('a reader has no Agents page', await page.locator('.app-nav .nav-i', { hasText: 'Check room' }).count() === 0 && await page.locator('.app-nav .nav-i').count() === 4, await page.locator('.app-nav .nav-i').allInnerTexts());
  await view(page, 'Build'); await page.locator('.station').nth(2).click(); await sleep(100); check('the Backend station shows the team it wrote', (await page.locator('.insp-body').innerText()).includes('Fact-check team')); await shot(page, '84-team-in-backend');
  // quest 3: debate partner, with a person jumping in
  await open('Second Opinion'); await page.locator('.team-start .chip', { hasText: 'One codebase first' }).click(); await sleep(60); await page.locator('.team-start button[type=submit]').click();
  await page.waitForSelector('.team-log .gcard.ask', { timeout: 20000 }); T = await teamNow(page);
  check('the debate pauses before the Moderator for a person', T.wait && T.steps.join(',') === 'ok,ok,idle', T); await shot(page, '85-debate-pause');
  await page.fill('.team-log .gcard.ask input', 'We have no on-call rota yet'); await page.locator('.team-log .gcard.ask .btn', { hasText: 'Add' }).click(); await sleep(100);
  await page.locator('.team-log .gcard.ask .btn.primary').click(); await waitTeam(page); T = await teamNow(page);
  check('the person\'s point is recorded and the Moderator sums up', T.status === 'done' && T.notes === 1 && T.rows.join(',') === '3,3,5', T);
  await sleep(120); await shot(page, '86-debate-done');
  await nav(page, 'Takeaways'); await sleep(100); check('the takeaways include the point from the floor', (await page.locator('.cards').innerText()).includes('From the floor: We have no on-call rota yet'));
  await nav(page, 'Arguments'); await sleep(100); check('arguments open as a tree of points and replies', await page.locator('.tree .tree-tog').count() >= 5 && (await page.locator('.tree').innerText()).includes('Against')); await shot(page, '87-debate-tree');
  // quest 2: prior-art scout
  await open('Prior Art Scout'); await shot(page, '88-priorart-console');
  await page.locator('.team-start .chip', { hasText: 'Smart bottle cap' }).click(); await sleep(60); await page.locator('.team-start button[type=submit]').click(); await waitTeam(page); T = await teamNow(page);
  check('prior-art run: three searches, three records, five findings, a novelty rating', T.status === 'done' && T.rows.join(',') === '3,3,2' && T.tools[0] === 3 && T.updated[2] === 1 && (await page.locator('.team-done').innerText()).includes('Medium'), [T, await page.locator('.team-done').innerText()]);
  await page.locator('.team-done .btn', { hasText: 'See the prior work' }).click(); await sleep(120); check('"See the prior work" opens the three records of this run', (await page.locator('.vx .tbl').innerText()).includes('PatentsView') && await page.locator('.vx .tbl tbody tr').count() === 3, await page.locator('.vx .tbl tbody tr').count());
  await page.locator('.vx .tbl tbody tr').first().click(); await page.waitForSelector('.drawer'); check('prior work in the demo is marked as an illustrative record', (await page.locator('.drawer').innerText()).includes('SAMPLE-') && (await page.locator('.drawer').innerText()).includes('Illustrative record')); await shot(page, '89-priorart-work'); await page.locator('.drawer-head .btn').click();
  await vtab(page, 'Pivot'); check('prior work as a pivot of source against overlap', await page.locator('.tbl.pivot .pv-b').count() >= 3);
  await page.locator('.titlebar [data-tour=debug]').click(); await page.waitForSelector('.debug'); await sleep(100); check('app agents show by name in the debug drawer', (await page.locator('.dbg-body').innerText()).includes('Critic')); await shot(page, '90-debug-team');
  await ctx.close();
}

async function flowNew(browser, url) { // workflow canvas, generated tests, share links, the app-only view, the guide, phones
  const { ctx, page } = await newPage(browser);
  await enter(page, url); await setSpeed(page, 'instant');
  await buildTpl(page, 'clinic'); await sleep(900);
  const appId = (await appState(page)).id, wtab = (name) => view(page, name);
  // the workflow canvas
  const fl = await st(page, () => ({ rf: document.querySelectorAll('.react-flow').length > 0, state: window.__formwork.flow().state, nodes: [...document.querySelectorAll('.react-flow__node')].map((n) => n.getAttribute('data-id')), edges: [...document.querySelectorAll('.react-flow__edge')].map((n) => n.getAttribute('data-id')), stations: document.querySelectorAll('.station').length, gates: document.querySelectorAll('.fl-gate').length, old: document.querySelectorAll('.line > .station').length }));
  check('the build is drawn as a React Flow workflow: request, 7 stations with the Tester, 7 gates, the app', fl.rf && fl.state === 'ready' && fl.nodes.length === 16 && fl.stations === 7 && fl.gates === 7 && fl.old === 0 && fl.nodes.includes('trigger') && fl.nodes.includes('ready'), fl);
  check('every handoff is an edge, and the send-back of the Database station is drawn', fl.edges.length === 16 && fl.edges.includes('e-b1') && fl.edges.includes('e-trig') && fl.edges.includes('e-ready'), fl.edges);
  await shot(page, '91-workflow');
  await page.locator('.fl-gate').nth(1).click(); await sleep(250);
  check('selecting a gate opens the tests of that station', /^Tests/.test(await page.locator('.insp-head [role=tab][aria-selected=true]').innerText()) && await page.locator('.insp-body .test').count() >= 10 && (await page.locator('.insp-head strong').innerText()) === 'Database');
  await page.locator('.station').nth(3).click(); await sleep(200);
  check('selecting an agent node shows what it wrote', (await page.locator('.insp-head strong').innerText()) === 'Views' && /^Output/.test(await page.locator('.insp-head [role=tab][aria-selected=true]').innerText()) && await page.locator('.station.sel').count() === 1);
  const z0 = await st(page, () => window.__formwork.flow().inst.getZoom()); await page.getByRole('button', { name: 'Zoom in' }).click(); await sleep(350); const z1 = await st(page, () => window.__formwork.flow().inst.getZoom());
  check('the canvas zooms with its buttons', z1 > z0 + 0.05, [z0, z1]);
  await page.locator('.build').evaluate((el) => { el.scrollTop = 0; }); await page.getByRole('button', { name: /Fit/ }).click(); await sleep(500);
  const box = await page.locator('.react-flow__node[data-id="a0"]').boundingBox(); await page.mouse.move(box.x + 30, box.y + 12); await page.mouse.down(); await sleep(40); await page.mouse.move(box.x + 90, box.y + 70, { steps: 8 }); await sleep(40); await page.mouse.up(); await sleep(250);
  const moved = await page.locator('.react-flow__node[data-id="a0"]').boundingBox(); await page.getByRole('button', { name: /Reset layout/ }).click(); await sleep(500); const back = await page.locator('.react-flow__node[data-id="a0"]').boundingBox();
  check('a node can be dragged, and Reset layout puts it back', Math.abs(moved.x - box.x) > 20 && Math.abs(back.x - moved.x) > 10, [box.x, moved.x, back.x]);
  check('the build summary strip counts what was built', (await page.locator('.build-sum .kpi').count()) === 6 && /142 \/ 142/.test(await page.locator('.build-sum').innerText()));
  // the generated test suite
  let a = await st(page, (id) => { const x = window.__formwork.state().apps[id]; return { tests: x.tests, rev: x.rev, suites: window.__formwork.suite(id), card: x.chat.some((m) => m.card && m.card.type === 'tests') }; }, appId);
  check('a test suite is generated and run when the build ends', a.tests && a.tests.total === 142 && a.tests.failed === 0 && a.tests.rev === a.rev && a.suites.length === 8 && a.card, a);
  await wtab('Tests'); await page.waitForSelector('.tests-view'); await page.getByRole('button', { name: /Run all 142 tests/ }).click(); await page.waitForFunction(() => /142 tests passed/.test(document.body.innerText) || document.querySelectorAll('.tests-view .test.ok').length > 50, null, { timeout: 20000 }); await sleep(300); await shot(page, '92-tests');
  check('Run all runs every test against the real database and endpoints', (await page.locator('.tests-view .kpi-v.ok').innerText()) === '142' && await page.locator('.tests-view .suite').count() === 8);
  const col = await st(page, (id) => { const t = window.__formwork.state().apps[id].def.tables.find((x) => x.name === 'patients'), c = t.columns.find((x) => x.required && x.type === 'text'); window.__formwork.sql(id, 'UPDATE "patients" SET "' + c.name + '" = \'\' WHERE "id" = 1'); return c.name; }, appId);
  await page.locator('.suite', { hasText: 'Database' }).getByRole('button', { name: 'Run' }).click(); await page.waitForSelector('.tests-view .test.bad'); await sleep(200);
  check('a broken row makes exactly one test fail, with the reason', await page.locator('.tests-view .test.bad').count() === 1 && /required value/.test(await page.locator('.tests-view .test.bad').innerText()) && /1 row has an empty/.test(await page.locator('.tests-view .test.bad').innerText()), col);
  await page.locator('.tests-view .seg button', { hasText: 'Failed' }).click(); await sleep(150); check('the Failed filter shows only the failing suite', await page.locator('.tests-view .suite').count() === 1); await shot(page, '93-tests-failed');
  await wtab('Build'); await sleep(500); check('the gate on the canvas and the summary show the failure', /1 failing/.test(await page.locator('.fl-gate').nth(1).innerText()) && /failing/.test(await page.locator('.build-sum').innerText()));
  await st(page, (o) => { window.__formwork.sql(o.id, 'UPDATE "patients" SET "' + o.col + '" = \'Test Name\' WHERE "id" = 1'); }, { id: appId, col });
  await page.locator('.fl-gate').nth(1).locator('button.btn').click(); await page.waitForFunction(() => /all pass/.test((document.querySelectorAll('.fl-gate')[1] || {}).innerText || ''), null, { timeout: 10000 });
  check('a gate runs its own tests from the canvas', /14 tests · all pass/.test(await page.locator('.fl-gate').nth(1).innerText()));
  await say(page, 'Add a notes field to patients'); await waitIdle(page);
  a = await st(page, (id) => { const x = window.__formwork.state().apps[id]; return { tests: x.tests, rev: x.rev, last: x.chat[x.chat.length - 1].text }; }, appId);
  check('after a change by chat the tests are generated and run again', a.tests.rev === a.rev && a.tests.failed === 0 && /regenerated the tests/.test(a.last), a);
  // share by link
  await page.locator('[data-tour="share"]').click(); await page.waitForSelector('.dialog.share'); check('sharing a draft first asks to release version 1.0', await page.locator('#sh-release').count() === 1 && (await page.locator('.dialog.share').innerText()).includes('not released yet')); await page.locator('#sh-release').click(); await page.waitForFunction(() => /#app=1\./.test((document.getElementById('sh-link') || {}).value || ''));
  const link1 = await page.inputValue('#sh-link'); await shot(page, '94-share');
  check('Share makes a link that carries the app, a few KB long', /#app=1\.[A-Za-z0-9_-]{2000,}$/.test(link1) && link1.length < 12000, link1.length);
  await page.selectOption('#sh-as', { index: 3 }); await page.waitForFunction((old) => { const v = (document.getElementById('sh-link') || {}).value || ''; return /#app=1\./.test(v) && v !== old; }, link1); const link2 = await page.inputValue('#sh-link');
  await page.getByRole('button', { name: 'Preview what they see' }).click(); await page.waitForSelector('.solo .app'); await sleep(300); await shot(page, '95-solo-preview');
  let so = await st(page, () => ({ builder: !!document.querySelector('.titlebar, .work-head, .chat, .tabstrip'), login: !!document.querySelector('.app-login'), first: (document.querySelector('.app-nav .nav-i') || {}).textContent, who: (document.querySelector('.persona-t .t-strong') || {}).textContent, note: !!document.querySelector('.solo-note') }));
  check('Preview shows only the app, signed in as the chosen person, Overview first', !so.builder && !so.login && so.first === 'Overview' && /Ayesha/.test(so.who) && so.note, so);
  await page.getByRole('button', { name: 'Close preview' }).click(); await page.waitForSelector('.work-head'); check('closing the preview returns to the builder', await page.locator('.solo').count() === 0);
  // someone else opens the link in their own browser
  const g = await newPage(browser), gp = g.page; await gp.goto(link1.replace(/^https?:\/\/[^#]+/, url)); await gp.waitForSelector('.solo .app'); await sleep(300);
  so = await st(gp, () => ({ builder: !!document.querySelector('.titlebar, .work-head, .chat, .ob-card, .signin'), login: !!document.querySelector('.app-login'), foot: (document.querySelector('.login-foot') || {}).textContent || '', accounts: window.__formwork.state().accounts.length }));
  check('a new visitor with the link sees only the app: no onboarding, no builder, no account', !so.builder && so.login && /Built with/.test(so.foot) && so.accounts === 0, so);
  await gp.locator('.persona-btn').first().click(); await gp.waitForSelector('.app-main .dash'); await gp.locator('.app-nav .nav-i').nth(1).click(); await gp.waitForSelector('.kb-card'); await gp.locator('.kb-card').first().click(); await gp.waitForSelector('.drawer'); await gp.locator('.drawer .btn.primary').first().click(); await sleep(300); await shot(gp, '96-guest-app');
  const gid = await st(gp, () => window.__formwork.view().solo.app), before = await st(gp, (id) => JSON.stringify(window.__formwork.sql(id, 'SELECT "status", COUNT(*) AS n FROM "appointments" GROUP BY "status" ORDER BY "status"')), gid);
  await sleep(700); await gp.reload(); await gp.waitForSelector('.solo .app'); await sleep(300);
  const after = await st(gp, () => { const id = window.__formwork.view().solo.app; return { id, rows: JSON.stringify(window.__formwork.sql(id, 'SELECT "status", COUNT(*) AS n FROM "appointments" GROUP BY "status" ORDER BY "status"')), apps: Object.keys(window.__formwork.state().apps).length }; });
  check('the visitor works in their own copy, and it is still there after a reload', after.id === gid && after.rows === before && after.apps === 1, [before, after]);
  await gp.locator('.login-foot .btn', { hasText: 'Open Turnkey' }).click(); await gp.waitForSelector('.ob-card'); check('from the app-only view a visitor can still go to Turnkey itself', !/#app=/.test(gp.url()));
  await g.ctx.close();
  const bad = await newPage(browser); await bad.page.goto(url + '#app=1.' + 'A'.repeat(40)); await bad.page.waitForSelector('.ob-card, .solo'); await sleep(400);
  check('a damaged link is refused and nothing opens', await bad.page.locator('.solo').count() === 0 && /damaged|not a Turnkey|does not hold/.test(await bad.page.locator('.toasts').innerText()));
  errors.splice(0, errors.length, ...errors.filter((e) => !/damaged|decompress|DecompressionStream|Failed to load/i.test(e))); await bad.ctx.close();
  // open someone's link from inside the builder, and keep it
  await page.locator('.brand').click(); await page.waitForSelector('.home'); await page.getByRole('button', { name: 'Open a shared app' }).click(); await page.fill('#ol-text', link2); await page.getByRole('button', { name: 'Open the app' }).click(); await page.waitForSelector('.solo .app'); await sleep(200);
  await page.locator('.app-head .persona').click(); await page.locator('.menu .mi', { hasText: 'Back to Turnkey' }).click(); await page.waitForSelector('.home'); await sleep(150);
  check('an app opened from a link is listed under Opened from links', (await page.locator('.home').innerText()).includes('Opened from links') && await page.getByRole('button', { name: /Save to my apps/ }).count() === 1); await shot(page, '97-home-shared');
  const n0 = await st(page, () => { const s = window.__formwork.state(); return Object.values(s.apps).filter((x) => x.owner === s.session).length; });
  await page.getByRole('button', { name: /Save to my apps/ }).click(); await page.waitForSelector('.work-head'); await sleep(300);
  a = await st(page, () => { const s = window.__formwork.state(), mine = Object.values(s.apps).filter((x) => x.owner === s.session); return { n: mine.length, last: mine.sort((x, y) => y.updated - x.updated)[0] }; });
  check('Save to my apps turns the copy into an app of your own, with passing tests', a.n === n0 + 1 && !a.last.shared && a.last.status === 'ready' && a.last.tests && a.last.tests.failed === 0 && a.last.tests.total >= 130, [a.n, n0, a.last.tests]);
  // the feature guide
  await page.locator('.titlebar .tb-right').getByRole('button', { name: 'Help' }).click(); await page.locator('.menu .mi', { hasText: 'Feature guide' }).click(); await page.waitForSelector('.dialog.guide');
  const gn = await st(page, () => window.__formwork.guide()); check('the feature guide lists every feature', gn >= 25 && await page.locator('.guide-i').count() === gn, gn); await shot(page, '98-guide');
  await page.fill('#guide-q', 'share'); await sleep(150); const few = await page.locator('.guide-i').count(); await page.fill('#guide-q', 'test suite'); await sleep(150);
  await page.locator('.guide-i .btn', { hasText: 'Open the tests' }).click(); await page.waitForSelector('.tests-view');
  check('the guide can be searched, and Show me jumps to the feature', few > 0 && few < gn && await page.locator('.dialog').count() === 0);
  await ctx.close();
  // React Flow blocked: the plain line of stations takes over
  const n2 = await newPage(browser, { init: NO_CANVAS }), c2 = n2.ctx, p2 = n2.page; await enter(p2, url); await setSpeed(p2, 'instant'); await buildTpl(p2, 'leave'); await sleep(500);
  const fb = await st(p2, () => ({ state: window.__formwork.flow().state, rf: document.querySelectorAll('.react-flow').length, line: document.querySelectorAll('.line > .station').length }));
  check('if React Flow cannot be loaded, the plain line of stations is shown instead', fb.state === 'none' && fb.rf === 0 && fb.line === 6, fb); await c2.close();
  // the builder on a phone
  const ph = await newPage(browser, { viewport: { width: 390, height: 844 } }), pp = ph.page; await enter(pp, url); await setSpeed(pp, 'instant'); await buildTpl(pp, 'debate'); await sleep(900); await shot(pp, '99-phone-build');
  const pv = await st(pp, () => ({ scroll: document.documentElement.scrollTop, over: document.documentElement.scrollWidth > innerWidth + 1, bar: document.querySelector('.titlebar.phone').getBoundingClientRect().top, nav: Math.round(document.querySelector('.phone-nav').getBoundingClientRect().bottom), inline: document.querySelectorAll('.build .inspector').length, nodes: document.querySelectorAll('.react-flow__node').length }));
  check('phone: the builder fits the screen, with the workflow in one column', pv.scroll === 0 && !pv.over && pv.bar === 0 && pv.nav === 844 && pv.inline === 0 && pv.nodes === 19, pv);
  await pp.getByRole('button', { name: /Fit/ }).click(); await sleep(500); await pp.locator('.station').nth(2).click(); await pp.waitForSelector('.sheet .inspector'); await shot(pp, '99b-phone-inspector');
  check('phone: selecting a node opens the inspector as a bottom sheet', (await pp.locator('.sheet .sheet-head h2').innerText()) === 'Backend' && await pp.locator('.sheet .insp-head [role=tab]').count() === 5);
  await pp.locator('.sheet .sheet-head .btn').click(); await sleep(250); await pp.locator('.phone-nav .tab-i', { hasText: 'More' }).click(); await pp.waitForSelector('.sheet'); const more = await pp.locator('.sheet .sheet-i').allInnerTexts();
  check('phone: Data, API, Connections and the app actions are under More', ['Data', 'API', 'Connections', 'Share by link', 'Delete app'].every((x) => more.some((m) => m.indexOf(x) === 0)), more);
  await pp.locator('.sheet-i', { hasText: 'Share by link' }).click(); await pp.waitForSelector('.dialog.share'); await sleep(450); const db = await pp.locator('.dialog.share').boundingBox();
  check('phone: dialogs rise from the bottom as sheets', db.width === 390 && Math.round(db.y + db.height) === 844, db);
  await pp.locator('.dialog .dhead .btn').click(); await sleep(200); await pp.locator('.titlebar .acct').click(); await pp.waitForSelector('.sheet'); const menu = await pp.locator('.sheet .sheet-l').allInnerTexts();
  check('phone: the menu holds Live, Online, Debug, the guide and the account', ['Live', 'Online', 'Debug mode', 'Feature guide', 'Sign out'].every((x) => menu.includes(x)), menu); await shot(pp, '99c-phone-menu');
  await ph.ctx.close();
}

/* ---------- Live follows the connection; the workflow is shared state the owner and the orchestrator both edit ---------- */
const appFull = (page) => st(page, () => { const F = window.__formwork, s = F.state(), t = (s.tabs[s.session] || []).find((x) => x.id === s.active[s.session]), a = t && t.app ? s.apps[t.app] : null; if (!a) return null; const r = a.runs[a.runs.length - 1] || {}, R = F.wf.runs()[a.id];
  const def = JSON.stringify(a.def); let h = 0; for (let i = 0; i < def.length; i++) h = (h * 31 + def.charCodeAt(i)) | 0;
  return { id: a.id, tpl: a.tpl, mode: a.mode, status: a.status, flow: JSON.parse(JSON.stringify(a.flow)), reviews: Object.fromEntries(Object.keys(a.reviews || {}).map((k) => [k, { status: a.reviews[k].status, by: a.reviews[k].by, stale: a.reviews[k].rev !== a.rev, f: a.reviews[k].findings.map((x) => ({ id: x.id, state: x.state, test: x.test, fix: x.fix })) }])),
    run: { kind: r.kind, status: r.status, retries: r.retries, label: r.label, n: a.runs.length }, line: Object.fromEntries(Object.keys(a.line).map((k) => [k, { s: a.line[k].status, rules: !!a.line[k].byRules, note: a.line[k].note || '', hold: a.line[k].hold || '', approved: !!a.line[k].approved, n: a.line[k].attempt }])),
    screens: a.def.screens.length, cols: Object.fromEntries(a.def.tables.map((x) => [x.name, x.columns.map((c) => c.name)])), tests: a.tests ? { total: a.tests.total, failed: a.tests.failed, fresh: a.tests.rev === a.rev } : null, chat: a.chat.slice(-5).map((m) => ({ from: m.from, text: m.text, card: m.card && m.card.type })), busy: !!R, gate: !!(R && R.gate), theme: a.def.theme ? a.def.theme.accent + '/' + a.def.theme.density + '/' + a.def.theme.nav : '', qa: a.qa ? { status: a.qa.status, by: a.qa.by, rounds: a.qa.rounds.map((x) => [x.failed, x.fixes.filter((f) => f.ok).length]) } : null, cases: (a.def.cases || []).length, rel: (a.releases || []).map((x) => x.v), dirty: F.wf.dirty(a), log: (a.log || []).map((x) => x.text),
    del: Object.keys(a.def.access || {}).map((tn) => tn + ':' + Object.keys(a.def.access[tn]).filter((ro) => a.def.access[tn][ro].delete).join('|')).join(' '), hash: h, rows: a.def.tables.reduce((n, x) => n + F.dbCount(a.id, x.name), 0) }; });
// let a run play out: answer the Researcher's question, and approve or stop at approvals the owner placed
async function drive(page, o) { o = o || {}; const seen = [];
  for (let i = 0; i < 900; i++) {
    const a = await appFull(page); if (a && !a.busy && (a.status === 'ready' || a.status === 'failed' || a.status === 'stopped')) return { a, seen };
    if (a && a.gate) { const at = Object.keys(a.line).find((k) => a.line[k].hold === 'approval'); if (seen[seen.length - 1] !== at) { seen.push(at); if (o.onGate) await o.onGate(at, a); } const b = page.locator('.gcard.ask .btn', { hasText: o.stopAt === at ? 'Stop here' : 'Approve and continue' }); if (await b.count()) await b.last().click().catch(() => {}); }
    else { const q = page.locator('.gcard.ask .opt:not([disabled])'); if (await q.count()) await q.first().click().catch(() => {}); }
    await sleep(90);
  }
  return { a: await appFull(page), seen };
}
const waitFree = async (page) => { await sleep(150); for (let i = 0; i < 600; i++) { const a = await appFull(page); if (a && !a.busy) return a; await sleep(80); } return appFull(page); };
const confirmYes = async (page) => { await page.waitForSelector('.dialog .dfoot .btn.primary'); await page.locator('.dialog .dfoot .btn.primary').click(); await sleep(150); };
async function flowCustom(browser, url) {
  // ----- A. Live and the connection, in a copy of the page that has no model behind it -----
  const { ctx, page } = await newPage(browser);
  await page.goto(url); await page.waitForSelector('.ob-card');
  await page.getByRole('button', { name: 'Get started' }).click(); await page.getByRole('button', { name: /Skip and use the demo account/ }).click();
  check('onboarding: Live can be chosen with no model behind the page, because it follows the connection', !(await page.locator('.choice').nth(1).isDisabled()));
  await ctx.setOffline(true); await sleep(300);
  check('onboarding: without a connection Live cannot be chosen, and it says why', await page.locator('.choice').nth(1).isDisabled() && /Needs internet/.test(await page.locator('.choice').nth(1).innerText()), await page.locator('.choice').nth(1).innerText());
  await ctx.setOffline(false); await sleep(300);
  await page.locator('.choice').nth(1).click(); await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /empty workspace/ }).click(); await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.ob-body .switch').click(); await page.getByRole('button', { name: 'Open my workspace' }).click(); await page.waitForSelector('.home'); await setSpeed(page, 'instant');
  const mode = () => st(page, () => { const F = window.__formwork, m = F.wf.mode(), sw = document.getElementById('sw-live'); return { id: m.id, on: m.on, live: m.live, demo: F.state().settings.demo, sw: sw ? { on: sw.checked, off: sw.disabled } : null, why: (document.getElementById('mode-why') || {}).innerText || '', net: (document.querySelector('.titlebar .net') || {}).innerText || '' }; });
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  let m = await mode();
  check('Live is on because the device is online, although no model is connected to this copy of the page', m.on && !m.demo && m.sw.on && !m.sw.off && (m.id === 'checking' || m.id === 'nomodel'), m);
  await ctx.setOffline(true); await sleep(350); m = await mode();
  check('the connection goes: Live pauses by itself and its switch locks', !m.on && !m.demo && !m.sw.on && m.sw.off && m.id === 'offline' && /Paused/.test(m.why) && /Offline/.test(m.net), m);
  check('going offline is announced once, with what keeps working', /Live is paused/.test(await toasts()) && /keep working/.test(await toasts()), await toasts());
  check('the offline bar says Live is paused until the connection returns', /Live is paused until the connection returns/.test(await page.locator('.shell > .mbar').last().innerText()), await page.locator('.shell > .mbar').allInnerTexts());
  await ctx.setOffline(false); await sleep(350); m = await mode();
  check('the connection returns: Live switches itself back on', m.on && m.sw.on && !m.sw.off && /Live is on again/.test(await toasts()), [m, await toasts()]);
  const evs = await st(page, () => window.__formwork.logs.EV.filter((e) => e.type === 'CUSTOM' && e.name === 'connectivity').map((e) => e.value.online + '/' + e.value.live));
  check('each change of the connection is one AG-UI custom event', evs.slice(-2).join(' ') === 'false/false true/true' && evs.length === 4, evs);
  await st(page, () => { const f = window.fetch; window.__realFetch = f; window.fetch = (u, o) => (String(u).includes('/api/health') ? Promise.reject(new TypeError('Failed to fetch')) : f(u, o)); return window.__formwork.wf.reach(); }); m = await mode();
  check('the browser says online but the server cannot be reached: Live pauses as if offline', !m.on && m.sw.off && m.id === 'offline', m);
  await st(page, () => { window.fetch = window.__realFetch; return window.__formwork.wf.reach(); }); m = await mode();
  check('the server answers again: Live switches itself back on', m.on && !m.sw.off && m.id !== 'offline', m);
  await page.locator('.titlebar .net').click(); await sleep(250); m = await mode();
  check('the offline test button pauses Live in the same way', !m.on && m.sw.off && m.id === 'offline', m);
  await page.locator('.titlebar .net').click(); await sleep(250); m = await mode();
  check('and brings it back', m.on && !m.sw.off, m);
  await page.locator('.tb-mode .switch').click(); await sleep(200); m = await mode();
  check('switching Live off is the owner choosing Demo', !m.on && m.demo && m.id === 'demo' && /Demo/.test(m.why), m);
  await ctx.setOffline(true); await sleep(250); await ctx.setOffline(false); await sleep(250); m = await mode();
  check('Demo stays chosen when the connection comes back', m.demo && !m.on && m.id === 'demo', m);
  await page.locator('.tb-mode .switch').click(); await sleep(200);
  await st(page, () => { window.__formwork.view().live = 'none'; }); await page.locator('.newtab').click(); await page.waitForSelector('.home'); await sleep(100);
  check('the home page says what Live will do here: no model connected, saved builds stand in', /no model connected to this copy/.test(await page.locator('#home-mode').innerText()), await page.locator('#home-mode').innerText());
  await page.fill('#home-prompt', 'something nobody ever saved'); await page.locator('.prompt .btn.primary').click(); await sleep(200);
  check('Live with no model: an unknown sentence gets a plain reason, not a refusal about where the page runs', /No model is connected to this copy/.test(await page.locator('.home .mbar').innerText()) && !/not available in this view/.test(await page.locator('.home').innerText()), await page.locator('.home .mbar').allInnerTexts());
  await page.fill('#home-prompt', 'a clinic that books patient appointments'); await page.locator('.prompt .btn.primary').click(); let r = await drive(page), a = r.a;
  check('Live with no model: a sentence a saved build covers is built from that saved build', a.status === 'ready' && a.tpl === 'clinic' && a.mode === 'demo', [a.status, a.tpl, a.mode]);
  await page.locator('.titlebar .net').click(); await sleep(200); await say(page, 'Add a notes field to patients'); a = await waitFree(page);
  check('offline with Live wanted: a change in chat is read by the built-in rules, and says so', a.cols.patients.includes('notes') && (await page.locator('.msgs').innerText()).includes('You are offline, so Live is paused. Until the connection is back I am reading changes with the built-in rules.'), a.chat);
  await page.locator('.titlebar .net').click(); await sleep(200); await page.locator('.tb-mode .switch').click(); await sleep(200); // Demo from here on

  // ----- B. the workflow, edited on the canvas -----
  await page.waitForSelector('.react-flow .fl-gate'); const before = await appFull(page);
  const ev0 = await st(page, () => [window.__formwork.logs.EV.length, window.__formwork.logs.TOOLCALLS.length]);
  check('canvas: every gate that can take a step has a plus, and the Tester is the seventh station', await page.locator('.fl-gate .fl-add').count() === 6 && await page.locator('.fl-node.station').count() === 7 && /Tester/.test(await page.locator('.fl-node.station').nth(6).innerText()), [await page.locator('.fl-gate .fl-add').count(), await page.locator('.fl-node.station').count()]);
  await page.locator('.fl-gate').nth(1).locator('.fl-add').click(); await page.waitForSelector('.dialog.addstep'); await shot(page, 'c09-add-step');
  check('the plus opens one dialog: your approval, the step library, or an agent of your own', await page.locator('.dialog.addstep .step-pick').count() >= 3 && await page.locator('#as-name').count() === 1 && /Normalise tables/.test(await page.locator('.dialog.addstep').innerText()), await page.locator('.dialog.addstep').innerText());
  await page.locator('#as-approval').click(); await sleep(300); a = await appFull(page);
  check('canvas: adding Your approval after Database puts an approval node into the flow', a.flow.approve.database === true && await page.locator('.fl-approval').count() === 1 && (await page.locator('.fl-approval').innerText()).includes('The build waits here for you'), a.flow);
  const d1 = await st(page, (n) => ({ ev: window.__formwork.logs.EV.slice(n[0]).filter((e) => e.type === 'STATE_DELTA').map((e) => [e.source, e.delta[0].path, e.delta[0].value]), tc: window.__formwork.logs.TOOLCALLS.slice(n[1]).filter((t) => /^workflow\./.test(t.tool)).length }), ev0);
  check('canvas: the edit is one state update from the user, with no tool call', JSON.stringify(d1.ev) === JSON.stringify([['user', '/workflow/approve/database', true]]) && d1.tc === 0, d1);
  check('canvas: the orchestrator acknowledges it in chat', /^From the canvas: I will stop after Database/.test(a.chat[a.chat.length - 1].text), a.chat);
  await page.locator('.fl-gate').nth(2).locator('.fl-add').click(); await page.waitForSelector('.dialog.addstep'); await page.locator('#as-security').click(); a = await waitFree(page);
  check('canvas: Review on the Backend gate adds the Security reviewer, and only that reviewer runs', a.flow.reviewers.join() === 'security' && a.run.kind === 'review' && a.run.status === 'ok' && a.reviews.security.status === 'ok' && a.reviews.security.by === 'rules' && await page.locator('.fl-review').count() === 1 && a.line.backend.s === 'ok' && a.line.backend.note === before.line.backend.note, [a.flow, a.run, a.reviews]);
  check('review: every fix it proposes was tried out in a savepoint and passes every check', a.reviews.security.f.length >= 1 && a.reviews.security.f.every((x) => !x.fix || x.test === 'pass') && !a.reviews.security.stale, a.reviews);
  check('review: the try-outs left no trace in the definition, the data or the test results', a.hash === before.hash && a.rows === before.rows && a.tests.failed === 0 && a.tests.fresh && a.del === before.del, [a.hash, before.hash, a.rows, before.rows, a.tests, a.del]);
  await page.locator('.fl-review').first().click(); await sleep(300);
  check('selecting the review step shows its findings in the inspector', await page.locator('.review-insp .finding').count() >= 1 && /Tried out: passes every check/.test(await page.locator('.review-insp').innerText()), await page.locator('.review-insp').innerText());
  const fix = a.reviews.security.f[0].fix; await page.locator('.review-insp .finding .btn.primary').first().click(); a = await waitFree(page);
  check('review: Apply runs the fix as an ordinary checked change', a.reviews.security.f[0].state === 'applied' && a.run.kind === 'change' && a.run.status === 'ok' && a.del !== before.del && !/appointments:\S/.test(a.del) && a.tests.failed === 0, [fix, a.del, before.del, a.run, a.reviews.security.f]);
  await shot(page, 'c10-canvas-review');

  // ----- B2. steps from the library, and an agent of the owner's own -----
  await page.evaluate(() => { const b = document.querySelector('.build'); if (b) b.scrollTop = 0; }); await sleep(200);
  await page.locator('.fl-gate').nth(4).locator('.fl-add').click(); await page.waitForSelector('.dialog.addstep'); await page.fill('#as-name', 'Brand stylist'); await page.fill('#as-job', 'Use the colour teal. Make the rows compact. Write a poem about tables.'); await page.locator('#as-create').click(); a = await waitFree(page);
  const ag = a.flow.agents[0] || {};
  check('an agent of my own: made from a name and a sentence, placed after Screens, set to apply its changes', a.flow.agents.length === 1 && ag.name === 'Brand stylist' && ag.after === 'screens' && ag.mode === 'apply' && a.flow.reviewers.includes(ag.id) && a.run.kind === 'step' && a.run.status === 'ok', [a.flow, a.run]);
  check('my agent ran alone and applied the two changes it could read, each one checked; the sentence it could not read was left out', a.theme.indexOf('teal/compact') === 0 && a.reviews[ag.id] && a.reviews[ag.id].f.length === 2 && a.reviews[ag.id].f.every((x) => x.state === 'applied') && a.tests.failed === 0 && a.tests.fresh, [a.theme, a.reviews[ag.id], a.tests]);
  check('the canvas shows my agent as a node of its own in the flow', await page.locator('.fl-review').count() === 2 && /Brand stylist[\s\S]*2 changes applied[\s\S]*Your agent/.test(await page.locator('.fl-review').nth(1).innerText()), await page.locator('.fl-review').allInnerTexts()); await shot(page, 'c11-own-agent');
  await say(page, 'Make the brand stylist only advise'); await sleep(250); await say(page, 'Move the brand stylist after the walkthrough'); await sleep(250); a = await appFull(page);
  check('chat: the mode and the place of a step are changed by tool calls', a.flow.agents[0] && a.flow.agents[0].mode === 'advise' && a.flow.agents[0].after === 'walkthrough', a.flow.agents);
  await say(page, 'Add a normalise step'); a = await waitFree(page);
  check('library: "add a normalise step" adds the Normaliser after Database; this app has nothing to tidy', a.flow.reviewers.includes('normalize') && a.reviews.normalize && a.reviews.normalize.status === 'ok' && a.reviews.normalize.f.length === 0, [a.flow.reviewers, a.reviews.normalize]);
  await say(page, 'Remove the brand stylist agent'); await sleep(250); await say(page, 'Remove the normalise step'); await sleep(250); a = await appFull(page);
  check('chat: removing steps takes them out of the flow, and what they changed stays in the app', a.flow.agents.length === 0 && a.flow.reviewers.join() === 'security' && a.theme.indexOf('teal/compact') === 0, [a.flow, a.theme]);

  // ----- B3. the step palette: drag a step onto a gate, as in n8n -----
  check('palette: every step the plus offers is a tile above the canvas, and a step already in the flow is greyed out', await page.locator('.flow-palette .fp-tile').count() >= 8 && await page.locator('.fp-tile[data-step=security]').isDisabled() && !(await page.locator('.fp-tile[data-step=normalize]').isDisabled()), await page.locator('.flow-palette').innerText());
  for (let i = 0, was = ''; i < 40; i++) { const b = JSON.stringify(await page.locator('.fl-gate[data-st=database]').boundingBox()); if (b === was) break; was = b; await sleep(150); }
  await page.locator('.fp-tile[data-step=normalize]').dragTo(page.locator('.fl-gate[data-st=database]')); a = await waitFree(page);
  check('palette: dropping Normalise tables on the Database gate adds it there and runs it', a.flow.reviewers.includes('normalize') && a.reviews.normalize && a.reviews.normalize.status === 'ok', [a.flow.reviewers, a.reviews.normalize]);
  for (let i = 0, was = ''; i < 40; i++) { const b = JSON.stringify(await page.locator('.fl-gate[data-st=database]').boundingBox()); if (b === was) break; was = b; await sleep(150); } // the canvas refits after a step is added: wait until the gate stops moving
  await page.locator('.fp-tile[data-step=insight]').dragTo(page.locator('.fl-gate[data-st=database]')); await page.waitForFunction(() => Array.from(document.querySelectorAll('.toast')).some((t) => /Insight review reads/.test(t.textContent || '')), null, { timeout: 5000 }).catch(() => {}); a = await appFull(page);
  check('palette: a step dropped where it cannot read anything yet is refused with the reason', !a.flow.reviewers.includes('insight') && /Insight review reads .* so it can go after/.test(await page.locator('.toast').allInnerTexts().then((x) => x.join(' | '))), [a.flow.reviewers, await page.locator('.toast').allInnerTexts()]);
  await say(page, 'Remove the normalise step'); await sleep(250); a = await appFull(page);
  check('palette: the step it added comes out like any other', a.flow.reviewers.join() === 'security', a.flow.reviewers);

  // ----- C. the same workflow, edited by asking in chat -----
  const tc0 = await st(page, () => window.__formwork.logs.TOOLCALLS.length);
  await say(page, 'Ask me before the screens are built'); await sleep(300); a = await appFull(page);
  const tcs = await st(page, (n) => window.__formwork.logs.TOOLCALLS.slice(n).map((t) => [t.tool, t.kind, t.agent, t.args.station, t.args.on, t.ok]), tc0);
  check('chat: "ask me before the screens are built" is a frontend tool call that stops the line after Views', a.flow.approve.views === true && JSON.stringify(tcs.filter((t) => /^workflow/.test(t[0]))) === JSON.stringify([['workflow.set_approval', 'frontend', 'orchestrator', 'views', true, true]]) && a.chat[a.chat.length - 1].card === 'flow', [a.flow, tcs, a.chat]);
  await page.locator('.gcard .btn', { hasText: 'Undo' }).last().click(); await sleep(250); a = await appFull(page);
  check('chat: Undo on the card puts the workflow back', !a.flow.approve.views && a.flow.approve.database === true, a.flow);
  await say(page, 'Allow 2 attempts'); await say(page, 'Tell the UI agent to keep page names to two words'); await say(page, 'add an insight review'); a = await waitFree(page);
  check('chat: attempts, a standing instruction and a second review step', a.flow.attempts === 2 && a.flow.notes.ui === 'Keep page names to two words' && a.flow.reviewers.join() === 'security,insight' && a.reviews.insight.status === 'ok' && a.reviews.insight.f.every((x) => x.test === 'pass'), [a.flow, a.reviews.insight]);
  await say(page, 'Show the workflow'); await sleep(250);
  check('chat: "show the workflow" answers with a card of what differs from the standard', (await page.locator('.gcard').last().innerText()).replace(/\s+/g, ' ').includes('Asks you after Database') && /Security review after Backend/.test(await page.locator('.gcard').last().innerText()) && /2 attempts per station/.test(await page.locator('.gcard').last().innerText()), await page.locator('.gcard').last().innerText());
  await say(page, 'Ask me after the walkthrough'); await sleep(200); const n1 = (await appFull(page)).chat.slice(-1)[0].text;
  await say(page, 'Let the rules build the tables'); await sleep(200); const n2 = (await appFull(page)).chat.slice(-1)[0].text; a = await appFull(page);
  check('chat: what cannot be customised is refused with the reason', /last step/.test(n1) && /keeps its agent/.test(n2) && !a.flow.approve.walkthrough && !a.flow.by.database, [n1, n2]);
  const want = { 'Add a normalise step': 'add_step:normalize/', 'Add an agent called Table tidier after database that turns every text field that repeats into a choice': 'add_step:Table tidier/turns every text field that repeats into a choice/database', 'Move the security review after views': 'move_step:security/views', 'Let the security review apply its changes': 'set_mode:security/apply', 'Add a style field to tickets': null, 'Ask me before the screens are built': 'set_approval:views/true', 'Pause after the database': 'set_approval:database/true', 'Wait for my approval before building the backend': 'set_approval:database/true', 'I want to approve the tables': 'set_approval:database/true', 'Let me see the brief first': 'set_approval:research/true', 'Ask me at every step': 'set_approval:research/true+set_approval:database/true+set_approval:backend/true+set_approval:views/true+set_approval:screens/true', 'Stop asking me after the database': 'set_approval:database/false', 'No more approvals': 'set_approval:research/false+set_approval:database/false+set_approval:backend/false+set_approval:views/false+set_approval:screens/false',
    'Add a security review': 'add_review:security', 'Add the data reviewer': 'add_review:data', 'Remove the insight review': 'remove_review:insight', 'Run the wording review': 'review:wording', 'Allow 2 attempts': 'set_attempts:2', 'Only one try per station': 'set_attempts:1', 'Send work back at most once': 'set_attempts:2',
    'Tell the database agent to add a notes field to every table before it is approved': 'set_note:database/Add a notes field to every table before it is approved', 'Note for the researcher: keep it to three roles': 'set_note:researcher/Keep it to three roles', "Clear the UI agent's instructions": 'set_note:ui/', 'Let the rules build the screens': 'set_worker:screens/rules', 'Give the views back to the agent': 'set_worker:views/agent', 'Run again from views': 'rerun:views', 'Reset the workflow': 'reset:', 'Save this workflow as my default': 'save_default:', 'Show the workflow': 'show',
    // and these are changes to the app, not to the workflow
    'Add a notes field to patients': null, 'Stop receptionists from deleting appointments': null, 'Let doctors edit their own appointments': null, 'Add a chart of appointments by status to the dashboard': null, 'Add a board of reviews by status': null, 'Add a reviewer field to papers': null, 'Remove the patient notes': null, 'Make the rows compact': null, 'Use side navigation': null, 'Add an approved on date field to requests': null, 'Rename the app to Front Desk': null, 'Reset the data': null, 'Make it purple': null };
  const got = await st(page, (list) => list.map((t) => { const p = window.__formwork.wf.parse(t); return !p ? null : p.calls ? p.calls.map((c) => c.tool + ':' + Object.values(c.args || {}).join('/')).join('+') : p.rerun ? 'rerun:' + p.rerun : p.review ? 'review:' + p.review : p.show ? 'show' : 'reply'; }), Object.keys(want));
  const wrong = Object.keys(want).map((k, i) => (got[i] === want[k] ? null : k + ' → ' + got[i])).filter(Boolean);
  check('chat: ' + Object.keys(want).length + ' phrasings are read as the right workflow tool, or left for the change reader', wrong.length === 0, wrong);

  // ----- D. a build under the customised workflow: approval, review steps, two attempts -----
  await page.locator('.build-bar .btn', { hasText: 'Run again' }).click(); await confirmYes(page); let atGate = null;
  r = await drive(page, { onGate: async (at, s) => { await page.locator('.fl-approval', { hasText: 'Waiting for you' }).first().waitFor({ timeout: 5000 }).catch(() => {}); atGate = { at, st: s.line[at].s, gateText: await page.locator('.fl-approval').first().innerText(), bar: (await page.locator('.build .mbar').allInnerTexts()).join(' '), card: await page.locator('.gcard.ask').last().innerText(), interrupts: await st(page, () => window.__formwork.logs.EV.filter((e) => e.type === 'CUSTOM' && e.name === 'interrupt' && e.value.reason === 'approval').length) }; await shot(page, 'c11-approval'); } }); a = r.a;
  check('build: the line stops after Database and waits for the owner', r.seen.join() === 'database' && atGate && atGate.st === 'waiting' && /Waiting for you/.test(atGate.gateText) && /waiting for your approval after Database/.test(atGate.bar) && /Your approval · Database/.test(atGate.card) && atGate.interrupts >= 1, [r.seen, atGate]);
  check('build: once approved it goes on to a finished app, with the approval recorded', a.status === 'ready' && a.run.kind === 'build' && a.run.status === 'ok' && a.line.database.approved && a.line.database.s === 'ok' && a.tests.failed === 0, [a.status, a.run, a.line.database]);
  check('build: the review steps ran inside the line, and their fixes were tried out when the app was whole', a.reviews.security.status === 'ok' && a.reviews.insight.status === 'ok' && [].concat(a.reviews.security.f, a.reviews.insight.f).every((x) => !x.fix || x.test === 'pass') && !a.reviews.security.stale && (await page.locator('.msgs').innerText()).includes('I tried each one out in a savepoint and put it back'), a.reviews);
  check('build: with two attempts the Database agent is still sent back once and then passes', a.run.retries === 1 && a.line.database.n === 2, [a.run, a.line.database]);
  const tl = await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]), A = s.apps[t.app], R = A.runs[A.runs.length - 1]; return { steps: R.steps.map((x) => [x.agent, x.station, x.label, x.kind, x.ok].join('|')), sent: window.__formwork.logs.EV.filter((e) => e.type === 'CUSTOM' && e.name === 'sent_back' && e.runId === R.id).length }; });
  check('timeline: the workflow graph puts the send-back, the approval and the added steps on the run', tl.steps.some((x) => /^orchestrator\|database\|Sent back to .*\|check\|false$/.test(x)) && tl.steps.includes('orchestrator|database|Waiting for your approval|wait|true') && tl.steps.some((x) => x.startsWith('rv_security|')) && tl.steps.some((x) => x.startsWith('rv_insight|')) && tl.sent === 1, tl);
  await st(page, () => { const F = window.__formwork, s = F.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); F.wf.edit(s.apps[t.app], [{ tool: 'set_approval', args: { station: 'views', on: true } }]); }); await sleep(200);
  const keep = await appFull(page); await say(page, 'Run again from views'); await confirmYes(page); r = await drive(page, { stopAt: 'views' }); a = r.a;
  check('a run from a later station keeps the earlier ones, and stopping at its approval puts the app back exactly as it was', r.seen.join() === 'views' && a.status === 'ready' && a.run.kind === 'rerun' && a.run.status === 'stopped' && a.hash === keep.hash && a.rows === keep.rows && a.screens === keep.screens && a.tests.failed === 0 && /I put the app back exactly as it was/.test(a.chat.map((x) => x.text).join(' ')), [r.seen, a.status, a.run, a.hash === keep.hash, a.chat]);

  // ----- E. the settings dialog and the Customize tab -----
  await page.locator('[data-tour="customize"]').click(); await page.waitForSelector('.dialog.wf');
  check('settings: one dialog lists every station with its approval, review step, worker and instruction', await page.locator('.dialog.wf tbody tr').count() === 6 && await page.locator('.dialog.wf .switch').count() === 9 && /Different from the standard workflow/.test(await page.locator('.dialog.wf').innerText()), await page.locator('.dialog.wf .switch').count());
  await page.locator('.dialog.wf label.switch:has(#wf-approve-database)').click(); await page.locator('.dialog.wf label.switch:has(#wf-approve-views)').click(); await page.locator('.dialog.wf .set-row .seg button', { hasText: '1' }).click(); await sleep(200); await shot(page, 'c12-dialog');
  await page.getByRole('button', { name: 'Done' }).click(); a = await appFull(page);
  check('settings: switches and attempts change the same shared state', !a.flow.approve.database && !a.flow.approve.views && a.flow.attempts === 1, a.flow);
  await page.locator('.build-bar .btn', { hasText: 'Run again' }).click(); await confirmYes(page); r = await drive(page); a = r.a;
  check('one attempt: nothing is sent back, code repairs the Database answer, and the app is still finished', a.status === 'ready' && a.run.retries === 0 && a.line.database.n === 1 && r.seen.length === 0 && a.tests.failed === 0, [a.status, a.run, a.line.database, a.tests]);
  await page.evaluate(() => { const b = document.querySelector('.build'); if (b) b.scrollTop = 0; }); await sleep(200);
  await page.locator('.fl-node.station').nth(4).locator('.fl-opt').click(); await sleep(300);
  check('canvas: the options button on an agent opens that station\'s Customize tab', (await page.locator('.inspector .tab.on').innerText()).includes('Customize') && await page.locator('.inspector .cust .cust-row').count() === 4 && /Wording reviewer/.test(await page.locator('.inspector .cust').innerText()), await page.locator('.inspector .cust').innerText());
  await page.locator('.inspector .cust .seg[aria-label="Who does this step"] button', { hasText: 'Rules' }).click(); await sleep(250); a = await appFull(page);
  check('Customize: handing Screens to the rules queues a run from that station', a.flow.by.screens === 'rules' && /Screens will be built by the built-in rules/.test(a.chat[a.chat.length - 1].text) && a.chat[a.chat.length - 1].card === 'flow', [a.flow, a.chat]);
  const n0 = a.run.n, waitBar = await page.locator('.build .rerun-wait').innerText().catch(() => '');
  check('re-run after a canvas edit: the Build view says which stations run again after a short wait, and nothing has started yet', /Screens and Walkthrough run again in \d s/.test(waitBar) && /Research, Database, Backend, Views stay as they are/.test(waitBar) && (await appFull(page)).run.n === n0, waitBar);
  await page.locator('.inspector .cust .seg[aria-label="Who does this step"] button', { hasText: 'Agent' }).click(); await sleep(150);
  await page.locator('.inspector .cust .seg[aria-label="Who does this step"] button', { hasText: 'Rules' }).click(); await sleep(150);
  check('re-run after a canvas edit: a burst of edits waits for one run, not one per edit', await page.locator('.build .rerun-wait').count() === 1 && (await appFull(page)).run.n === n0, (await appFull(page)).run);
  await page.locator('.build .rerun-wait .btn', { hasText: 'Run now' }).click(); r = await drive(page); a = r.a;
  check('rules instead of the agent: Screens and the Walkthrough ran again, the four stations before them were kept, and the tests pass', a.status === 'ready' && a.run.kind === 'rerun' && a.run.status === 'ok' && a.line.screens.rules && ['research', 'database', 'backend', 'views'].every((k) => a.line[k].note === 'Kept') && a.screens !== keep.screens && a.rows === keep.rows && a.tests.failed === 0, [a.run, a.line, a.screens, a.tests]);
  await page.evaluate(() => { const b = document.querySelector('.build'); if (b) b.scrollTop = 0; }); await sleep(200); await page.locator('.fl-node.station').nth(4).locator('.fl-opt').click(); await sleep(300);
  await page.evaluate(() => { const el = document.querySelector('.inspector'); if (el) el.scrollIntoView({ block: 'center' }); }); await page.fill('.inspector .cust textarea', 'Use short labels'); await page.locator('.inspector .cust .btn', { hasText: 'Save instruction' }).click(); await sleep(200); a = await appFull(page);
  check('Customize: a standing instruction is saved for the agent, and says it acts in Live builds', a.flow.notes.ui === 'Use short labels' && /takes effect in Live builds/.test(a.chat[a.chat.length - 1].text), [a.flow.notes, a.chat]);
  await shot(page, 'c13-customize-tab');

  // ----- F. a default for new apps, and the way back to the standard workflow -----
  await page.locator('[data-tour="customize"]').click(); await page.waitForSelector('.dialog.wf'); await page.locator('.dialog.wf .dfoot .btn', { hasText: 'Save as my default' }).click(); await sleep(150); await page.getByRole('button', { name: 'Done' }).click(); const mine = (await appFull(page)).flow;
  await page.locator('.newtab').click(); await page.waitForSelector('.home'); await page.locator('[data-tpl="helpdesk"] .tpl-build').click(); r = await drive(page); a = r.a;
  check('default: a new app starts with the saved workflow and is built under it', JSON.stringify(a.flow) === JSON.stringify(mine) && a.status === 'ready' && a.line.screens.rules && a.reviews.security && a.reviews.insight && a.tests.failed === 0, [a.flow, mine, a.status, a.line.screens, Object.keys(a.reviews)]);
  await say(page, 'Reset the workflow'); await sleep(300); a = await appFull(page);
  check('reset: back to the standard workflow, review steps gone from the canvas', JSON.stringify(a.flow) === JSON.stringify({ attempts: 3, approve: {}, notes: {}, by: {}, reviewers: [], agents: [], at: {}, auto: {} }) && Object.keys(a.reviews).length === 0 && await page.locator('.fl-review').count() === 0, a.flow);
  const saved = await st(page, () => { const raw = JSON.parse(window.__turnkeyStorage.get('state') || '{}'); return { flows: Object.keys(raw.flows || {}).length, apps: Object.values(raw.apps || {}).map((x) => !!x.flow) }; });
  // an approval can be answered by typing, and anything else typed there gets directions instead of being taken for a change
  await say(page, 'Add a security review'); await waitFree(page); await say(page, 'Ask me after research'); await sleep(200);
  await page.locator('.build-bar .btn', { hasText: 'Run again' }).click(); await confirmYes(page);
  const gateUp = () => st(page, () => { const F = window.__formwork, s = F.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]), R = F.wf.runs()[t.app]; return R ? (R.gate ? 'gate' : R.answer ? 'question' : 'run') : 'idle'; });
  for (let i = 0; i < 200 && (await gateUp()) !== 'gate'; i++) { const q = page.locator('.gcard.ask .opt:not([disabled])'); if (await q.count()) await q.first().click().catch(() => {}); await sleep(80); }
  await say(page, 'Make it purple'); await sleep(200); const hint = (await appFull(page)).chat.slice(-1)[0].text, still = await gateUp();
  await say(page, 'looks good'); r = await drive(page); a = r.a;
  check('approval: typing something else gets directions, typing an approval continues the build', /Approve to continue, or stop here/.test(hint) && still === 'gate' && a.status === 'ready' && a.line.research.approved && a.reviews.security && a.reviews.security.status === 'ok', [hint, still, a.status, a.line.research]);
  await sleep(600); await page.reload(); await page.waitForSelector('.work-head'); await view(page, 'Build'); await page.waitForSelector('.react-flow .fl-review', { timeout: 20000 }); await sleep(400); a = await appFull(page);
  check('after a reload the app still has its workflow, its review and the review step on the canvas', a.flow.reviewers.join() === 'security' && a.flow.approve.research === true && a.reviews.security.status === 'ok' && a.reviews.security.f.length >= 1 && await page.locator('.fl-review').count() === 1 && /The build waits here|You approved this/.test(await page.locator('.fl-approval').first().innerText()), [a.flow, a.reviews]);
  await sleep(500); check('the workflow and the default are saved with the workspace', (await st(page, () => { const raw = JSON.parse(window.__turnkeyStorage.get('state') || '{}'); return Object.keys(raw.flows || {}).length === 1 && Object.values(raw.apps || {}).every((x) => x.flow && Array.isArray(x.flow.reviewers)); })), saved);
  await ctx.close();

  // ----- G. without the canvas library the plain line still leads to the settings -----
  const nb = await newPage(browser, { init: NO_CANVAS }), np = nb.page; await enter(np, url); await buildTpl(np, 'leave'); await sleep(400);
  check('fallback: with React Flow blocked, the plain line has the Customize button', await np.locator('.react-flow').count() === 0 && await np.locator('.line-wrap [data-tour="customize"]').count() === 1);
  await np.locator('.line-wrap [data-tour="customize"]').click(); await np.waitForSelector('.dialog.wf'); await np.locator('.dialog.wf label.switch:has(#wf-review-backend)').click(); await np.getByRole('button', { name: 'Done' }).click(); a = await waitFree(np);
  check('fallback: the settings work there too, and the review ran', a.flow.reviewers.join() === 'security' && a.reviews.security && a.reviews.security.status === 'ok' && /Security review after Backend/.test(await np.locator('.line-wrap').innerText()), [a.flow, a.reviews]);
  await nb.ctx.close();

  // ----- H. on a phone -----
  const ph = await newPage(browser, { viewport: { width: 390, height: 844 } }), pp = ph.page; await enter(pp, url); await buildTpl(pp, 'leave'); await sleep(900);
  await pp.evaluate(() => { const i = window.__formwork.flow().inst, v = i.getViewport(); i.setViewport({ x: v.x, y: -190, zoom: v.zoom }); }); await sleep(300); // pan down to the first gate, the way a thumb would
  await pp.locator('.fl-gate').nth(0).locator('.fl-add').click(); await pp.waitForSelector('.dialog.addstep'); await sleep(250); const fits = await pp.evaluate(() => { const r = document.querySelector('.dialog.addstep').getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth + 1; }); await shot(pp, 'c13b-phone-add-step'); await pp.locator('#as-approval').click(); await sleep(300); a = await appFull(pp);
  await pp.evaluate(() => { const i = window.__formwork.flow().inst, v = i.getViewport(); i.setViewport({ x: v.x, y: 12, zoom: v.zoom }); }); await sleep(300);
  check('phone: the plus on a gate opens the add-step dialog, which fits the screen and works', a.flow.approve.research === true && fits, [a.flow, fits]);
  await pp.locator('.fl-node.station').nth(0).locator('.fl-opt').click(); await pp.waitForSelector('.sheet .cust'); await sleep(350);
  check('phone: the options button opens the Customize tab in the bottom sheet', (await pp.locator('.sheet .tab.on').innerText()).includes('Customize') && await pp.evaluate(() => { const s = document.querySelector('.sheet'); return s.scrollWidth <= s.clientWidth + 1; }), await pp.locator('.sheet .tab.on').innerText());
  await shot(pp, 'c14-phone-customize');
  await pp.locator('.sheet .cust .btn', { hasText: 'All settings' }).click(); await pp.waitForSelector('.dialog.wf'); await sleep(250);
  check('phone: the settings dialog fits the screen and stacks its table', await pp.evaluate(() => { const d = document.querySelector('.dialog.wf'), r = d.getBoundingClientRect(), b = d.querySelector('.dbody'); return r.left >= 0 && r.right <= window.innerWidth && b.scrollWidth <= b.clientWidth + 1 && getComputedStyle(d.querySelector('thead')).display === 'none'; }), await pp.evaluate(() => { const d = document.querySelector('.dialog.wf'), r = d.getBoundingClientRect(), b = d.querySelector('.dbody'); return [r.left, r.right, window.innerWidth, b.scrollWidth, b.clientWidth]; }));
  await shot(pp, 'c15-phone-dialog'); await ph.ctx.close();
}

/* ---------- round 6: plain navigation, the Tester's repair loop, agent rooms, an agent step that changes the schema, releases, the app on its own ---------- */
async function flowRound6(browser, url) {
  const { ctx, page } = await newPage(browser); await enter(page, url); let a;
  check('home: four plain steps, and six business examples with the bidding desk among them', await page.locator('.how li').count() === 4 && await page.locator('.tpl').count() === 9 && await page.locator('[data-tpl="biddesk"]').count() === 1, await page.locator('.tpl').count());
  await buildTpl(page, 'biddesk'); a = await appFull(page);
  check('workspace: three plain steps and one Details tab', (await page.locator('.views .tab').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim().split(' ')[0]).join() === 'Build,App,Release,Details', await page.locator('.views .tab').allInnerTexts());
  check('bidding desk: every station passed first time, with four tables and its own team of agents', a.status === 'ready' && ['research', 'database', 'backend', 'views', 'screens', 'walkthrough'].every((k) => a.line[k].s === 'ok' && a.line[k].n === 1) && Object.keys(a.cols).join() === 'tenders,score_lines,price_options,risks', [a.status, a.line]);
  check('Tester: six saved cases; one fails, Backend repairs the rule as a checked change, the second run passes', a.qa && a.qa.by === 'saved' && a.cases === 6 && JSON.stringify(a.qa.rounds) === '[[1,1],[0,0]]' && a.tests.failed === 0 && a.tests.fresh && !/tenders:[^ ]*bid_manager/.test(a.del) && /tenders:director/.test(a.del), [a.qa, a.del, a.tests]);
  const talk = await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); return s.apps[t.app].chat.filter((m) => m.from === 'tester' || m.from === 'backend').map((m) => m.from + ': ' + m.text); });
  check('Tester: the failure, the repair and the result are told in chat', talk.some((t) => /^tester: 1 of \d+ tests fails: “A bid manager cannot remove a tender”/.test(t)) && talk.some((t) => /^backend: Repaired: Stop Bid manager from deleting tenders/.test(t)) && talk.some((t) => /^tester: All \d+ tests pass after 1 repair: 6 cases I wrote/.test(t)), talk);
  await page.waitForSelector('.react-flow .fl-gate'); await sleep(400);
  check('canvas: the Tests station reports the repair and its gate says ready to release', /1 repair sent back and applied/.test(await page.locator('.fl-node.station').nth(6).innerText()) && /Ready to release/.test(await page.locator('.fl-gate').nth(6).innerText()) && /Draft · not released yet/.test(await page.locator('.fl-ready').innerText()), [await page.locator('.fl-node.station').nth(6).innerText(), await page.locator('.fl-gate').nth(6).innerText()]);
  await page.locator('.fl-node.station').nth(6).click(); await sleep(300); const tp = await page.locator('.review-insp').innerText();
  check('inspector: the Tester panel lists the cases, both runs and the deliberate slip', /6 test cases/.test(tp) && /Run 1[\s\S]*1 of \d+ failed[\s\S]*Backend repaired it[\s\S]*Run 2[\s\S]*all \d+ passed/.test(tp) && /keeps one slip on purpose/.test(tp) && await page.locator('.qa-case').count() === 6 && await page.locator('.qa-case.bad').count() === 0, tp.slice(0, 600)); await shot(page, 'r6-01-tester');
  await view(page, 'Tests'); await page.waitForSelector('.tests-view'); check('details: the test view lists the Tester\'s cases as a suite of their own', await page.locator('.subtabs .tab').count() === 4 && /Test cases/.test(await page.locator('.tests-view').innerText()) && await page.locator('.tests-view .suite').count() === 9, await page.locator('.tests-view .suite').count());

  // ----- the bid room: a view picked for what the agents produce -----
  const board = await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]), d = s.apps[t.app].def; return { by: d.board.by, layouts: d.board.panels.map((p) => p.layout).join(), verdict: d.board.verdict }; });
  check('the View advisor picked the room: a scorecard, options side by side, and groups', board.by === 'views' && board.layouts === 'scores,options,groups' && board.verdict.pick === 'recommendation' && board.verdict.meter === 'win_chance', board);
  await view(page, 'App'); await page.locator('.persona-btn').first().click(); await land(page); await page.waitForSelector('.team.room');
  await page.locator('.team-start .chip', { hasText: 'Port fleet tracking' }).click(); await sleep(60); await page.locator('.team-start button[type=submit]').click(); await page.waitForSelector('.team-log .gcard.ask', { timeout: 20000 });
  check('bid room: the board fills in while the agents work, and the run pauses for a person before the verdict', await page.locator('.bdp-scores .bd-srows li').count() === 5 && await page.locator('.bdp-options .bd-opt').count() === 3 && await page.locator('.verdict').count() === 0, [await page.locator('.bdp-scores .bd-srows li').count(), await page.locator('.bdp-options .bd-opt').count()]);
  await page.fill('.team-log .gcard.ask input', 'Ask for a site visit first'); await page.locator('.team-log .gcard.ask .btn', { hasText: 'Add' }).click(); await sleep(100); await page.locator('.team-log .gcard.ask .btn.primary').click(); await waitTeam(page); await sleep(300);
  const room = (await page.locator('.team-log').innerText()).replace(/\s+/g, ' ');
  check('bid room: weighted score, three prices with the recommended one marked, points in groups, and the verdict on top', /72 out of 100/.test(room) && await page.locator('.bdp-options .bd-opt.best').count() === 1 && /Recommended[\s\S]*Balanced/.test(await page.locator('.bd-opt.best').innerText()) && /From the team: Ask for a site visit first/.test(room) && /Bid with conditions/.test(await page.locator('.verdict').innerText()) && /48/.test(await page.locator('.verdict .ring').textContent()) && (await page.locator('.team-log .badge').first().innerText()).trim() === 'Awaiting approval', room.slice(0, 500)); await shot(page, 'r6-02-bid-room');
  check('bid room: a bid manager is not offered the approval', await page.locator('.verdict .btn', { hasText: 'Approve the bid' }).count() === 0);
  await page.selectOption('select[aria-label="Preview as"]', { label: 'Omar Farooq · Sales director' }); await sleep(250); await nav(page, 'Bid room'); await page.waitForSelector('.verdict');
  await page.locator('.verdict .btn', { hasText: 'Approve the bid' }).click(); await sleep(250);
  check('bid room: the director approves from the same page, through the workflow', (await page.locator('.team-log .badge').first().innerText()).trim() === 'Approved to bid', await page.locator('.team-log .badge').first().innerText());

  // ----- a step from the library that changes the schema: the Normaliser -----
  await page.locator('.work-head .btn', { hasText: 'Chat' }).click().catch(() => {}); await sleep(150); const before = await appFull(page);
  await say(page, 'Add a normalise step'); a = await waitFree(page); const sec = await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]), c = s.apps[t.app].def.tables[0].columns.find((x) => x.name === 'sector'); return { type: c.type, options: c.options, v: window.__formwork.sql(t.app, 'SELECT DISTINCT sector AS v FROM tenders ORDER BY 1').map((r) => r.v) }; });
  check('Normaliser: it finds free text that repeats and turns it into a choice, as a checked change', a.flow.reviewers.includes('normalize') && a.run.kind === 'step' && a.reviews.normalize.f.length === 1 && a.reviews.normalize.f[0].state === 'applied' && sec.type === 'select' && sec.options.join() === 'transport,health,energy' && sec.v.join() === 'energy,health,transport' && a.tests.failed === 0 && a.tests.fresh && a.rows === before.rows, [a.reviews.normalize, sec, a.tests]);
  await say(page, 'Add a board of tenders by sector'); a = await waitFree(page);
  check('after that the field can drive a view: a board of tenders by sector is added', a.run.kind === 'change' && a.run.status === 'ok' && a.screens === before.screens + 1 && a.tests.failed === 0, [a.run, a.screens]);

  // ----- releases -----
  await view(page, 'Release'); await page.waitForSelector('.release');
  check('release: a built app is a draft until it is released, and the notes are drafted for it', /Draft · not released yet/.test(await page.locator('#rel-state').innerText()) && /^First release: \d+ pages for 3 roles, with a team of 3 agents inside\./.test(await page.inputValue('#rel-notes')) && /Release version 1\.0/.test(await page.locator('#rel-go').innerText()) && await page.locator('#rel-share').isDisabled(), await page.inputValue('#rel-notes'));
  await page.locator('#rel-go').click(); await page.waitForFunction(() => /Version 1\.0 · up to date/.test((document.getElementById('rel-state') || {}).innerText || '')); a = await appFull(page);
  check('release 1.0: every test ran first, the version is kept, and the app says so', a.rel.join() === '1.0' && !a.dirty && /Version 1\.0/.test(await page.locator('#app-state').innerText()) && a.chat.some((m) => m.card === 'released') && await page.locator('.rel-item').count() === 1, [a.rel, a.dirty]); await shot(page, 'r6-03-release');
  // ----- the deliverable: one document from the app's state, in each format -----
  const xtmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tk-export-')), grab = async (id) => { const [d] = await Promise.all([page.waitForEvent('download'), page.locator(id).click()]); const p = path.join(xtmp, d.suggestedFilename()); await d.saveAs(p); return { name: d.suggestedFilename(), buf: fs.readFileSync(p) }; };
  await page.locator('#rel-export').scrollIntoViewIfNeeded(); await shot(page, 'r6-03b-export');
  const xmd = await grab('#exp-md'), md = xmd.buf.toString('utf8');
  check('export: the document downloads as Markdown with the brief, tables, tests, who made what and the run timeline', /-deliverable\.md$/.test(xmd.name) && /^# .+ · deliverable/.test(md) && /## Brief/.test(md) && /CREATE TABLE "tenders"/.test(md) && /## Who made what/.test(md) && /\| Research \| Researcher \| Brief \|/.test(md) && /## Tests/.test(md) && /## Run timeline/.test(md) && /## Versions/.test(md), [xmd.name, md.slice(0, 160)]);
  const xhtml = await grab('#exp-html'), html = xhtml.buf.toString('utf8');
  check('export: the printable page downloads as HTML with print styles and real tables', /-deliverable\.html$/.test(xhtml.name) && /^<!doctype html>/.test(html) && /@media print/.test(html) && /<h2 id="who-made-what">/.test(html) && /<table>/.test(html) && !/<script/i.test(html), xhtml.name);
  await page.locator('#exp-pdf').click(); await page.waitForFunction(() => { const f = document.getElementById('tk-print-frame'); return !!(f && f.contentDocument && /Who made what/.test(f.contentDocument.body.innerText)); }, null, { timeout: 5000 }).catch(() => {});
  check('export: PDF prints the same document from a hidden frame', await page.evaluate(() => { const f = document.getElementById('tk-print-frame'); return !!(f && f.contentDocument && /@media print/.test(f.contentDocument.head.innerHTML) && /Run timeline/.test(f.contentDocument.body.innerText)); }));
  const xdb = await grab('#exp-sqlite');
  check('export: the database downloads as a SQLite file', /\.sqlite$/.test(xdb.name) && xdb.buf.subarray(0, 15).toString() === 'SQLite format 3', xdb.name);
  const xzip = await grab('#exp-zip'), zs = xzip.buf.toString('latin1');
  check('export: the zip holds the document, the page, the database and the definition', /-build-pack\.zip$/.test(xzip.name) && xzip.buf.subarray(0, 4).toString('hex') === '504b0304' && /\/deliverable\.md/.test(zs) && /\/deliverable\.html/.test(zs) && /\/app\.json/.test(zs) && /\/README\.txt/.test(zs) && zs.includes('SQLite format 3') && xzip.buf.subarray(-22, -18).toString('hex') === '504b0506', xzip.name);
  await page.locator('#rel-share').click(); await page.waitForSelector('.dialog.share'); await page.waitForFunction(() => /#app=1\./.test((document.getElementById('sh-link') || {}).value || '')); const link10 = await page.inputValue('#sh-link'); await page.waitForFunction(() => /^https?:\/\/[^/]+\/[a-z0-9-]+$/.test((document.getElementById('sh-short') || {}).value || ''), null, { timeout: 15000 }).catch(() => {}); const short10 = await page.inputValue('#sh-short').catch(() => '');
  check('Share also gives a short link named after the app', /\/biddesk$/.test(short10), short10);
  check('share: the link carries version 1.0 and the dialog shows the app\'s own icon', /Version 1\.0/.test(await page.locator('#sh-ver').innerText()) && await page.locator('.dialog.share .applogo svg').count() === 1, await page.locator('#sh-ver').innerText()); await page.locator('.dialog .dhead .btn[aria-label="Close"]').click(); await sleep(150);
  await say(page, 'Add a notes field to tenders'); a = await waitFree(page);
  check('a change after a release goes into a draft; the released version stays what people get', a.dirty && a.rel.join() === '1.0' && /Draft · 1\.0 is out/.test(await page.locator('#app-state').innerText()) && a.cols.tenders.includes('notes'), [a.dirty, a.rel]);
  await view(page, 'Release'); await sleep(200); const notes = await page.inputValue('#rel-notes');
  check('the next release is suggested as new features, 1.1, with notes written from the change', /Added Notes \(long text\) to Tenders/.test(notes) && /Release version 1\.1$/.test((await page.locator('#rel-go').innerText()).trim()) && await page.locator('.rel-form .seg button.on').innerText() === 'New features · 1.1', [notes, await page.locator('#rel-go').innerText()]);
  await page.locator('#rel-share').click(); await page.waitForSelector('.dialog.share'); await page.waitForFunction(() => /#app=1\./.test((document.getElementById('sh-link') || {}).value || ''));
  check('sharing a draft still sends the released version, and says so', /your draft changes are not in this link/.test(await page.locator('#sh-ver').innerText()) && (await page.inputValue('#sh-link')).length > 2000, await page.locator('#sh-ver').innerText()); await page.locator('.dialog .dhead .btn[aria-label="Close"]').click(); await sleep(150);
  await page.locator('#rel-go').click(); await page.waitForFunction(() => /Version 1\.1 · up to date/.test((document.getElementById('rel-state') || {}).innerText || '')); a = await appFull(page);
  await page.locator('#rel-share').click(); await page.waitForSelector('.dialog.share'); await page.waitForFunction(() => /#app=1\./.test((document.getElementById('sh-link') || {}).value || '')); const link11 = await page.inputValue('#sh-link'); await page.locator('.dialog .dhead .btn[aria-label="Close"]').click(); await sleep(150);
  check('release 1.1: two versions in the history, newest first, each with its notes', a.rel.join() === '1.1,1.0' && !a.dirty && await page.locator('.rel-item').count() === 2 && /Added Notes/.test(await page.locator('.rel-item').first().innerText()) && link11 !== link10, a.rel);
  const lg0 = await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); return JSON.stringify(window.__formwork.wf.logo(s.apps[t.app])); });
  await page.locator('#rel-logo-next').click(); await sleep(200); a = await appFull(page); const lg1 = await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); return JSON.stringify(window.__formwork.wf.logo(s.apps[t.app])); });
  check('icon: designed as data by the UI agent (a shield with a spark here); another design changes it and makes a draft', /"glyph":"briefcase","shape":"shield","fill":"gradient","mark":"spark"/.test(lg0) && lg1 !== lg0 && a.dirty && /Your pick/.test(await page.locator('#rel-logo-text').innerText()) && /Fixes · 1\.1\.1/.test(await page.locator('.rel-form .seg button.on').innerText()), [lg0, lg1]);
  await page.locator('.rel-item').nth(1).locator('.btn', { hasText: 'Go back to this' }).click(); await page.waitForSelector('.dialog .dfoot .btn'); await page.locator('.dialog .dfoot .btn').last().click(); await sleep(900); a = await appFull(page);
  check('going back to 1.0 restores that version as the draft: the later field is gone, the tests pass, the history stays', !a.cols.tenders.includes('notes') && a.tests.failed === 0 && a.rel.join() === '1.1,1.0' && a.dirty && a.status === 'ready', [a.cols.tenders, a.tests, a.rel]);

  // ----- the app on its own: link, install, update that keeps the records -----
  const g = await newPage(browser), gp = g.page; await gp.goto(url + '#app=' + link10.split('#app=')[1]); await gp.waitForSelector('.solo .app', { timeout: 30000 }); await sleep(300);
  const solo = await st(gp, () => { const s = window.__formwork.state(), x = Object.values(s.apps).find((y) => y.shared); return { title: document.title, icon: !!document.querySelector('link[data-app-icon]'), ver: x.shared.ver, uid: !!x.shared.uid, cases: (x.def.cases || []).length, board: x.def.board ? x.def.board.panels.map((p) => p.layout).join() : '', builder: document.querySelectorAll('.titlebar, .work-head, .home').length }; });
  check('a link opens the app alone: its own title and icon, version 1.0, its room and its test cases, no builder', solo.title === 'BidDesk' && solo.icon && solo.ver === '1.0' && solo.uid && solo.cases === 6 && solo.board === 'scores,options,groups' && solo.builder === 0, solo);
  check('the app offers to install itself', await gp.locator('#solo-install').count() === 1 && /Install BidDesk/.test(await gp.locator('.solo-note.install').innerText()));
  await gp.locator('#solo-install').click(); await gp.waitForSelector('.dialog'); const inst = await gp.locator('.dialog').innerText(); await gp.locator('#inst-go').click(); await sleep(250);
  check('install: the dialog shows this app, its version and its icon, and says how this browser installs it', /Install BidDesk/.test(inst) && /Version 1\.0 · its own app, not Turnkey/.test(inst) && /Simulated here|browser menu|Safari|Edge|confirm/.test(inst) && await gp.locator('#solo-install').count() === 0 && await st(gp, () => !!Object.values(window.__formwork.state().apps).find((y) => y.shared).installed), inst.slice(0, 300)); await shot(gp, 'r6-04-solo');
  await st(gp, () => { const s = window.__formwork.state(), x = Object.values(s.apps).find((y) => y.shared); window.__formwork.sql(x.id, 'UPDATE "tenders" SET "client" = \'Changed by the person who installed it\' WHERE "id" = 1'); window.__formwork.sql(x.id, 'DELETE FROM "risks" WHERE "id" > 3'); window.__formwork.save(); }); await sleep(900);
  await gp.goto('about:blank'); await gp.goto(url + '#app=' + link11.split('#app=')[1]); await gp.waitForSelector('.solo .app', { timeout: 30000 }); await sleep(400);
  const up = await st(gp, () => { const s = window.__formwork.state(), all = Object.values(s.apps).filter((y) => y.shared), x = all[0]; return { n: all.length, ver: x.shared.ver, updated: x.shared.updated, installed: !!x.installed, notes: x.shared.notes, cols: x.def.tables[0].columns.map((c) => c.name).includes('notes'), client: window.__formwork.sql(x.id, 'SELECT "client" AS c FROM "tenders" WHERE "id" = 1')[0].c, risks: window.__formwork.sql(x.id, 'SELECT COUNT(*) AS n FROM "risks"')[0].n }; });
  check('opening the link of version 1.1 updates the installed copy and keeps its records', up.n === 1 && up.ver === '1.1' && up.updated && up.updated.from === '1.0' && up.updated.kept > 10 && up.installed && up.cols && up.client === 'Changed by the person who installed it' && up.risks === 3 && /Added Notes/.test(up.notes.join(' ')), up);
  check('the app says what happened: updated, records kept, what is new', /Updated to version 1\.1 from 1\.0\. Your \d+ records were kept\. New: Added Notes/.test((await gp.locator('.solo-note.ok').innerText()).replace(/\s+/g, ' ')), await gp.locator('.solo-note.ok').innerText());
  await g.ctx.close();

  // ----- the three quest rooms -----
  await page.locator('.brand').click(); await page.waitForSelector('.home'); await page.getByRole('button', { name: 'Build all three' }).click();
  await page.waitForFunction(() => { const s = window.__formwork.state(), q = Object.values(s.apps).filter((x) => ['factcheck', 'priorart', 'debate'].includes(x.tpl)); return q.length === 3 && q.every((x) => x.status === 'ready') && !Object.keys(window.__formwork.wf.runs()).length; }, null, { timeout: 90000 }); await sleep(300);
  const rooms = await st(page, () => Object.values(window.__formwork.state().apps).filter((x) => x.def.board).map((x) => x.tpl + ':' + x.def.board.by + ':' + x.def.board.panels.map((p) => p.layout + (p.children ? '+' + p.children.table : '')).join('|') + ':' + x.def.screens.find((sc) => sc.type === 'agents').name).sort());
  check('each quest gets a room laid out for what its agents produce', rooms.join(' ; ') === 'biddesk:views:scores|options|groups:Bid room ; debate:views:versus|groups:Debate room ; factcheck:views:list+evidence:Check room ; priorart:views:list+findings|groups:Scout room', rooms);
  await page.locator('.wtab', { hasText: 'Second Opinion' }).click(); await page.waitForSelector('.work-head'); await view(page, 'App'); await sleep(150); if (await page.locator('.persona-btn').count()) await page.locator('.persona-btn').first().click(); await land(page); await page.waitForSelector('.team.room');
  await page.locator('.team-start .chip', { hasText: 'A free tier' }).click(); await sleep(60); await page.locator('.team-start button[type=submit]').click(); await page.waitForSelector('.team-log .gcard.ask', { timeout: 20000 });
  // the team waits for the person here, so it is still running: a workflow edit now must not re-run the line under it
  const worker = (by) => st(page, (b) => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); window.__formwork.wf.edit(s.apps[t.app], [{ tool: 'set_worker', args: { station: 'screens', by: b } }]); }, by);
  const runN = (await appFull(page)).run.n; await worker('rules'); await sleep(6500);
  const held = await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); return { runs: Object.keys(window.__formwork.wf.runs()), queued: !!window.__formwork.wf.queued(t.app), team: window.__formwork.teams()[t.app].status }; });
  check('a re-run after a workflow edit waits while the app\'s own agents are running, instead of rebuilding under them', held.runs.length === 0 && held.queued && held.team === 'running' && (await appFull(page)).run.n === runN, held);
  // nor may an undo swap the definition and database out from under the team
  await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); window.__formwork.wf.cancelRerun(t.app); }); await sleep(1500);
  await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press('Control+z'); await sleep(400);
  const undone = await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); return { by: s.apps[t.app].flow.by.screens || null, team: window.__formwork.teams()[t.app].status }; });
  check('undo waits while the app\'s own agents are running', undone.by === 'rules' && undone.team === 'running', undone);
  await worker('agent'); await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); window.__formwork.wf.cancelRerun(t.app); });
  await page.locator('.team-log .gcard.ask .btn.primary').click(); await waitTeam(page); await sleep(300);
  const deb = (await page.locator('.team-log').innerText()).replace(/\s+/g, ' ');
  check('debate room: two sides face to face with the weight of each, answers linked to the points they answer, the Moderator\'s notes in groups, the leaning on top', await page.locator('.bd-versus .bd-side').count() === 2 && await page.locator('.bd-balance .bd-bal').count() === 2 && /For 7/.test(await page.locator('.bd-balance').innerText()) && await page.locator('.bd-reply').count() === 3 && await page.locator('.bdp-groups .bd-group').count() === 4 && /Leaning For/.test((await page.locator('.verdict').innerText()).replace(/\s+/g, ' ')), deb.slice(0, 400)); await shot(page, 'r6-05-debate-room');
  await page.reload(); await page.waitForSelector('.work-head'); await sleep(300);
  check('a finished app reopens on the app itself, not on its build', await page.locator('.views .tab.on').innerText() === 'App' || /^App/.test(await page.locator('.views .tab.on').innerText()), await page.locator('.views .tab.on').innerText());
  await ctx.close();
  await samplesChecks(browser, url);
}
/* ---------- The two more business apps on Home: a grant desk with its own agent team, and purchase requests ---------- */
async function samplesChecks(browser, url) {
  const { ctx, page } = await newPage(browser); await enter(page, url); let a;
  check('home: the grant desk and purchase requests are under Business apps', await page.locator('[data-tpl="grants"]').count() === 1 && await page.locator('[data-tpl="purchasing"]').count() === 1 && await page.locator('.tpl').count() === 9);
  await page.fill('#home-prompt', 'a community foundation that reviews grant applications'); await page.locator('.prompt .btn.primary').click(); await page.waitForFunction(() => { const s = window.__formwork.state(), t = (s.tabs[s.session] || []).find((x) => x.id === s.active[s.session]); return t && t.app; }); await waitReady(page); a = await appFull(page);
  check('Demo: a sentence about grants is built from the grant desk\'s saved build', a.tpl === 'grants' && a.mode === 'demo', [a.tpl, a.mode]);
  check('grant desk: every station passed first time, with four tables and its own team of three agents', a.status === 'ready' && ['research', 'database', 'backend', 'views', 'screens', 'walkthrough'].every((k) => a.line[k].s === 'ok' && a.line[k].n === 1) && Object.keys(a.cols).join() === 'applications,score_lines,award_options,checks' && a.tests.failed === 0 && a.tests.fresh, [a.status, a.line, a.tests]);
  await view(page, 'App'); await page.locator('.persona-btn').first().click(); await land(page); await page.waitForSelector('.team.room');
  await page.locator('.team-start .chip', { hasText: 'Reading club for care homes' }).click(); await sleep(60); await page.locator('.team-start button[type=submit]').click(); await page.waitForSelector('.team-log .gcard.ask', { timeout: 20000 });
  check('review room: scores and award options fill in, and the run pauses for a person before Due diligence', await page.locator('.bdp-scores .bd-srows li').count() === 5 && await page.locator('.bdp-options .bd-opt').count() === 3 && await page.locator('.verdict').count() === 0, [await page.locator('.bdp-scores .bd-srows li').count(), await page.locator('.bdp-options .bd-opt').count()]);
  await page.fill('.team-log .gcard.ask input', 'Ask for a safeguarding policy'); await page.locator('.team-log .gcard.ask .btn', { hasText: 'Add' }).click(); await sleep(100); await page.locator('.team-log .gcard.ask .btn.primary').click(); await waitTeam(page); await sleep(300);
  const room = (await page.locator('.team-log').innerText()).replace(/\s+/g, ' ');
  check('review room: weighted score, the full request recommended, the condition from the team, and the verdict on top', /80 out of 100/.test(room) && await page.locator('.bdp-options .bd-opt.best').count() === 1 && /Full request/.test(await page.locator('.bd-opt.best').innerText()) && /From the team: Ask for a safeguarding policy/.test(room) && /Fund/.test(await page.locator('.verdict').innerText()) && /82/.test(await page.locator('.verdict .ring').textContent()) && (await page.locator('.team-log .badge').first().innerText()).trim() === 'Awaiting decision', room.slice(0, 900));
  check('review room: a programme officer is not offered the award', await page.locator('.verdict .btn', { hasText: 'Award the grant' }).count() === 0);
  await page.selectOption('select[aria-label="Preview as"]', { label: 'Rukhsana Baig · Board chair' }); await sleep(250); await nav(page, 'Review room'); await page.waitForSelector('.verdict');
  await page.locator('.verdict .btn', { hasText: 'Award the grant' }).click(); await sleep(250);
  check('review room: the board chair awards the grant from the same page, through the workflow', (await page.locator('.team-log .badge').first().innerText()).trim() === 'Awarded', await page.locator('.team-log .badge').first().innerText());
  await page.locator('.brand').click(); await page.waitForSelector('.home'); await buildTpl(page, 'purchasing'); a = await appFull(page);
  const pr = await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]), d = s.apps[t.app].def; return { confirm: d.process.transitions.find((x) => x.id === 'confirm_delivery').roles.join(), approve: d.process.transitions.find((x) => x.id === 'approve').roles.join(), order: d.process.transitions.find((x) => x.id === 'place_order').roles.join(), mine: d.access.purchase_requests.requester.list, budgets: d.access.budgets.requester.list }; });
  check('purchase requests: every station passed first time, with three tables, and the tests pass', a.status === 'ready' && ['research', 'database', 'backend', 'views', 'screens', 'walkthrough'].every((k) => a.line[k].s === 'ok' && a.line[k].n === 1) && Object.keys(a.cols).join() === 'purchase_requests,suppliers,budgets' && a.tests.failed === 0 && a.tests.fresh, [a.status, a.line, a.tests]);
  check('purchase requests: only the budget holder approves, only the buyer orders, staff see only their own requests, and the answer let the person who asked confirm delivery', pr.approve === 'approver' && pr.order === 'buyer' && pr.mine === 'own' && pr.budgets === 'none' && pr.confirm === 'requester,buyer', pr);
  await ctx.close();
}
/* ---------- What only React can get wrong: warnings, carets, handlers fired twice, focus, the other pages ---------- */
// Counts how often a handler that was added straight to a form field for its `change` event runs. NativeField
// adds `onChange` that way, so a number above one per action means a handler fired twice.
const COUNT_CHANGES = `(() => { window.__changeCalls = 0; const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if (type === 'change' && typeof fn === 'function' && this instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(this.tagName)) {
      const wrapped = function () { window.__changeCalls++; return fn.apply(this, arguments); };
      return add.call(this, type, wrapped, opts);
    }
    return add.call(this, type, fn, opts);
  }; })();`;
async function flowReact(browser, url) {
  const { ctx, page } = await newPage(browser, { init: COUNT_CHANGES });
  const noisy = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') noisy.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', (e) => noisy.push('pageerror: ' + String(e.message || e).slice(0, 300)));
  await enter(page, url);

  // typing in the middle of a text field keeps the caret where it was
  const box = page.locator('#home-prompt'); await box.click(); await page.keyboard.type('book a patient');
  await page.keyboard.press('Home'); for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.keyboard.type('X'); await sleep(60);
  const c1 = await st(page, () => { const e = document.getElementById('home-prompt'); return { v: e.value, s: e.selectionStart, e: e.selectionEnd, focus: document.activeElement === e }; });
  check('typing in the middle of a text field puts the letter there and keeps the caret after it', c1.v === 'bookX a patient' && c1.s === 5 && c1.e === 5 && c1.focus, c1);
  await page.keyboard.type('YZ'); await sleep(60);
  const c2 = await st(page, () => { const e = document.getElementById('home-prompt'); return { v: e.value, s: e.selectionStart, focus: document.activeElement === e }; });
  check('several letters in a row keep landing at the caret, and the field keeps focus', c2.v === 'bookXYZ a patient' && c2.s === 7 && c2.focus, c2);
  await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace'); await sleep(60);
  check('clearing the field empties it', (await box.inputValue()) === '');

  // a select and a checkbox switch fire their handlers once
  await buildTpl(page, 'clinic'); await sleep(500);
  await page.locator('[data-tour="share"]').click(); await page.waitForSelector('.dialog.share');
  const f = await st(page, () => { const d = document.querySelector('.dialog.share'); const a = document.activeElement; return { inside: !!a && d.contains(a), tag: a && a.tagName }; });
  check('when a dialog opens, focus is inside it', f.inside, f);
  await page.locator('#sh-release').click(); await page.waitForSelector('#sh-as');
  await st(page, () => { window.__changeCalls = 0; });
  await page.selectOption('#sh-as', { index: 2 }); await sleep(200);
  const sel = await st(page, () => ({ calls: window.__changeCalls, v: document.getElementById('sh-as').value }));
  check('choosing from a select runs its handler once, and the field shows the choice', sel.calls === 1 && sel.v !== '', sel);
  await page.focus('#sh-as'); await page.keyboard.press('Escape'); await sleep(250); // the Release button that had focus is gone from the page, so focus goes back into the dialog first
  check('Escape closes the dialog', await page.locator('.dialog.share').count() === 0);
  await page.locator('[data-tour="share"]').click(); await page.waitForSelector('.dialog.share'); await page.locator('.dialog .dhead .btn').click(); await sleep(150);
  check('the Close button closes it too, and a dialog can be opened again', await page.locator('.dialog').count() === 0);
  await st(page, () => { window.__changeCalls = 0; });
  const sw = page.locator('#sw-live'), on0 = await sw.isChecked(), dis = await sw.isDisabled();
  if (!dis) { await page.locator('label.switch', { has: sw }).click(); await sleep(250); }
  const swc = await st(page, () => ({ calls: window.__changeCalls, on: document.getElementById('sw-live').checked }));
  check('a switch runs its handler once and shows its new state', !dis && swc.calls === 1 && swc.on !== on0, { dis, swc, on0 });
  await ctx.close();
  const bad = noisy.filter((m) => !/Failed to load resource/.test(m));
  check('no console errors, warnings or page errors through the sign-in, a full clinic build and a dialog', bad.length === 0, bad.slice(0, 5));

  // the first page that was built with React from the start
  const sp = await newPage(browser), spn = [];
  sp.page.on('pageerror', (e) => spn.push(String(e.message || e).slice(0, 300)));
  await sp.page.goto(url + 'spike'); await sp.page.waitForSelector('[data-testid=canvas]', { timeout: 20000 }); await sleep(800);
  check('the /spike page draws its canvas with no page errors', await sp.page.locator('[data-testid=canvas]').count() === 1 && spn.length === 0, spn);
  await sp.ctx.close();

  // the canvas library switched off from outside
  const n2 = await newPage(browser, { init: NO_CANVAS }); await enter(n2.page, url); await buildTpl(n2.page, 'leave'); await sleep(400);
  const fb = await st(n2.page, () => ({ rf: document.querySelectorAll('.react-flow').length, line: document.querySelectorAll('.line > .station').length }));
  check('with window.__turnkeyOptions = { canvas: false } the plain line of stations is drawn', fb.rf === 0 && fb.line === 6, fb);
  await n2.ctx.close();
}
// ----- phone and tablet widths, light and dark -----
const SIZES = [{ w: 360, h: 740 }, { w: 390, h: 844 }, { w: 768, h: 1024 }, { w: 1024, h: 768 }];
/** What does not fit the screen: sideways page scroll, things that stick out past the right edge, touch targets under 24px (WCAG 2.5.8). The zoomable workflow canvas is left out: its nodes grow with zoom. */
const fitNow = (page) => st(page, () => {
  const W = innerWidth, H = innerHeight;
  const shown = (el) => { const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX) && p.getBoundingClientRect().right <= W + 1) return true; return false; };
  const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).filter((c) => !/^(f|r|_)[a-z0-9_]{5,}$/.test(c)).slice(0, 3).join('.') : '') + ' "' + (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24) + '"';
  const out = [], small = [];
  for (const el of document.body.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (!r.width || r.right <= W + 1 || r.left >= W || el.closest('[data-tabster-dummy]') || !shown(el) || clipped(el)) continue; out.push(name(el) + ' right=' + Math.round(r.right)); }
  for (const el of document.querySelectorAll('button, a[href], [role=button], [role=tab], [role=menuitem], [role=switch], select, summary')) {
    if (el.closest('.react-flow, [data-tabster-dummy]') || !shown(el)) continue;
    const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > H) continue;
    if (r.height < 24 || (r.width < 24 && !el.classList.contains('hb-seg'))) small.push(name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); // a bar segment is as wide as its share of the total
  }
  return { scroll: document.documentElement.scrollWidth - W, out: out.slice(0, 6), small: small.slice(0, 6) };
});
const fitsOk = (f) => f.scroll <= 0 && !f.out.length && !f.small.length;
/** Checks one screen in the light theme, then again in the dark one. */
async function fitBoth(page, label) {
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme }); await sleep(150);
    const f = await fitNow(page);
    check(label + ' (' + scheme + '): fits the width, nothing sticks out, every target is at least 24px', fitsOk(f), f);
  }
  await page.emulateMedia({ colorScheme: 'light' });
}
async function flowSizes(browser, url) {
  let link = '', short = '';
  if (process.env.SIZES_ONLY === 'features') return sizesFeatures(browser, url);
  for (const { w, h } of SIZES) {
    const at = w + 'px: ', phone = w <= 640;
    const { ctx, page } = await newPage(browser, { viewport: { width: w, height: h } });
    await page.goto(url); await page.waitForSelector('.ob-card', { timeout: 20000 }); await sleep(200);
    await fitBoth(page, at + 'onboarding');
    await enter(page, url); await fitBoth(page, at + 'home');
    if (phone) {
      const b = await st(page, () => { const r = (s) => document.querySelector(s).getBoundingClientRect(), a = r('.act-launch'), ws = r('.ws-btn'), ac = r('.acct'), bar = r('.titlebar.phone'); const hit = (x, y) => x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom; return { inBar: a.top >= bar.top && a.bottom <= bar.bottom, overWs: hit(a, ws), overAcct: hit(a, ac), w: a.width, h: a.height }; });
      check(at + 'the Agents button sits in the title bar, 44px, and covers neither the workspace switcher nor the account', b.inBar && !b.overWs && !b.overAcct && b.w >= 44 && b.h >= 44, b);
    }
    await buildTpl(page, 'clinic'); await sleep(400);
    await fitBoth(page, at + 'a built app in the builder');
    if (!phone) {
      if (!(await page.locator('.chat').count())) { await page.getByRole('button', { name: 'Chat' }).click(); await page.waitForSelector('.chat'); }
      const top = await st(page, () => ['[data-tour="share"]', '.views .tab'].map((sel) => { const e = document.querySelector(sel), r = e.getBoundingClientRect(), x = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!x && e.contains(x); }));
      check(at + 'with the chat open, the view tabs and Share stay in reach above it', top.every(Boolean), top);
      await page.locator('.views .tab', { hasText: 'App' }).first().click(); await sleep(400); await fitBoth(page, at + 'the App view');
      await page.locator('[data-tour="share"]').click();
    } else {
      await page.locator('.phone-nav .tab-i', { hasText: 'App' }).click(); await page.getByRole('button', { name: 'Open the app' }).click(); await page.waitForSelector('.solo .app');
      if (await page.locator('.persona-btn').count()) await page.locator('.persona-btn').first().click();
      await page.waitForSelector('.app-tabs'); await sleep(300); await fitBoth(page, at + 'the app full screen');
      await page.locator('.app-head .persona').click(); await page.waitForSelector('.sheet'); await page.locator('.sheet-i', { hasText: 'Back to Turnkey' }).click(); await page.waitForSelector('.phone-nav');
      await page.locator('.phone-nav .tab-i', { hasText: 'More' }).click(); await page.waitForSelector('.sheet'); await page.locator('.sheet .sheet-i', { hasText: 'Share by link' }).click();
    }
    await page.waitForSelector('.dialog.share'); await page.locator('#sh-release').click(); await page.waitForFunction(() => /#app=1\./.test((document.getElementById('sh-link') || {}).value || '')); await sleep(200);
    await fitBoth(page, at + 'the share dialog');
    if (!link) { link = await page.inputValue('#sh-link'); await page.waitForFunction(() => /^https?:\/\/[^/]+\/[a-z0-9-]+$/.test((document.getElementById('sh-short') || {}).value || ''), null, { timeout: 15000 }).catch(() => {}); short = await page.inputValue('#sh-short').catch(() => ''); }
    await shot(page, 'sz-' + w + '-share'); await ctx.close();

    // the app on its own: from a link, installed, and from a short link
    const g = await newPage(browser, { viewport: { width: w, height: h } }), gp = g.page;
    await gp.goto(url + '#app=' + link.split('#app=')[1]); await gp.waitForSelector('.solo .app', { timeout: 30000 }); await sleep(300);
    const card = await st(gp, () => { const l = document.querySelector('.app-login'), c = document.querySelector('.login-card'); l.scrollTop = 0; return { card: Math.round(c.getBoundingClientRect().top), box: Math.round(l.getBoundingClientRect().top) }; });
    check(at + 'a shared app\'s sign-in card starts in view, even when it is taller than the screen', card.card >= card.box, card);
    await fitBoth(gp, at + 'a shared app\'s sign-in');
    if (await gp.locator('#solo-install').count()) { await gp.locator('#solo-install').click(); await gp.waitForSelector('.dialog'); await sleep(200); await fitBoth(gp, at + 'the install dialog'); await gp.locator('#inst-go').click(); await sleep(200); }
    await gp.locator('.persona-btn').first().click(); await sleep(400); await fitBoth(gp, at + 'a shared app, signed in');
    const uid = await st(gp, () => { const x = Object.values(window.__formwork.state().apps).find((y) => y.shared); return x && x.shared.uid; });
    await gp.goto('about:blank'); await gp.goto(url + '#app=i.' + uid); await gp.waitForSelector('.solo .app', { timeout: 30000 }); await sleep(300);
    await fitBoth(gp, at + 'the installed app');
    await shot(gp, 'sz-' + w + '-installed'); await g.ctx.close();
    if (short) {
      const s = await newPage(browser, { viewport: { width: w, height: h } });
      await s.page.goto(short.replace(/^https?:\/\/[^/]+\//, url)); await s.page.waitForSelector('.solo .app', { timeout: 30000 }); await sleep(300);
      await fitBoth(s.page, at + 'an app from a short link'); await s.ctx.close();
    }
  }
  check('the share dialog gave a short link to try', !!short, short);
  await sizesFeatures(browser, url);
}
/** The features added after the first phone pass, at each size: the command palette and shortcuts, version history,
 *  the spend panel, the deliverable export, the offline state and an area that failed to draw. */
async function sizesFeatures(browser, url) {
  for (const { w, h } of SIZES) {
    const at = w + 'px: ', phone = w <= 640;
    const { ctx, page } = await newPage(browser, { viewport: { width: w, height: h } });
    await enter(page, url); await buildTpl(page, 'clinic'); await waitIdle(page); await sleep(300);
    const esc = async (sel) => { await page.keyboard.press('Escape'); await page.waitForSelector(sel, { state: 'detached', timeout: 5000 }).catch(() => {}); await sleep(150); };
    const blur = () => page.evaluate(() => document.activeElement && document.activeElement.blur());
    if (phone) {
      const b = await st(page, () => { const r = (e) => e.getBoundingClientRect(), k = [...document.querySelectorAll('.build-sum .kpi')].map(r), seg = r(document.querySelector('.build-bar .seg')), run = r([...document.querySelectorAll('.build-bar > .btn')].pop()); return { tiles: k.length, inside: k.every((x) => x.left >= 0 && x.right <= innerWidth), rows: new Set(k.map((x) => Math.round(x.top))).size, oneRow: Math.abs(seg.top + seg.height / 2 - (run.top + run.height / 2)) < 4 }; });
      check(at + 'the Build view shows all six numbers in view, in two rows, with Run again beside the view switch', b.tiles === 6 && b.inside && b.rows === 2 && b.oneRow, b);
    }
    // the command palette and the shortcuts dialog
    await blur(); await page.keyboard.press('Control+k'); await page.waitForSelector('.dialog.palette .palette-opt'); await sleep(300);
    await fitBoth(page, at + 'the command palette'); await shot(page, 'szf-' + w + '-palette');
    await esc('.dialog.palette');
    await blur(); await page.keyboard.press('Shift+?'); await page.waitForSelector('.dialog'); await sleep(300);
    await fitBoth(page, at + 'the keyboard shortcuts dialog'); await shot(page, 'szf-' + w + '-keys');
    await esc('.dialog');
    // version history, from the More menu (the phone's More sheet)
    if (phone) { await page.locator('.phone-nav .tab-i', { hasText: 'More' }).click(); await page.waitForSelector('.sheet'); await page.locator('.sheet .sheet-i', { hasText: 'Version history' }).click(); }
    else { await page.getByRole('button', { name: 'More actions' }).first().click(); await page.getByRole('menuitem', { name: 'Version history' }).click(); }
    await page.waitForSelector('.dialog.history .hist-row'); await sleep(300);
    check(at + 'Version history opens from the ' + (phone ? 'More sheet' : 'More menu'), true);
    await fitBoth(page, at + 'the version history dialog'); await shot(page, 'szf-' + w + '-history');
    await esc('.dialog.history');
    // the agent panel with what the agents spent
    await page.locator('.act-launch').click(); await page.waitForSelector('.act-panel .act-usage'); await sleep(400);
    const tabs = await st(page, () => [...document.querySelectorAll('.act-panel [role=tab]')].map((e) => { const r = e.getBoundingClientRect(), p = e.closest('.act-panel').getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1 ? '' : e.textContent; }).filter(Boolean));
    check(at + 'every tab in the agent panel can be reached, none is cut off at the edge', !tabs.length, tabs);
    await fitBoth(page, at + 'the agent panel with the spend card'); await shot(page, 'szf-' + w + '-spend');
    await page.locator('.act-panel').getByRole('button', { name: 'Close' }).click(); await page.waitForSelector('.act-panel', { state: 'detached' }); await sleep(200);
    // the deliverable export on the Release screen
    if (phone) await page.locator('.phone-nav .tab-i', { hasText: 'Release' }).click(); else await view(page, 'Release');
    await page.waitForSelector('#rel-export'); await page.locator('#rel-export').scrollIntoViewIfNeeded(); await sleep(300);
    await fitBoth(page, at + 'the Release screen at the export card'); await shot(page, 'szf-' + w + '-export');
    // offline: the title bar and the Build view say so
    if (phone) await page.locator('.phone-nav .tab-i', { hasText: 'Build' }).click(); else await view(page, 'Build');
    await ctx.setOffline(true); await sleep(500);
    if (phone) {
      await page.waitForSelector('.toasts .toast');
      const room = await st(page, async () => { const sc = document.querySelector('.build'); sc.scrollTop = sc.scrollHeight; await new Promise((r) => setTimeout(r, 200)); const kids = [...sc.children].filter((e) => e.getBoundingClientRect().height > 0), last = kids[kids.length - 1].getBoundingClientRect(), toast = document.querySelector('.toasts').getBoundingClientRect(); return { last: Math.round(last.bottom), toasts: Math.round(toast.top) }; });
      check(at + 'scrolled to the end, the last item on the Build view sits above the toasts', room.last <= room.toasts, room);
    }
    await fitBoth(page, at + 'the builder, offline'); await shot(page, 'szf-' + w + '-offline');
    await ctx.setOffline(false); await sleep(400);
    // an area that could not draw shows its message in place, and the rest of the screen still works
    const errs = errors.length; // the errors this break causes on purpose are dropped below
    await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]), a = s.apps[t.app]; window.__szKeep = a.def; a.def = { ...a.def, screens: null, tables: null }; });
    if (phone) await page.locator('.phone-nav .tab-i', { hasText: 'App' }).click(); else await view(page, 'App');
    await page.waitForSelector('[data-area-error]', { timeout: 5000 }).catch(() => {});
    const failed = await page.locator('[data-area-error]').count();
    check(at + 'a part that fails to draw shows its message in place', failed > 0, failed);
    if (failed) { await fitBoth(page, at + 'the message for a part that failed'); await shot(page, 'szf-' + w + '-area-error'); }
    await st(page, () => { const s = window.__formwork.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); s.apps[t.app].def = window.__szKeep; });
    if (failed) { for (let i = 0; i < 4 && (await page.locator('[data-area-error]').count()); i++) { await page.locator('[data-area-error]').getByRole('button', { name: 'Try again' }).first().click(); await sleep(300); } check(at + 'Try again draws the part again once it can', !(await page.locator('[data-area-error]').count())); }
    errors.splice(errs, errors.length - errs, ...errors.slice(errs).filter((e) => !/could not draw|reading 'length'/.test(e)));
    await ctx.close();
  }
}
// ----- undo, redo and version history (src/workspace/history.ts) -----
async function flowHistory(browser, url) {
  const { ctx, page } = await newPage(browser);
  await enter(page, url); await buildTpl(page, 'clinic'); await waitIdle(page);
  const id = (await appState(page)).id;
  const hist = () => st(page, (x) => window.__formwork.history.of(x), id);
  const waitVersions = (n) => page.waitForFunction(([x, k]) => { const h = window.__formwork.history.of(x); return h && h.versions.length >= k; }, [id, n], { timeout: 20000 });
  const cols = () => st(page, (x) => window.__formwork.sql(x, 'PRAGMA table_info("patients")').map((r) => r.name), id);
  const phone = () => st(page, (x) => window.__formwork.sql(x, 'SELECT phone FROM patients ORDER BY id LIMIT 1')[0].phone, id);
  const key = async (combo) => { await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press(combo); await sleep(300); await waitIdle(page); };
  await waitVersions(1);
  let h = await hist();
  check('history: a built app starts its history with one version', h.versions.length === 1 && h.versions[0].kind === 'start' && h.at === 0, h);
  check('history: Undo is off while there is nothing to undo', await page.getByRole('button', { name: 'Undo', exact: true }).isDisabled());

  await view(page, 'Build');
  await say(page, 'Add an insurance provider field to patients'); await waitIdle(page); await waitVersions(2);
  h = await hist();
  check('history: a change from chat is saved as a version, made by the Database agent', h.versions.length === 2 && h.versions[1].by.includes('database') && /insurance/i.test(h.versions[1].what), h.versions[1]);
  await st(page, (x) => window.__formwork.sql(x, "UPDATE patients SET phone = '555-0199' WHERE id = (SELECT MIN(id) FROM patients)"), id);

  await st(page, () => { const F = window.__formwork, s = F.state(), t = s.tabs[s.session].find((x) => x.id === s.active[s.session]); F.wf.edit(s.apps[t.app], [{ tool: 'set_approval', args: { station: 'views', on: true } }]); });
  await waitIdle(page); await waitVersions(3);
  h = await hist();
  check('history: a workflow edit is saved as a version, made by you', h.versions.length === 3 && h.versions[2].by.join() === 'you', h.versions[2]);

  await key('Control+z');
  let a = await st(page, (x) => window.__formwork.state().apps[x].flow.approve, id);
  h = await hist();
  check('undo (Ctrl+Z): the workflow edit is taken back', !a.views && h.at === 1 && h.versions.length === 3, [a, h.at]);
  await key('Control+z');
  a = await appState(page);
  const c1 = await cols();
  check('undo again: the new field leaves the app and its database table', !a.cols.patients.includes('insurance_provider') && !c1.includes('insurance_provider') && (await hist()).at === 0, [a.cols.patients, c1]);
  check('undo keeps the records: a value typed in after the change is still there', (await phone()) === '555-0199');
  await key('Control+Shift+z');
  a = await appState(page);
  check('redo (Ctrl+Shift+Z): the field comes back, in the definition and the table', a.cols.patients.includes('insurance_provider') && (await cols()).includes('insurance_provider') && (await hist()).at === 1, a.cols.patients);
  check('history: undo and redo show in the event log', await st(page, () => window.__formwork.logs.EV.filter((e) => e.type === 'CUSTOM' && e.name === 'history').map((e) => e.value.op).join()) === 'undo,undo,redo');

  await page.getByRole('button', { name: 'Version history' }).click(); await page.waitForSelector('.dialog.history .hist-row');
  const rows = await page.locator('.hist-row').evaluateAll((l) => l.map((x) => [x.dataset.kind, x.classList.contains('now'), x.classList.contains('undone'), x.innerText.replace(/\s+/g, ' ')]));
  check('version history lists every version newest first, with who made it, the current one and the undone one', rows.length === 3 && rows[2][0] === 'start' && rows[1][1] && rows[0][2] && /Database agent/.test(rows[1][3]) && /You/.test(rows[0][3]), rows);
  await shot(page, 'history-dialog');
  await page.locator('.hist-row[data-kind="start"] .btn').click(); await sleep(300); await waitIdle(page);
  h = await hist(); a = await appState(page);
  check('restoring the first version brings it back as a new version that can be undone', h.versions.length === 3 && h.versions[2].kind === 'restore' && h.at === 2 && !a.cols.patients.includes('insurance_provider'), [h, a.cols.patients]);
  await page.locator('.dialog.history').getByRole('button', { name: 'Close' }).last().click();

  await st(page, () => window.__formwork.save()); await sleep(800);
  await page.reload(); await page.waitForSelector('.work-head', { timeout: 20000 }); await sleep(1500);
  await waitVersions(3);
  h = await hist();
  check('history is kept in IndexedDB across a reload', h.versions.length === 3 && h.at === 2 && (await st(page, () => window.__formwork.history.durable())), h);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await sleep(300); await waitIdle(page);
  a = await appState(page);
  check('the Undo button takes back the restore', a.cols.patients.includes('insurance_provider') && (await hist()).at === 1, a.cols.patients);
  await ctx.close();
}
const FLOWS = { demo: flowDemo, live: flowLive, misc: flowMisc, views: flowViews, quests: flowQuests, new: flowNew, custom: flowCustom, round6: flowRound6, react: flowReact, sizes: flowSizes, history: flowHistory };
(async () => {
  const url = (process.env.TK_URL || '').replace(/\/?$/, '/');
  if (!/^https?:/.test(url)) { console.error('TK_URL is not set. Run the checks with: npm run test:e2e'); process.exit(2); }
  const chrome = process.env.CHROME_PATH || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
  const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });
  const names = which === 'all' ? Object.keys(FLOWS) : which.split(',');
  for (const name of names) {
    if (!FLOWS[name]) { errors.push('no such flow: ' + name); continue; }
    try { await FLOWS[name](browser, url); } catch (e) { errors.push(name + ' flow stopped: ' + String(e.stack || e).slice(0, 700)); }
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log('\n' + results.filter((r) => r.ok).length + ' passed, ' + failed + ' failed');
  if (errors.length) { console.log('ERRORS (' + errors.length + '):'); [...new Set(errors)].slice(0, 12).forEach((e) => console.log(' - ' + e)); }
  process.exit(failed || errors.length ? 1 : 0);
})();

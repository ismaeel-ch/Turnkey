// Takes the README screenshots and the demo animation from a production build, in the light theme, with Demo data only.
//
//   npm run build && PORT=3333 npx next start &      (any running build of the app)
//   TK_URL=http://localhost:3333 node scripts/readme-media.mjs
//
// Needs ffmpeg. Writes the README's PNGs to docs/images/ and docs/images/demo.gif (a Demo build, from Home to the
// running app). ONLY=guided, ONLY=shots or ONLY=gif does one part.
// Raw files go to tests/e2e/shots/readme/ (ignored). Everything shown is a saved build: no model is called.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const url = (process.env.TK_URL || 'http://localhost:3333').replace(/\/?$/, '/');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'docs', 'images');
const raw = path.join(root, 'tests', 'e2e', 'shots', 'readme');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(raw, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const only = (process.env.ONLY || 'guided,shots,gif').split(',');

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 },
    colorScheme: 'light',
    reducedMotion: opts.motion ? 'no-preference' : 'reduce',
    ...(opts.video ? { recordVideo: { dir: raw, size: opts.viewport } } : {}),
  });
  await ctx.route('https://**/*', (route) => route.abort());
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror: ' + String(e).slice(0, 300)));
  return { ctx, page };
}
const st = (page, fn, arg) => page.evaluate(fn, arg);
const app = (page) =>
  st(page, () => {
    const F = window.__formwork,
      s = F.state(),
      t = (s.tabs[s.session] || []).find((x) => x.id === s.active[s.session]),
      a = t && t.app ? s.apps[t.app] : null;
    if (!a) return null;
    const R = F.wf.runs()[a.id];
    return { id: a.id, status: a.status, busy: !!R, gate: !!(R && R.gate) };
  });
const waitIdle = async (page) => {
  await sleep(250);
  await page.waitForFunction(
    () => !document.querySelector('.work-head .spin') && !document.querySelector('.titlebar .wtab.on .spin'),
    null,
    { timeout: 60000 },
  );
  await sleep(200);
};
const waitFree = async (page) => {
  for (let i = 0; i < 600; i++) {
    const a = await app(page);
    if (a && !a.busy) return a;
    await sleep(100);
  }
};
const say = async (page, text) => {
  await page.fill('.composer textarea', text);
  await page.press('.composer textarea', 'Enter');
  await sleep(200);
};
const view = async (page, name) => page.locator('.views .tab', { hasText: name }).first().click();
const shot = async (page, name, opts = {}) => {
  await sleep(opts.wait || 400);
  await page.mouse.move(1, 1);
  // toasts come and go; they would cover part of the screen in a still picture
  await page.addStyleTag({ content: '.toasts { display: none !important; }' });
  let clip;
  if (opts.of) {
    const b = await page.locator(opts.of).first().boundingBox();
    const pad = 24;
    clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + pad * 2, height: b.height + pad * 2 };
  }
  await page.screenshot({ path: path.join(raw, name + '.png'), ...(clip ? { clip } : {}) });
  console.log('shot ' + name);
};

async function onboard(page, speed) {
  await page.goto(url);
  await page.waitForSelector('.ob-card', { timeout: 30000 });
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: /Skip and use the demo account/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /empty workspace/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.locator('.ob-body .switch').click();
  await page.getByRole('button', { name: 'Open my workspace' }).click();
  await page.waitForSelector('.home');
  await st(
    page,
    (v) => {
      window.__formwork.state().settings.speed = v;
    },
    speed,
  );
}
async function build(page, id) {
  await page
    .locator('[data-tpl="' + id + '"] .tpl-build')
    .first()
    .click();
  for (let i = 0; i < 600; i++) {
    const a = await app(page);
    if (a && (a.status === 'ready' || a.status === 'failed')) break;
    const o = page.locator('.gcard.ask .opt:not([disabled])');
    if (await o.count())
      await o
        .first()
        .click()
        .catch(() => {});
    await sleep(120);
  }
  await waitIdle(page);
}

const CLINIC = 'A clinic books appointments for patients with its doctors';
const current = (page) =>
  st(page, () => {
    const s = window.__formwork.state(),
      t = (s.tabs[s.session] || []).find((x) => x.id === s.active[s.session]);
    return t && t.app ? s.apps[t.app].status : null;
  });

/** The guided flow on the clinic: questions, the plan, the build's steps, first use, demo data, a fix after 1.0, version 1.1. */
async function guided(browser) {
  const { ctx, page } = await newPage(browser);
  await onboard(page, 'instant');
  await page.fill('#home-prompt', CLINIC);
  await page.press('#home-prompt', 'Enter');
  await page.waitForSelector('.iv-ask .iv-usual');
  await shot(page, 'guided-questions', { wait: 900 });
  for (let i = 0; i < 20 && !(await page.locator('.iv-act .iv-build').count()); i++) {
    const next = page.locator('.iv-ask .iv-usual, .iv-done .iv-review').first();
    if (await next.count()) await next.click();
    await sleep(300);
  }
  await shot(page, 'guided-plan', { wait: 700 });
  await page.locator('.iv-act .iv-build').click();
  for (let i = 0; i < 1200; i++) {
    const s = await current(page);
    if (s === 'ready' || s === 'failed') break;
    await sleep(100);
  }
  await waitIdle(page);
  await shot(page, 'build-steps', { wait: 900 });

  await view(page, 'App');
  if (await page.locator('.persona-btn').count()) await page.locator('.persona-btn').first().click();
  await page.waitForSelector('.fr-welcome');
  await shot(page, 'first-use', { wait: 700 });
  await page.locator('.fr-welcome button', { hasText: 'Not now' }).click();
  await page.locator('.app .demo-bar .btn', { hasText: 'Remove demo data' }).click();
  await page.locator('.dialog .btn.danger', { hasText: 'Remove demo data' }).click();
  await page.waitForSelector('.app .demo-bar:has-text("Demo data removed")');
  await shot(page, 'demo-data-removed', { wait: 700 });

  await view(page, 'Release');
  await page.waitForSelector('#rel-go');
  await page.locator('#rel-go').click();
  await page.waitForFunction(() => /Version 1\.0 · up to date/.test((document.getElementById('rel-state') || {}).innerText || ''));
  await page.fill('#improve-text', 'Add a notes field to patients');
  await page.locator('#improve-go').click();
  const go = page.locator('.gcard.cplan [data-act="go"]');
  for (let i = 0; i < 200 && !(await go.count()); i++) {
    const o = page.locator('.gcard.ask .opt:not([disabled])');
    if (await o.count())
      await o
        .first()
        .click()
        .catch(() => {});
    await sleep(100);
  }
  await go.last().click();
  await page.waitForSelector('.gcard.tryit');
  await waitIdle(page);
  await page.locator('.gcard.tryit [data-act="works"]').last().click();
  await page.locator('.gcard.tryit [data-act="release"]').last().click();
  await page.waitForSelector('#rel-go');
  await shot(page, 'fix-after-release', { wait: 700 });
  await page.locator('#rel-go').click();
  await page.waitForFunction(() => /Version 1\.1 · up to date/.test((document.getElementById('rel-state') || {}).innerText || ''));
  await page
    .locator('.rel-hist')
    .first()
    .evaluate((el) => el.scrollIntoView({ block: 'center' }))
    .catch(() => {});
  await shot(page, 'versions', { wait: 700 });
  // With nothing left in the draft, the page still offers the next version and explains how to get there.
  await page.locator('#rel-next').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, 'release-again', { wait: 700 });
  await ctx.close();
}

async function shots(browser) {
  const { ctx, page } = await newPage(browser);
  await onboard(page, 'instant');
  await shot(page, 'home');
  await build(page, 'biddesk');
  await view(page, 'Build');
  if (await page.locator('.steps-view').count()) await page.getByRole('button', { name: 'Show how it was built' }).click();
  await page.waitForSelector('.react-flow .fl-gate');
  await shot(page, 'build-tab', { wait: 900 });

  // the Tester's panel: run 1 fails, Backend repairs, run 2 passes
  await page.locator('.fl-node.station').nth(6).click();
  await shot(page, 'tester-repair', { wait: 600 });
  await page.keyboard.press('Escape');

  // the run timeline with its cost line
  await page.getByRole('button', { name: 'Timeline' }).click();
  await page.waitForSelector('.tl-usage');
  await shot(page, 'timeline');
  await page.getByRole('button', { name: 'Workflow', exact: true }).click();

  // the agents panel: who did what, then how it works
  await page.locator('.act-launch').click();
  await page.waitForSelector('.act-panel .act-agent');
  await shot(page, 'agents-activity', { wait: 600 });
  await page.locator('.act-tab-how').click();
  await page.waitForSelector('.act-how');
  await shot(page, 'how-it-works', { wait: 500 });
  await page.locator('.act-launch').click();
  await page.waitForSelector('.act-panel', { state: 'detached' });

  // a change from chat: the orchestrator's plan and the agents' cards
  await say(page, 'Add a notes field to score lines');
  await waitFree(page);
  await waitIdle(page);
  await shot(page, 'chat-cards', { wait: 700 });

  // the owner's approval: ask before the screens are built, then run again
  await say(page, 'Ask me before the screens are built');
  await waitFree(page);
  await page.locator('.build-bar .btn', { hasText: 'Run again' }).click();
  await page.waitForSelector('.dialog .dfoot .btn.primary');
  await page.locator('.dialog .dfoot .btn.primary').click();
  for (let i = 0; i < 600; i++) {
    const a = await app(page);
    if (a && a.gate) break;
    const o = page.locator('.gcard.ask .opt:not([disabled])');
    if (await o.count())
      await o
        .first()
        .click()
        .catch(() => {});
    await sleep(100);
  }
  await page
    .locator('.fl-approval', { hasText: 'Waiting for you' })
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => {});
  await shot(page, 'approval', { wait: 700 });
  await page.locator('.gcard.ask .btn', { hasText: 'Approve and continue' }).last().click();
  await waitFree(page);
  await waitIdle(page);

  // the built app: the Bid room with its own three agents
  await view(page, 'App');
  await page.locator('.persona-btn').first().click();
  await page.waitForSelector('.app-nav .nav-i');
  await page.locator('.app-nav .nav-i').nth(1).click();
  await page.waitForSelector('.team.room');
  await page.locator('.team-start .chip', { hasText: 'Port fleet tracking' }).click();
  await sleep(60);
  await page.locator('.team-start button[type=submit]').click();
  await page.waitForSelector('.team-log .gcard.ask', { timeout: 20000 });
  await page.fill('.team-log .gcard.ask input', 'Ask for a site visit first');
  await page.locator('.team-log .gcard.ask .btn', { hasText: 'Add' }).click();
  await sleep(100);
  await page.locator('.team-log .gcard.ask .btn.primary').click();
  await page.waitForSelector('.verdict', { timeout: 40000 });
  await shot(page, 'bid-room', { wait: 900 });

  // release and the one deliverable document
  await view(page, 'Release');
  await page.waitForSelector('.release');
  await page.locator('#rel-go').click();
  await page.waitForFunction(() => /Version 1\.0 · up to date/.test((document.getElementById('rel-state') || {}).innerText || ''));
  await page.locator('#rel-export').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await shot(page, 'export', { wait: 600 });

  // version history
  await page.getByRole('button', { name: 'Version history' }).click();
  await page.waitForSelector('.dialog.history .hist-row');
  await shot(page, 'history', { wait: 600, of: '.dialog.history' });
  await ctx.close();
}

async function demo(browser) {
  const viewport = { width: 1280, height: 800 };
  const { ctx, page } = await newPage(browser, { viewport, video: true, motion: true });
  const t0 = Date.now();
  await onboard(page, 'fast');
  const marks = { home: (Date.now() - t0) / 1000 };
  await sleep(900);
  // type the sentence; in Demo a sentence about a clinic replays the saved clinic build, after its question and plan
  await page.locator('#home-prompt').click();
  await page.keyboard.type(CLINIC, { delay: 35 });
  await sleep(700);
  await page.keyboard.press('Enter');
  for (let i = 0; i < 900; i++) {
    const s = await current(page);
    if (s === 'ready' || s === 'failed') break;
    // the questions and the plan come before the build: answer each card, read the plan, then build it
    const next = page.locator('.iv-ask .iv-usual, .iv-done .iv-review, .iv-act .iv-build').first();
    if (await next.count()) {
      await sleep(1600);
      await next.click().catch(() => {});
      continue;
    }
    await sleep(100);
  }
  await waitIdle(page);
  marks.built = (Date.now() - t0) / 1000;
  await sleep(2500);
  await view(page, 'App');
  await sleep(1000);
  if (await page.locator('.persona-btn').count()) await page.locator('.persona-btn').first().click();
  await page.waitForSelector('.fr-welcome');
  await sleep(3500);
  marks.end = (Date.now() - t0) / 1000;
  const video = page.video();
  await ctx.close();
  const src = await video.path();
  fs.writeFileSync(path.join(raw, 'demo-marks.json'), JSON.stringify({ src, ...marks }));
  console.log('video ' + src + ' ' + JSON.stringify(marks));
  return { src, marks };
}

const README = [
  'guided-questions',
  'guided-plan',
  'build-steps',
  'first-use',
  'demo-data-removed',
  'fix-after-release',
  'versions',
  'release-again',
  'build-tab',
  'chat-cards',
  'approval',
  'timeline',
  'tester-repair',
  'how-it-works',
  'bid-room',
  'export',
  'history',
];

/** Copies the README's pictures into docs/images at 256 colours: about half the bytes, and the UI looks the same. */
function optimise() {
  for (const name of README) {
    if (!fs.existsSync(path.join(raw, name + '.png'))) continue;
    const dst = path.join(out, name + '.png');
    execFileSync('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      path.join(raw, name + '.png'),
      '-filter_complex',
      'split[a][b];[a]palettegen=max_colors=256:stats_mode=single[p];[b][p]paletteuse=dither=none',
      dst,
    ]);
    console.log('png ' + name + ' ' + Math.round(fs.statSync(dst).size / 1024) + ' KB');
  }
}

function gif({ src, marks }) {
  const dst = path.join(out, 'demo.gif');
  // from the moment Home shows to the end, at twice the speed, 800 px wide, 6 frames a second
  const start = marks.home + 0.3;
  const filters = `trim=start=${start}:end=${marks.end},setpts=(PTS-STARTPTS)/2,fps=6,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-filter_complex', filters, '-loop', '0', dst], { stdio: 'inherit' });
  // gifsicle's lossy mode takes off another third; GIFSICLE is the path to its binary, if you have one
  if (process.env.GIFSICLE) execFileSync(process.env.GIFSICLE, ['-O3', '--lossy=60', '-b', dst], { stdio: 'inherit' });
  console.log('gif ' + dst + ' ' + Math.round(fs.statSync(dst).size / 1024) + ' KB');
}

(async () => {
  const browser = await chromium.launch();
  try {
    if (only.includes('guided')) await guided(browser);
    if (only.includes('shots')) await shots(browser);
    if (only.includes('guided') || only.includes('shots')) optimise();
    if (only.includes('gif')) gif(await demo(browser));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

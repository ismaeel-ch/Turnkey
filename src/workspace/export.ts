import type { AppRecord, Run } from '@/shared/types/workspace';
import type { BackedDef } from '@/shared/types/app';
import { printableHtml, printHtml } from '@/platform/export/print';
import { zip } from '@/platform/export/zip';
import { sqliteFileName } from '@/platform/storage';
import { AGENTS } from './agents';
import { BRAND, cap, fmtClock, fmtMs, isoDate, saveFile, snake, toast } from './core';
import { buildPack } from './changes';
import { dbBytes } from './db';
import { STATIONS } from './line';
import { testStats } from './tests';

/* ===== The deliverable: one document generated from the app's state =====
   The build pack (brief, tables, rules, views, screens, acceptance test, workflow) plus who made what, the test
   results and the run timeline. It downloads as Markdown, prints to PDF from a printable page, and goes into a zip
   with the app's .sqlite file and its definition. Everything is made in the browser from saved state: no model call. */

type Backed = AppRecord & { def: BackedDef };

const agentName = (id: string | null | undefined) => (id ? AGENTS[id]?.name || cap(id) : 'Orchestrator');
const cell = (s: unknown) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
const status = (s: string | undefined) =>
  ({ done: 'Done', ok: 'Done', failed: 'Failed', error: 'Failed', running: 'Running', waiting: 'Waiting', hold: 'Waiting' })[String(s)] ||
  cap(String(s || 'not run'));

/** Who made what: each station, its agent, what it produced and how many attempts its checks took. */
function whoMadeWhat(app: Backed, L: string[]) {
  L.push('', '## Who made what', '', '| Station | Agent | Made | Attempts | Result |', '|---|---|---|---|---|');
  STATIONS.forEach((s) => {
    const ln = app.line?.[s.id];
    const tries = ln?.attempts?.length || ln?.attempt || 0;
    L.push(
      '| ' +
        [
          s.name,
          agentName(s.agent),
          s.makes,
          tries ? String(tries) + (tries > 1 ? ' (sent back ' + (tries - 1) + ')' : '') : '—',
          ln ? status(ln.status) + (ln.fellBack ? ', safe default used' : '') : 'Not run',
        ]
          .map(cell)
          .join(' | ') +
        ' |',
    );
  });
  const fixes = (app.qa?.rounds || []).flatMap((r) => r.fixes || []);
  if (fixes.length) {
    L.push('', '**Repairs after failed tests**', '');
    fixes.forEach((f) => L.push('- ' + agentName(f.by) + ': ' + f.text + (f.ok ? ' (passes)' : ' (did not pass: ' + f.why + ')')));
  }
}

function tests(app: Backed, L: string[]) {
  const st = testStats(app);
  L.push('', '## Tests', '');
  if (!st) L.push('No test run yet.');
  else
    L.push(
      st.passed + ' of ' + st.total + ' checks pass' + (st.failed ? ', ' + st.failed + ' fail' : '') + '.',
      '',
      st.fresh ? 'The run is of the current version.' : 'The last run is older than the current version: run the tests again.',
    );
  const qa = app.qa;
  if (qa && qa.rounds.length) {
    L.push(
      '',
      '**Tester rounds** (cases written by ' + (qa.by === 'model' ? 'the model' : qa.by === 'saved' ? 'the saved build' : 'rules') + ')',
      '',
    );
    qa.rounds.forEach((r) => {
      L.push('- Round ' + r.n + ': ' + (r.total - r.failed) + ' of ' + r.total + ' pass');
      r.fails.slice(0, 10).forEach((f) => L.push('  - Failed: ' + f.suite + ' · ' + f.name + ' (' + f.actual + ')'));
    });
  }
}

/** The steps of one run, timed from its start. */
function timeline(run: Run, L: string[], title: string) {
  L.push(
    '',
    '## ' + title,
    '',
    cap(run.kind) +
      ' "' +
      run.label +
      '", started ' +
      isoDate(new Date(run.t0)) +
      ' ' +
      fmtClock(run.t0) +
      ', ' +
      status(run.status).toLowerCase() +
      '.',
    '',
    '| At | Agent | Step | Took | Result |',
    '|---|---|---|---|---|',
  );
  run.steps.forEach((s) =>
    L.push(
      '| ' +
        [
          '+' + fmtMs(Math.max(0, s.t0 - run.t0)),
          agentName(s.agent),
          s.label,
          s.t1 ? fmtMs(s.t1 - s.t0) : '—',
          s.ok == null ? 'Running' : s.ok ? 'Passed' : 'Sent back',
        ]
          .map(cell)
          .join(' | ') +
        ' |',
    ),
  );
  L.push(
    '',
    'Model calls: ' +
      run.calls +
      ', tokens in ' +
      (run.tokIn || 0) +
      ', tokens out ' +
      (run.tokOut || 0) +
      ', send-backs ' +
      run.retries +
      '.',
  );
}

function history(app: Backed, L: string[]) {
  if (app.runs.length > 1) {
    L.push('', '## All runs', '', '| # | Kind | What | Result | Took | Model calls |', '|---|---|---|---|---|---|');
    app.runs.forEach((r) =>
      L.push('| ' + [r.n, cap(r.kind), r.label, status(r.status), r.t1 ? fmtMs(r.t1 - r.t0) : '—', r.calls].map(cell).join(' | ') + ' |'),
    );
  }
  const rels = app.releases || [];
  if (rels.length) {
    L.push('', '## Versions', '');
    rels.forEach((r) => {
      L.push('**' + r.v + '** · ' + isoDate(new Date(r.at)) + ' · ' + r.tests.passed + ' of ' + r.tests.total + ' tests passed', '');
      r.notes.forEach((n) => L.push('- ' + n));
      L.push('');
    });
  }
}

/** The whole deliverable as Markdown. */
export function deliverableMarkdown(app: AppRecord): string {
  const a = app as Backed;
  const pack = buildPack(a).split('\n');
  pack[0] = '# ' + app.name + ' · deliverable';
  const L = pack;
  whoMadeWhat(a, L);
  tests(a, L);
  const last = a.runs[a.runs.length - 1],
    build = [...a.runs].reverse().find((r) => r.kind === 'build');
  if (build) timeline(build, L, 'Run timeline: the build');
  if (last && last !== build) timeline(last, L, build ? 'Run timeline: the latest run' : 'Run timeline');
  history(a, L);
  L.push(
    '',
    '---',
    '',
    '_Made with ' + BRAND.name + ' from the saved state of the app. Open ' + fileBase(app) + '.sqlite in any SQLite tool to see the data._',
  );
  return L.join('\n') + '\n';
}

const fileBase = (app: AppRecord) => snake(app.name) || 'app';

/** The deliverable as a printable HTML page. */
export const deliverableHtml = (app: AppRecord) => printableHtml(app.name + ' · deliverable', deliverableMarkdown(app));

/** The build pack: deliverable (Markdown and printable page), the database, the app's definition and a read-me. */
export function buildPackZip(app: AppRecord): Uint8Array {
  const base = fileBase(app),
    md = deliverableMarkdown(app);
  return zip([
    {
      name: base + '/README.txt',
      data:
        app.name +
        ', exported from ' +
        BRAND.name +
        ' on ' +
        isoDate(new Date()) +
        '.\n\n' +
        'deliverable.md    the document: brief, tables, rules, screens, tests, who made what, run timeline\n' +
        'deliverable.html  the same document as a page; open it and print to save a PDF\n' +
        sqliteFileName(app.name).padEnd(18) +
        'the database with its seed rows; open it in any SQLite tool\n' +
        'app.json          the app definition the agents built, as data\n',
    },
    { name: base + '/deliverable.md', data: md },
    { name: base + '/deliverable.html', data: printableHtml(app.name + ' · deliverable', md) },
    { name: base + '/' + sqliteFileName(app.name), data: dbBytes(app.id) },
    {
      name: base + '/app.json',
      data: JSON.stringify({ name: app.name, request: app.request || '', version: app.releases?.[0]?.v || null, def: app.def }, null, 2),
    },
  ]);
}

/* ---------- the four exports the Release screen offers ---------- */
export const exportMarkdown = (app: AppRecord) => saveFile(fileBase(app) + '-deliverable.md', deliverableMarkdown(app), 'text/markdown');
export const exportPage = (app: AppRecord) => saveFile(fileBase(app) + '-deliverable.html', deliverableHtml(app), 'text/html');
export const exportSqlite = (app: AppRecord) => saveFile(sqliteFileName(app.name), dbBytes(app.id), 'application/vnd.sqlite3');
export const exportZip = (app: AppRecord) => saveFile(fileBase(app) + '-build-pack.zip', buildPackZip(app), 'application/zip');
export function exportPdf(app: AppRecord) {
  if (!printHtml(deliverableHtml(app)))
    toast('Printing is not available here. Download the page and print it from your browser.', 'warning');
}

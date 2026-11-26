import { modelProblem } from '@/shared/api-error';
import type { AppDef, AppTable, BackedDef, Board, Brief, BriefedDef, Check, Untrusted } from '@/shared/types/app';
import type {
  AppRecord,
  ChatCard,
  ChatMessage,
  Dict,
  Loose,
  Run,
  RunStep,
  SavedBuild,
  StationLine,
  StationRecording,
} from '@/shared/types/workspace';
import type { AskRequest, Ports, RunResult, WorkflowRun } from '@/platform/orchestrator';
import { AGENTS } from './agents';
import {
  CAP,
  LS,
  MODELCALLS,
  NO_MODEL,
  PHONE,
  S,
  U,
  arr,
  brief,
  chatShown,
  clone,
  commit,
  emit,
  errText,
  label,
  modeNow,
  myApps,
  notify,
  online,
  openTab,
  parseJSONLoose,
  ring,
  setChat,
  sleep,
  str,
  toast,
  toolCall,
  uid,
  liveModelOn,
} from './core';
import { dbCount, dbDrop, dbFlush } from './db';
import {
  ACCENTS,
  VIEW_LABEL,
  accOf,
  buildDatabase,
  checkBackendLive,
  checkBackendShape,
  checkBrief,
  checkSchemaShape,
  chk,
  deriveEndpoints,
  fallbackBackend,
  fallbackUI,
  issuesOf,
  normBackend,
  normBrief,
  normSchema,
  renderTest,
  reseed,
  runAcceptance,
  tableOf,
} from './engine';
import { checkScreensShape, checkViews, mendViews, normUI, normViews, renderViewsTest, suggestViews, viewsOf } from './viewspec';
import { CONNECTORS, REC, allConnectors, callConnector, connOn } from './builds';
import { TEAMS, checkTeam, stopTeam, teamNeeds } from './team';
import { checkBoard, normBoard } from './room';
import { SUITES, TESTS, runTestsSync } from './tests';
import { REVIEWERS, applyAuto, flowDefault, flowList, flowOf, runReview, showGate, stepAfter, verifyFindings } from './custom';
import { testerSteps } from './tester';
import { StoppedError, createRun, workflowFromFlow } from '@/platform/orchestrator';
import { SHARE } from './share';
import { LOGO_FILLS, LOGO_MARKS, LOGO_SHAPES, logChange, normLogo } from './release';
import { recordTouches, snapshotDef } from './provenance';

/* ===== Turnkey prototype · the line: five agents, six stations, a code orchestrator ===== */
export interface Station {
  id: string;
  name: string;
  agent: string;
  out: string;
  makes: string;
}
export const STATIONS: Station[] = [
  {
    id: 'research',
    name: 'Research',
    agent: 'researcher',
    out: 'brief',
    makes: 'Brief',
  },
  {
    id: 'database',
    name: 'Database',
    agent: 'database',
    out: 'schema',
    makes: 'Tables and data',
  },
  {
    id: 'backend',
    name: 'Backend',
    agent: 'backend',
    out: 'api',
    makes: 'Endpoints and rules',
  },
  {
    id: 'views',
    name: 'Views',
    agent: 'views',
    out: 'views',
    makes: 'Views per table, dashboard',
  },
  {
    id: 'screens',
    name: 'Screens',
    agent: 'ui',
    out: 'screens',
    makes: 'Screens and layout',
  },
  {
    id: 'walkthrough',
    name: 'Walkthrough',
    agent: 'ui',
    out: 'tour',
    makes: 'Tour as acceptance test',
  },
];
export const stationIdx = (id: string | undefined) => STATIONS.findIndex((s) => s.id === id);
/** What a run in progress can be told: stop, or the owner's answer to the question or approval it waits at. */
export interface RunCtl {
  stop: boolean;
  runId: string;
  answer?: ((i: number) => void) | null;
  gate?: ((ok: boolean) => void) | null;
  abort?: (() => void) | null;
  /** the card the run waits on: the Researcher's question or an approval */
  held?: { answered?: (i: number) => void; decided?: (ok: boolean) => void; cancel: () => void } | null;
  ctrl?: AbortController | null;
  wf?: WorkflowRun;
  [field: string]: Loose;
}
/** An app on the line. A station runs only after the stations before it filled in their part of the definition. */
export type BuildApp = AppRecord & { def: BackedDef };
/** What one station made: its checks and a few facts for the card. */
export interface StationResult {
  checks: Check[];
  facts: string[];
}
export const RUNS: Dict<RunCtl> = {},
  PENDING: Dict<(ok: boolean) => void> = {},
  /** the model client, set once the workspace knows a model is connected */
  LIVE: {
    fn: ((prompt: string, opts: Dict<unknown>) => Promise<{ text?: string; truncated?: boolean }>) | null;
  } = {
    fn: null,
  };
/** Thrown wherever a run is when the owner stops it. The workflow graph knows it as a stop, not a failure. */
export class Stopped extends StoppedError {}
export const fatal = (msg: string): Error & { fatal: true } => {
  const e = new Error(msg) as Error & { fatal: true };
  e.fatal = true;
  return e;
};
export const SPEED: Dict<number> = {
  normal: 1,
  fast: 0.4,
  instant: 0.03,
};
export async function pace(app: AppRecord, ms: number) {
  // waits in short slices so Stop takes effect at once
  const end = Date.now() + Math.max(0, ms * (SPEED[S.settings.speed] || 1));
  for (;;) {
    const left = end - Date.now();
    if (left > 0) await sleep(Math.min(120, left));
    const r = RUNS[app.id];
    if (!r || r.stop) throw new Stopped();
    if (end - Date.now() <= 0) return;
  }
}
export const blankLine = (): StationLine => ({
  status: 'idle',
  attempt: 0,
  attempts: [],
  checks: [],
  facts: [],
  note: null,
  results: [],
});
export const blankDef = (): AppDef => ({
  brief: null,
  tables: [],
  users: [],
  process: null,
  access: {},
  team: null,
  views: {},
  dash: null,
  screens: [],
  theme: {
    accent: 'blue',
    nav: 'side',
    icon: 'apps',
    density: 'comfortable',
  },
  tour: [],
  actions: [],
  migrations: [],
});
export function newApp(o: { request: string; tpl?: string | null; mode: string }) {
  const rec = o.tpl ? REC[o.tpl] : null,
    id = uid('app');
  const app: AppRecord = {
    id,
    owner: S.session,
    name: rec ? rec.title : 'New app',
    icon: rec ? rec.icon : 'apps',
    accent: rec ? rec.accent : 'blue',
    request: o.request,
    tpl: o.tpl || null,
    mode: o.mode,
    status: 'new',
    created: Date.now(),
    updated: Date.now(),
    def: blankDef(),
    seed: null,
    line: {},
    runs: [],
    chat: [],
    answers: {},
    rev: 0,
    renamed: false,
    flow: flowDefault(),
    reviews: {},
    uid: uid('a'),
    releases: [],
    log: [],
  };
  STATIONS.forEach((s) => {
    app.line[s.id] = blankLine();
  });
  S.apps[id] = app;
  return app;
}
export function pushChat(app: AppRecord, from: string, text: string, card?: ChatCard | null) {
  const m: ChatMessage = {
    id: uid('m'),
    t: Date.now(),
    from,
    text: text || '',
    card: card || null,
  };
  app.chat.push(m);
  if (app.chat.length > 160) app.chat.splice(0, 40);
  return m;
}
export function say(app: AppRecord, agent: string, text: string, card?: ChatCard | null) {
  const m = pushChat(app, agent, text, card);
  emit('TEXT_MESSAGE_START', {
    messageId: m.id,
    role: 'assistant',
    agent,
    app: app.id,
  });
  if (text)
    emit('TEXT_MESSAGE_CONTENT', {
      messageId: m.id,
      delta: brief(text, 200),
      agent,
      app: app.id,
    });
  if (card)
    toolCall(
      {
        agent,
        appId: app.id,
        runId: (RUNS[app.id] || {}).runId,
      },
      'render_card',
      {
        card: card.type,
      },
      () => ({
        rendered: true,
      }),
      'frontend',
    );
  emit('TEXT_MESSAGE_END', {
    messageId: m.id,
    agent,
    app: app.id,
  });
  commit();
  return m;
}
export const stepStart = (run: Run, station: string, agent: string, name: string, kind: string) => {
  const s: RunStep = {
    station,
    agent,
    label: name,
    kind,
    t0: Date.now(),
    t1: null,
    ok: null,
  };
  run.steps.push(s);
  return s;
};
export const stepEnd = (s: RunStep, ok?: boolean) => {
  s.t1 = Date.now();
  s.ok = ok !== false;
};
export const ctxOf = (app: AppRecord, run: Run, agent: string) => ({
  agent,
  runId: run.id,
  appId: app.id,
  runN: run.n,
});
export function newRun(app: AppRecord, kind: string, name: string, mode: string) {
  const n = (app.runs.length ? app.runs[app.runs.length - 1].n : 0) + 1;
  const run: Run = {
    id: 'run_' + n,
    n,
    kind,
    label: name,
    mode,
    t0: Date.now(),
    t1: null,
    status: 'running',
    steps: [],
    calls: 0,
    replayed: 0,
    tokIn: 0,
    tokOut: 0,
    retries: 0,
  };
  app.runs.push(run);
  if (app.runs.length > 10) app.runs.shift();
  return run;
}

/* ---------- what each station does with an agent's output ---------- */
export const APPLY: Dict<(app: BuildApp, out: Untrusted, run: Run, attempt?: number) => StationResult> = {
  research(app, out, run) {
    const b = normBrief(out),
      checks = checkBrief(b);
    if (checks.every((c) => c.ok)) {
      b.sources = arr(app.lookups);
      app.def.brief = b;
      if (!app.renamed) app.name = b.name;
      toolCall(
        ctxOf(app, run, 'researcher'),
        'set_tab_title',
        {
          title: app.name,
        },
        () => ({
          ok: true,
        }),
        'frontend',
      );
    }
    return {
      checks,
      facts: [b.roles.length + ' roles', b.entities.length + ' kinds of record', b.stories.length + ' user stories'],
    };
  },
  database(app, out, run, attempt = 1) {
    const sc = normSchema(out, app.def.brief, attempt >= 3, app.shared ? SHARE.maxRows : 0);
    let checks = checkSchemaShape(sc, app.def.brief);
    if (checks.every((c) => c.ok)) {
      checks = checks.concat(buildDatabase(app, sc, ctxOf(app, run, 'database')));
      if (checks.every((c) => c.ok)) {
        const seed: NonNullable<AppRecord['seed']> = (app.seed = {
          rows: {},
        });
        sc.tables.forEach((t) => {
          seed.rows[t.name] = t.rows;
        });
        app.def.tables = sc.tables.map((t) => ({
          name: t.name,
          label: t.label,
          one: t.one,
          title: t.title,
          owner: t.owner,
          by: 'database',
          run: run.n,
          columns: t.columns.map((c) =>
            Object.assign(
              {
                by: 'database',
                run: run.n,
              },
              c,
            ),
          ),
        }));
        app.def.users = sc.users;
        app.def.migrations = [];
      }
    }
    return {
      checks,
      facts: [
        sc.tables.length + ' tables',
        sc.tables.reduce((n, t) => n + t.columns.length + 3, 0) + ' columns',
        sc.tables.reduce((n, t) => n + t.rows.length, 0) + ' seed rows',
      ],
    };
  },
  backend(app, out, run) {
    const be = normBackend(out, app.def);
    let checks = checkBackendShape(app.def, be),
      n = 0;
    if (checks.every((c) => c.ok)) {
      app.def.process = be.process;
      app.def.access = be.access;
      app.def.team = be.team;
      n = deriveEndpoints(app.def).length;
      checks = checks.concat(checkBackendLive(app, ctxOf(app, run, 'backend')));
      if (be.team) checks.push(checkTeam(app.def, be.team));
    }
    return {
      checks,
      facts: [
        n + ' endpoints',
        be.process.transitions.length + ' workflow actions',
        app.matrix ? app.matrix.calls + ' permission tests' : 'not tested',
      ].concat(be.team ? ['Agent team of ' + be.team.agents.length] : []),
    };
  },
  views(app, out, run, attempt = 1) {
    const vw = attempt >= 3 ? mendViews(out, app.def) : normViews(out, app.def),
      checks = checkViews(app.def, vw),
      n = Object.keys(vw.views).reduce((k, t) => k + vw.views[t].length, 0);
    if (checks.every((c) => c.ok)) {
      app.def.views = vw.views;
      app.def.dash = vw.dash;
      app.def.board = app.def.team ? (normBoard(out && out.board, app.def) as Board | null) : null;
      app.rev++;
      const r = toolCall(
        ctxOf(app, run, 'views'),
        'mount_views',
        {
          views: n,
          widgets: vw.dash.widgets.length,
        },
        () => {
          const c = renderViewsTest(app);
          if (!c.ok) throw new Error(c.detail);
          return {
            mounted: c.detail,
          };
        },
      );
      checks.push(chk('Every view and the dashboard draw with the real data', r.ok, r.ok ? r.result.mounted : r.result.error));
      if (app.def.board) checks.push(checkBoard(app.def, app.def.board));
    }
    return {
      checks,
      facts: [n + ' views for ' + app.def.tables.length + ' tables', vw.dash.widgets.length + ' dashboard widgets'].concat(
        app.def.board && checks.every((c) => c.ok) ? ['Agent room: ' + app.def.board.panels.map((p) => p.layout).join(' + ')] : [],
      ),
    };
  },
  screens(app, out, run) {
    const ui = normUI(out, app.def),
      checks = checkScreensShape(app.def, ui);
    if (checks.every((c) => c.ok)) {
      ui.theme.logo = normLogo(out && out.theme && out.theme.logo, ui.theme, app.name);
      app.def.screens = ui.screens;
      app.def.theme = ui.theme;
      app.def.tour = ui.tour;
      app.def.actions = ui.actions;
      app.icon = ui.theme.icon;
      app.accent = ui.theme.accent;
      app.rev++;
      const r = toolCall(
        ctxOf(app, run, 'ui'),
        'mount_screens',
        {
          screens: ui.screens.length,
        },
        () => {
          const c = renderTest(app);
          if (!c.ok) throw new Error(c.detail);
          return {
            mounted: c.detail,
          };
        },
      );
      checks.push(chk('Every screen mounts for every role that may open it', r.ok, r.ok ? r.result.mounted : r.result.error));
    }
    return {
      checks,
      facts: [
        ui.screens.length + ' screens',
        ui.screens
          .map((s) => VIEW_LABEL[s.type])
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(', '),
        label(ui.theme.accent) + ', ' + ui.theme.nav + ' navigation',
      ],
    };
  },
  walkthrough(app, out, run) {
    if (out && out.tour)
      app.def.tour = normUI(
        {
          tour: out.tour,
        },
        app.def,
      ).tour;
    const r = runAcceptance(app, ctxOf(app, run, 'ui'));
    app.line.walkthrough.results = r.results;
    return {
      checks: r.checks,
      facts: [
        r.results.filter((x) => x.ok).length + ' of ' + r.results.length + ' steps passed',
        new Set(app.def.tour.map((s) => s.role)).size + ' roles covered',
      ],
    };
  },
};
export const FALLBACK: Dict<(app: BuildApp, run: Run) => StationResult> = {
  backend: (app, run) => APPLY.backend(app, fallbackBackend(app.def), run),
  views: (app, run) => APPLY.views(app, suggestViews(app.def), run),
  screens: (app, run) => APPLY.screens(app, fallbackUI(app.def), run),
  walkthrough: (app, run) =>
    APPLY.walkthrough(
      app,
      {
        tour: app.def.brief.roles.map((r) => ({
          role: r.id,
          do: 'open',
          screen: (app.def.screens.find((s) => s.roles.includes(r.id)) || {}).name,
          say: r.name + ' signs in and opens their first screen.',
        })),
      },
      run,
    ),
};
export const CARD: Dict<(app: BuildApp) => ChatCard> = {
  research: (app) => {
    const b = app.def.brief;
    return {
      type: 'brief',
      summary: b.summary,
      roles: b.roles.map((r) => r.name),
      records: b.entities.map((e) => label(e.name)),
      states: b.process.states.map(label),
      stories: b.stories.length,
    };
  },
  database: (app) => ({
    type: 'tables',
    tables: app.def.tables.map((t) => ({
      name: t.label,
      cols: t.columns.length + 3,
      rows: dbCount(app.id, t.name),
    })),
    users: app.def.users.length,
  }),
  backend: (app) => ({
    type: 'access',
    endpoints: deriveEndpoints(app.def).length,
    actions: app.def.process.transitions.map((x) => x.label),
    calls: app.matrix ? app.matrix.calls : 0,
    refused: app.matrix ? app.matrix.refused : 0,
    team: app.def.team ? app.def.team.agents.map((a) => a.name) : null,
  }),
  views: (app) => ({
    type: 'viewplan',
    tables: app.def.tables.map((t) => ({
      name: t.label,
      views: viewsOf(app.def, t).map((v) => v.type),
    })),
    widgets: app.def.dash ? app.def.dash.widgets.length : 0,
  }),
  screens: (app) => ({
    type: 'screens',
    screens: app.def.screens.map((s) => ({
      name: s.name,
      type: s.type,
    })),
    accent: app.def.theme.accent,
    nav: app.def.theme.nav,
  }),
  walkthrough: (app) => ({
    type: 'acceptance',
    steps: app.def.tour.map((s, i) => ({
      say: s.say,
      ok: !!(app.line.walkthrough.results[i] || {}).ok,
      detail: (app.line.walkthrough.results[i] || {}).detail || '',
    })),
  }),
};
export const DONE_SAY: Dict<string> = {
  research: 'The brief passed its checks.',
  database: 'The tables exist in SQLite and the seed rows are in.',
  backend: 'Endpoints and rules are in place. I called every endpoint as every role.',
  views: 'Every table has its views and the app has a dashboard. I mounted each one with the real data.',
  screens: 'The screens are mounted.',
  walkthrough: 'I played the tour against the real endpoints. It passed, so the app is ready.',
};

/* ---------- where an agent's output comes from: a saved build (Demo) or the model (Live) ---------- */
export async function produce(app: BuildApp, run: Run, st: Station, attempt: number, feedback: string[] | null): Promise<Untrusted> {
  if (st.id === 'walkthrough' && attempt === 1)
    return {
      tour: null,
    }; // the UI agent already wrote the tour; code plays it
  return app.mode === 'live' ? produceLive(app, run, st, attempt, feedback) : produceDemo(app, run, st, attempt);
}
export async function produceDemo(app: BuildApp, run: Run, st: Station, attempt: number): Promise<Untrusted> {
  const rec = REC[app.tpl as string] as SavedBuild,
    key = st.id === 'screens' ? 'ui' : st.id,
    ctx = {
      answer: app.answers.q == null ? 0 : app.answers.q,
    };
  if (st.id === 'walkthrough')
    return {
      tour: null,
    };
  if (st.id === 'research' && rec.lookup && attempt === 1) {
    const lk = rec.lookup,
      c = CONNECTORS.find((x) => x.id === lk.connector) as (typeof CONNECTORS)[number];
    if (!connOn(lk.connector))
      say(app, 'researcher', c.name + ' is switched off for this workspace, so I am working from the request alone.');
    else if (!online())
      say(app, 'researcher', 'You are offline, so I skipped the ' + c.name + ' lookup and worked from the request alone.');
    else {
      const r = callConnector(app, 'researcher', run.id, lk.connector, lk.tool, lk.args);
      if (r.ok) {
        app.lookups = [
          {
            connector: c.name,
            tool: lk.tool,
            query: Object.values(lk.args)[0],
            note: lk.note,
            titles: arr<{ title: string }>((r.result as { pages?: unknown }).pages).map((p) => p.title),
          },
        ];
        say(app, 'researcher', lk.say);
        await pace(app, 900);
      }
    }
  }
  const lines = rec.say[key + (attempt > 1 ? attempt : '')] || (attempt > 1 ? [] : rec.say[key]) || [];
  for (const line of lines) {
    say(app, st.agent, line);
    await pace(app, 650 + line.length * 9);
  }
  const use = rec.usage[key + (attempt > 1 ? attempt : '')] || rec.usage[key] || [1500, 800, 7000];
  run.replayed++;
  ring(
    MODELCALLS,
    {
      t: Date.now(),
      app: app.id,
      run: run.id,
      agent: st.agent,
      mode: 'replay',
      model: 'saved build',
      tokIn: use[0],
      tokOut: use[1],
      ms: use[2],
      attempt,
    },
    200,
  );
  await pace(app, 700);
  return (rec[key] as StationRecording)(ctx, attempt);
}
export const HEAD = (who: string) =>
  'You are the ' +
  who +
  ' agent on Turnkey, a line of agents that builds small record-keeping web apps (tables, roles, one status workflow, screens) from one sentence. Code checks your answer and sends it back if it fails, so follow the format exactly. Reply with ONE JSON object and nothing else: no prose, no code fences.\n\n';
export const fbText = (f?: string[] | null) =>
  f && f.length ? '\n\nYOUR LAST ANSWER FAILED THESE CHECKS. Fix them and return the full JSON again:\n- ' + f.join('\n- ') : '';
export const pBrief = (b: Brief) =>
  JSON.stringify({
    name: b.name,
    summary: b.summary,
    roles: b.roles,
    entities: b.entities,
    process: b.process,
    stories: b.stories,
    rules: b.rules,
    decision: b.decision,
  });
export const pTables = (def: AppDef) =>
  def.tables
    .map(
      (t) =>
        t.name +
        ' (title: ' +
        t.title +
        ', owner: ' +
        (t.owner || 'none') +
        '): ' +
        t.columns
          .map(
            (c) =>
              c.name +
              ':' +
              c.type +
              (c.type === 'select'
                ? '[' + (c.options || []).join('|') + ']'
                : c.type === 'ref'
                  ? '->' + c.ref
                  : c.type === 'user' && c.role
                    ? '(' + c.role + ')'
                    : '') +
              (c.required ? '*' : ''),
          )
          .join(', '),
    )
    .join('\n');
export const pUsers = (def: AppDef) => def.users.map((u, i) => i + 1 + '. ' + u.name + ' (' + u.role + ')').join('; ');
export const pAccess = (def: BriefedDef) =>
  def.tables
    .map(
      (t) =>
        t.name +
        ': ' +
        def.brief.roles
          .map((r) => {
            const a = accOf(def, r.id, t.name);
            return r.id + ' list=' + a.list + ' create=' + a.create + ' update=' + a.update + ' delete=' + a.delete;
          })
          .join(' | '),
    )
    .join('\n');
export const pFlow = (def: BackedDef) =>
  'table ' +
  def.process.table +
  ', column ' +
  def.process.column +
  ', initial ' +
  def.process.initial +
  '\n' +
  def.process.transitions.map((x) => x.id + ': ' + x.from.join('|') + ' -> ' + x.to + ' by ' + x.roles.join('|')).join('\n');
export const pRoom = (def: AppDef) => {
  const tm = def.team;
  if (!tm) return '';
  const it = tableOf(def, tm.input.table) as AppTable;
  return (
    '\n\nAGENT ROOM: this app has agents of its own (' +
    tm.title +
    '). ' +
    tm.agents
      .map(
        (a) =>
          a.name +
          (a.writes ? ' writes ' + a.writes + (Object.keys(a.fixed).length ? ' with ' + JSON.stringify(a.fixed) : '') : '') +
          (a.updates ? ' updates ' + a.updates : '') +
          (a.sets.length ? ' and sets ' + a.sets.join(', ') + ' on the ' + it.one.toLowerCase() : ''),
      )
      .join('; ') +
    '.\nAlso design "board": the page where people watch these agents work on one ' +
    it.one.toLowerCase() +
    '. Give one panel per table the agents write, 1 to 4 panels, from this catalog only: versus (two values of a select column face to face: set "by" and "sides"; "reply" is a column that points at another row of the same table); list (one card per row: optional "badge" select, "meter" number, "rank" select or number to sort by, "text", "tag", "facts", "link", and "children": a table the agents write that points at this one through "via"); groups (rows sorted by a select column: set "by", optional "only" values); scores (a number per row: set "score", optional "weight" and "max"); options (choices side by side: set "facts" to 1 to 3 number, money or date columns, optional "flag" bool). "verdict" names the columns of the ' +
    it.one.toLowerCase() +
    ' that hold the outcome: "pick" a select, "meter" a number, "text" the summary, "date". "why" is one sentence on why this layout suits what the agents produce.'
  );
};
export const VALUE_RULES =
  'Value rules: a ref value is the 1-based position of the row in the referenced table; a user value is the 1-based position in the users list and must respect the column\'s role; a date is a day offset from today as a number (-3, 0, 7); a datetime is "offset HH:MM" such as "2 14:30"; bool is true or false; select uses one of its options.';
export const APP_ICONS = [
  'apps',
  'stethoscope',
  'headset',
  'beach',
  'box',
  'building',
  'briefcase',
  'cart',
  'money',
  'people',
  'team',
  'calendar',
  'ticket',
  'book',
  'graduation',
  'food',
  'car',
  'dumbbell',
  'leaf',
  'paw',
  'airplane',
  'bed',
  'library',
  'scales',
  'certificate',
  'payment',
  'wrenchScrew',
  'truck',
  'camera',
  'music',
  'heart',
  'clipboard',
  'receipt',
  'shield',
  'rocket',
  'home',
  'globe',
  'tag',
  'star',
  'flag',
];
export const TOUR_RULES =
  'tour: 4 to 7 steps that replay the user stories as an acceptance test, in order. Each step: {"role":"role id","do":"create|see|transition|denied|open","table":"table","values":{},"transition":"transition id","action":"create|update|delete|list","screen":"screen name","say":"one present-tense sentence naming the person"}. create: "values" for the required columns (not status; leave out the owner column when the creating role owns the row). see: that role lists the table and must find the record created earlier. transition: runs a workflow transition on that record; it must be allowed for that role from the record\'s current state. denied: that role attempts "action" on "table" and must be refused by the access rules. open: opens "screen". ' +
  VALUE_RULES;
export const PROMPTS: Dict<(app: BuildApp, f?: string[] | null) => string> = {
  research: (app, f) =>
    HEAD('Researcher') +
    'REQUEST: "' +
    app.request +
    '"\n\nWrite the brief.\n- 2 to 4 roles (kinds of people who sign in).\n- 2 to 5 entities (kinds of record), plural snake_case. No entity for users or roles.\n- One process: the entity whose records move through 3 to 6 states (snake_case). The first state is where a new record starts.\n- 3 to 6 user stories, each for one role id.\n- Up to 4 short rules the backend can enforce (who sees what, who may change status).\n- If one real trade-off needs the owner\'s decision, ask ONE question with 2 or 3 options. Otherwise "question": null.\n\nFORMAT: {"name":"2 or 3 word app name","summary":"one sentence","roles":[{"id":"snake_case","name":"Title","can":"what they do"}],"entities":[{"name":"plural_snake_case","what":"short"}],"process":{"entity":"entity name","states":["first_state","next_state"],"note":"who moves it"},"stories":[{"role":"role id","want":"...","so":"..."}],"rules":["..."],"question":{"text":"...","options":["...","..."],"recommended":0}}' +
    fbText(f),
  database: (app, f) =>
    HEAD('Database') +
    'BRIEF: ' +
    pBrief(app.def.brief) +
    '\n\nDesign the SQLite tables and realistic made-up seed data.\n- One table per entity, with the same names. Every table gets id, created_by and created_at automatically: do not list them.\n- Column types: text, longtext, number, money, date, datetime, bool, select, ref, user. select needs "options" (snake_case). ref needs "ref" (a table name). user links to a person who signs in; add "role" to limit it to one role.\n- The table "' +
    app.def.brief.process.entity +
    '" needs a required select column named "status" with exactly these options: ' +
    app.def.brief.process.states.join(', ') +
    '.\n- "title" is the column shown as the record\'s name. "owner" is the user column that says whose record it is, or null.\n- At most 8 columns per table. No table named users.\n- "users": 5 to 7 people with realistic full names, at least one per role.\n- "rows": 6 to 10 rows per table. ' +
    VALUE_RULES +
    '\n\nFORMAT: {"tables":[{"name":"","label":"Plural","one":"Singular","title":"column","owner":"column or null","columns":[{"name":"","label":"","type":"","required":true,"options":[],"ref":"","role":""}],"rows":[{"column":"value"}]}],"users":[{"name":"Full Name","role":"role id"}]}' +
    fbText(f),
  backend: (app, f) =>
    HEAD('Backend') +
    'BRIEF: ' +
    pBrief(app.def.brief) +
    '\n\nTABLES (name:type, * = required):\n' +
    pTables(app.def) +
    '\n\nWrite the workflow and the access rules.\n- "status": the workflow on table "' +
    app.def.brief.process.entity +
    '", column "status". Use exactly the states stored in that column. Give each a label and a tone (neutral, info, success, warning, danger). "initial" is the first state. Transitions: id (snake_case verb), label, from (list of states), to, roles (role ids). Every state must be reachable. Optional "set": {"column": ":me"} stamps the acting user on a user column.\n- "access": one entry for EVERY table and EVERY role. list: "all", "own" (only rows whose owner is the signed-in user) or "none". create: true or false. update: "all", "own" or "none". delete: true or false. Give each role only what its stories need; every role must be able to list something.\n- Optional "team": only if the app\'s main job is done by AI agents (checking, researching, reviewing, debating), define 2 to 4 app agents that work one after another on one record of the workflow table. Otherwise leave "team" out. {"title":"","about":"one sentence","input":{"table":"workflow table","column":"the long text column the agents read"},"start":"transition id that opens a run","done":"transition id that closes it","agents":[{"id":"","name":"","job":"one sentence","writes":"table it adds rows to","updates":"table whose rows it edits","sets":["columns of the workflow table it fills in"]}]}. Every table an agent writes must link to the workflow table, and one role must be allowed to create and update all of it and to run both transitions.\n\nFORMAT: {"status":{"table":"","column":"status","states":[{"id":"","label":"","tone":""}],"initial":"","transitions":[{"id":"","label":"","from":[""],"to":"","roles":[""]}]},"access":[{"table":"","role":"","list":"","create":false,"update":"","delete":false}]}' +
    fbText(f),
  views: (app, f) =>
    HEAD('View advisor') +
    'TABLES (name:type, * = required):\n' +
    pTables(app.def) +
    '\n\nWORKFLOW:\n' +
    pFlow(app.def) +
    '\n\nRecommend how each table should be viewed, and design one dashboard.\n- Views come from this catalog only: table; board (needs a select column: set "by"); calendar (needs a date: set "date", optional "end"); timeline (needs a date: set "start", optional "end" and "lane"); chart (set "x" to a category or date column, optional "split" and "kind": bar, stack, line or area); pivot (needs two category columns: set "rows" and "cols"); tree (set "levels" to 1 to 3 category columns); cards.\n- Category columns are select, user, ref and bool. Recommend only views that fit the columns: 3 to 8 per table, each with a short "why". Always include table.\n- dashboard: "date" names the table and date column the date filter uses, or null. 5 to 9 widgets, at least two kpi and two charts: {"kind":"kpi","label":"","table":"","where":{"column":"value"},"measure":"count|sum:column|avg:column"}, {"kind":"bar","label":"","table":"","x":"category column"}, {"kind":"stack","label":"","table":"","x":"category column","split":"category column"}, {"kind":"line","label":"","table":"","x":"date column","bucket":"day|week|month"}, {"kind":"recent","label":"","table":""}.\n\nFORMAT: {"views":[{"table":"","use":[{"type":"","why":"","by":"","date":"","start":"","end":"","lane":"","x":"","split":"","rows":"","cols":"","levels":[]}]}],"dashboard":{"title":"","date":{"table":"","column":""},"widgets":[]}' +
    (app.def.team
      ? ',"board":{"why":"","verdict":{"pick":"","meter":"","text":"","date":""},"panels":[{"table":"","layout":"","title":"","by":"","sides":[],"only":[],"badge":"","text":"","tag":"","meter":"","rank":"","score":"","weight":"","facts":[],"flag":"","reply":"","link":"","children":{"table":"","via":"","badge":"","text":"","tag":"","link":""}}]}'
      : '') +
    '}' +
    pRoom(app.def) +
    fbText(f),
  screens: (app, f) =>
    HEAD('UI') +
    'BRIEF: ' +
    pBrief(app.def.brief) +
    '\n\nTABLES:\n' +
    pTables(app.def) +
    '\n\nUSERS: ' +
    pUsers(app.def) +
    '\n\nACCESS:\n' +
    pAccess(app.def) +
    '\n\nWORKFLOW:\n' +
    pFlow(app.def) +
    '\n\nVIEWS THE ADVISOR RECOMMENDED: ' +
    app.def.tables
      .map(
        (t) =>
          t.name +
          ': ' +
          viewsOf(app.def, t)
            .map((v) => v.type)
            .join(', '),
      )
      .join('; ') +
    '\n\nDesign the layout, the screens and a guided tour. You may only pick from this catalog.\n- theme.accent: one of ' +
    ACCENTS.join(', ') +
    '. theme.nav: "side", "top" or "rail". theme.icon: one of ' +
    APP_ICONS.join(', ') +
    ". theme.logo is the app's own icon, drawn from your choice: shape is one of " +
    LOGO_SHAPES.join(', ') +
    '; fill is one of ' +
    LOGO_FILLS.join(', ') +
    '; mark is one of ' +
    LOGO_MARKS.join(', ') +
    '. Pick what suits the kind of work, not the same every time.\n- 4 to 9 screens. type is one of the views recommended for that table (the default view of the page; people can switch to the table\'s other views), or "form" (a page that creates one record), or one "dashboard" page. A dashboard is added for every role automatically.\n- Each screen: name, type, table, roles, columns (3 to 6 column names), icon (same icon list), and optionally "label" (the column shown as the title of a card or calendar entry). A role may only get a screen for a table it may list (for a form: create). Every role needs at least one screen. Use a board for the workflow table.' +
    (app.def.team
      ? ' This app has its own agent team: include one screen of type "agents" on table "' +
        app.def.team.input.table +
        '" for the roles that run it.'
      : '') +
    '\n- ' +
    TOUR_RULES +
    '\n\nFORMAT: {"theme":{"accent":"","nav":"","icon":"","logo":{"shape":"","fill":"","mark":""}},"screens":[{"name":"","type":"","table":"","roles":[""],"columns":[""],"icon":"","label":""}],"tour":[]}' +
    fbText(f),
  walkthrough: (app, f) =>
    HEAD('UI') +
    'TABLES:\n' +
    pTables(app.def) +
    '\n\nUSERS: ' +
    pUsers(app.def) +
    '\n\nACCESS:\n' +
    pAccess(app.def) +
    '\n\nWORKFLOW:\n' +
    pFlow(app.def) +
    '\n\nSCREENS: ' +
    app.def.screens.map((s) => s.name + ' (' + s.roles.join('|') + ')').join('; ') +
    '\n\nThe tour failed as an acceptance test. Write a corrected tour.\n- ' +
    TOUR_RULES +
    '\n\nFORMAT: {"tour":[]}' +
    fbText(f),
};
export const LIVE_SAY: Dict<string> = {
  views: 'Working out which views fit each table, and designing the dashboard.',
  research: 'Reading the request and working out roles, records and the process.',
  database: 'Designing the tables and writing seed data.',
  backend: 'Writing the workflow and the access rules.',
  screens: 'Laying out the pages for each role and writing the tour.',
  walkthrough: 'Rewriting the tour so it passes.',
};
/* The server's step agent reports its draft, check and repair steps; each one goes on the run's timeline under the
   station's open model call (team runs have no such step and are left alone), and into the event log. */
const SERVER_STEP: Dict<[string, string]> = { draft: ['Draft', 'model'], validate: ['Format check', 'check'], repair: ['Repair', 'tool'] };
export function serverStep(run: Run, agent: string, app: AppRecord, p: Untrusted) {
  const kind = p && SERVER_STEP[p.name];
  if (!kind) return;
  emit('CUSTOM', {
    name: 'agent_step',
    app: app.id,
    agent,
    value: { step: p.name, phase: p.phase, attempt: p.attempt, ok: p.ok, issues: p.issues },
  });
  const steps = Array.isArray(run.steps) ? run.steps : [];
  if (p.phase === 'start') {
    const open = steps.findLast && steps.findLast((s) => s.agent === agent && s.kind === 'model' && !s.t1 && !s.sub);
    if (open) stepStart(run, open.station, agent, kind[0] + (p.attempt > 1 ? ' ' + p.attempt : ''), kind[1]).sub = p.name;
  } else {
    const mine = steps.findLast && steps.findLast((s) => s.agent === agent && s.sub === p.name && !s.t1);
    if (mine) stepEnd(mine, p.ok);
  }
  notify();
}
/** Who pays for and may stop a model call: a run of the line, a reviewer, the change planner or an app's own team. */
type CallRun = { id: string; calls: number; tokIn: number; tokOut: number };
export async function callModel(
  app: AppRecord,
  run: CallRun,
  agent: string,
  prompt: string,
  attempt: number,
  ctl?: { stop: boolean; ctrl?: AbortController | null },
): Promise<Untrusted> {
  // ctl: who may stop this call (a build by default, or an app's own agent team)
  if (!online()) throw fatal('The connection is gone, so Live is paused. Run it again when you are back online.');
  if (!LIVE.fn) throw fatal(NO_MODEL);
  if (U.calls >= CAP) throw fatal('This session reached its cap of ' + CAP + ' model calls.');
  const r: { stop?: boolean; ctrl?: AbortController | null } = ctl || RUNS[app.id] || {},
    t0 = performance.now(),
    tier = S.settings.tier === 'quick' ? 'quick' : 'default',
    mid = uid('m');
  let text = '',
    res: { text?: string; truncated?: boolean } | null = null;
  r.ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  U.calls++;
  run.calls++;
  emit('TEXT_MESSAGE_START', {
    messageId: mid,
    role: 'assistant',
    agent,
    app: app.id,
  });
  try {
    res = await LIVE.fn(prompt, {
      modelTier: tier,
      cache: false,
      signal: r.ctrl ? r.ctrl.signal : undefined,
      onText: (p: { text?: string } | null) => {
        text = (p && p.text) || text;
        U.stream[app.id] = text.length;
        notify();
      },
      onStep: (p: Untrusted) => serverStep(run as Run, agent, app, p),
      activity: { app: app.id, agent },
    });
    text = (res && res.text) || text;
  } catch (e) {
    U.stream[app.id] = 0;
    if (r.stop) throw new Stopped();
    const code = (e as { code?: string } | null)?.code;
    if (code === 'not_granted') U.live = 'none';
    throw fatal(
      modelProblem(code, {
        offline: code !== 'not_granted' && !online(),
        detail: (e as { message?: string } | null)?.message || code || 'unknown error',
      }),
    );
  }
  U.stream[app.id] = 0;
  const tin = Math.round(prompt.length / 4),
    tout = Math.round(text.length / 4);
  run.tokIn += tin;
  run.tokOut += tout;
  emit('TEXT_MESSAGE_CONTENT', {
    messageId: mid,
    delta: brief(text, 300),
    agent,
    app: app.id,
  });
  emit('TEXT_MESSAGE_END', {
    messageId: mid,
    agent,
    app: app.id,
  });
  ring(
    MODELCALLS,
    {
      t: Date.now(),
      app: app.id,
      run: run.id,
      agent,
      mode: 'live',
      model: 'Claude · ' + tier,
      tokIn: tin,
      tokOut: tout,
      est: true,
      ms: performance.now() - t0,
      attempt,
    },
    200,
  );
  if (r.stop) throw new Stopped();
  const obj = parseJSONLoose(text);
  if (!obj) throw new Error(res && res.truncated ? 'the answer was cut off before the JSON ended' : 'the answer was not valid JSON');
  return obj;
}
export async function produceLive(app: BuildApp, run: Run, st: Station, attempt: number, feedback: string[] | null) {
  say(app, st.agent, attempt > 1 ? 'Fixing what the check found.' : LIVE_SAY[st.id]);
  const note = str(flowOf(app).notes[st.agent]);
  return callModel(
    app,
    run,
    st.agent,
    PROMPTS[st.id](app, feedback) +
      (note
        ? '\n\nSTANDING INSTRUCTION FROM THE OWNER OF THIS APP. Follow it wherever it does not break the format or the rules above:\n' +
          note
        : ''),
    attempt,
  );
}

/* ---------- running the line ----------
   The owner's workflow is compiled into a LangGraph graph (src/platform/orchestrator). The graph decides the order:
   stations, gates, send-backs, safe defaults, the Researcher's question, added steps, approvals, the Tester and its
   repair rounds. The ports below are what each node does to this app. When the graph waits for the owner, the run
   returns `waiting`; the card in chat answers it and the run resumes. */
/** Human in the loop: the Researcher's question. The graph waits; this shows the card and records the answer. */
export function showQuestion(app: BuildApp, run: Run) {
  const q = app.def.brief.question as NonNullable<Brief['question']>,
    L = app.line.research;
  L.status = 'waiting';
  const s = stepStart(run, 'research', 'orchestrator', 'Waiting for your answer', 'wait');
  const m = say(app, 'researcher', q.text, {
    type: 'question',
    options: q.options,
    recommended: q.recommended,
    answered: null,
  });
  setChat(true);
  return {
    answered(i: number) {
      if (m.card) m.card.answered = i;
      app.answers.q = i;
      app.def.brief.decision = {
        text: q.text,
        answer: q.options[i],
      };
      L.status = 'ok';
      stepEnd(s, true);
      pushChat(app, 'user', q.options[i]);
      commit();
    },
    cancel() {
      stepEnd(s, false);
      if (m.card) m.card.answered = -1;
    },
  };
}
export function answerQuestion(app: AppRecord, i: number) {
  const r = RUNS[app.id];
  if (r && r.answer) {
    r.answer(i);
    if (PHONE() && chatShown()) setChat(false);
  }
} // on a phone, go back to the workflow to watch it continue
export function stopRun(app: AppRecord) {
  const r = RUNS[app.id];
  if (!r) return;
  r.stop = true;
  if (r.abort) r.abort();
  if (r.ctrl) {
    try {
      r.ctrl.abort();
    } catch {}
  }
}
const triesWord = (n: number) => (n === 1 ? 'one attempt' : n === 2 ? 'two attempts' : 'three attempts');
const stationOf = (id: string) => STATIONS[stationIdx(id)];

/** The definition of this run: the owner's workflow, from the station a partial run starts at. */
export function workflowOf(app: AppRecord, from?: string) {
  const f = flowOf(app),
    def = workflowFromFlow(f, (id) => REVIEWERS[id], from);
  // only stations that have built-in rules can be given to code
  def.stations = def.stations.map((s) => (s.byRules && !FALLBACK[s.id] ? { ...s, byRules: undefined } : s));
  return def;
}

/** What each node of the workflow graph does to this app. `cur` holds what one attempt made until its gate reads it. */
/** What runBuild tells the ports: the workflow, whether this is a partial run, and what the orchestrator says first. */
interface LineOpts {
  def: ReturnType<typeof workflowOf>;
  part: boolean;
  first: Station;
  again: string[];
  kept: string[];
  open: () => Promise<void>;
  snapshot: Dict<unknown> | null;
}
function linePorts(app: BuildApp, run: Run, ctl: RunCtl, o: LineOpts): Ports {
  const live = app.mode === 'live',
    cur: { res: StationResult | null; unusable: string[] | null } = { res: null, unusable: null },
    tester = testerSteps(app, run);
  let opened = false;
  // a thrown error leaves the graph as a failed run; one that is not expected is a bug, so say so in the console
  const watch =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      try {
        return await fn(...a);
      } catch (e) {
        if (!(e instanceof Stopped) && !(e as { fatal?: boolean } | null)?.fatal) console.error(e);
        throw e;
      }
    };
  return {
    emit(type, payload) {
      // added steps log their own step events (they also run outside a build)
      if ((type === 'STEP_STARTED' || type === 'STEP_FINISHED') && String(payload.stepName || '').startsWith('review_')) return;
      emit(type, payload);
      if (type === 'RUN_STARTED' && o.snapshot) emit('STATE_SNAPSHOT', { app: app.id, snapshot: o.snapshot });
    },
    stopped: () => !!ctl.stop,
    runStation: watch(async ({ station: sd, attempt, max, feedback, byRules }) => {
      if (!opened) {
        opened = true;
        await o.open();
      }
      const st = stationOf(sd.id),
        L = app.line[st.id],
        agent = st.agent;
      if (attempt === 1) {
        if (U.follow[app.id] !== false) U.sel[app.id] = st.id;
        L.t0 = Date.now();
        L.note = null;
      }
      L.status = 'working';
      L.attempt = attempt;
      if (byRules) {
        // the owner gave this step to code: no agent, no model call
        L.byRules = true;
        commit();
        const s0 = stepStart(run, st.id, 'orchestrator', 'Built-in rules', 'tool');
        await pace(app, 700);
        try {
          cur.res = FALLBACK[st.id](app, run);
        } catch (e) {
          console.error(e);
          cur.res = {
            checks: [chk('The rules could be applied', false, errText(e))],
            facts: [],
          };
        }
        stepEnd(s0, true);
        L.status = 'checking';
        commit();
        await pace(app, 420);
        stepEnd(
          stepStart(run, st.id, 'orchestrator', 'Checks', 'check'),
          cur.res.checks.every((c) => c.ok),
        );
        return;
      }
      commit();
      const fb = cur.unusable || feedback;
      cur.unusable = null;
      let out: Untrusted = null;
      const first = st.id === 'walkthrough' && attempt === 1;
      const s1 = stepStart(
        run,
        st.id,
        agent,
        first ? 'Tour handed over' : attempt > 1 ? 'Retry ' + (attempt - 1) : live ? 'Model call' : 'Replay',
        first ? 'tool' : 'model',
      );
      try {
        out = await produce(app, run, st, attempt, fb);
      } catch (e) {
        stepEnd(s1, false);
        if (e instanceof Stopped || (e as { fatal?: boolean }).fatal) throw e;
        const msg = (e as Error).message;
        cur.unusable = ['The answer was not usable: ' + msg + '. Return one JSON object in the exact format.'];
        cur.res = {
          checks: [chk('Usable JSON answer', false, msg)],
          facts: [],
        };
        return;
      }
      stepEnd(s1, true);
      L.status = 'checking';
      commit();
      await pace(app, 420);
      const s2 = stepStart(run, st.id, 'orchestrator', 'Checks', 'check');
      /* With fewer than three attempts, the last one is checked as it stands first; only if that fails does code repair what it can, on the same answer. */
      const levels = max < 3 && attempt === max ? [Math.min(attempt, 2), 3] : [attempt];
      for (const lv of levels) {
        try {
          const snap = snapshotDef(app.def);
          cur.res = APPLY[st.id](app, out, run, lv);
          recordTouches(app, snap, byRules ? 'rules' : st.agent, run.kind === 'rerun' ? 'rerun' : 'build', run.n);
        } catch (e) {
          console.error(e);
          cur.res = {
            checks: [chk('The output could be applied', false, errText(e))],
            facts: [],
          };
        }
        if (cur.res.checks.every((c) => c.ok)) break;
      }
      stepEnd(s2, !!cur.res && cur.res.checks.every((c) => c.ok));
    }),
    runGate: watch(async ({ station: sd, attempt }) => {
      const L = app.line[sd.id],
        res = cur.res as StationResult,
        issues = issuesOf(res.checks);
      L.checks = res.checks;
      L.facts = res.facts || [];
      L.attempts.push({
        n: attempt,
        ok: !issues.length,
        issues: issues.slice(0, 6),
      });
      return { issues, passed: res.checks.length - issues.length, total: res.checks.length };
    }),
    fallback: watch(async ({ station: sd }) => {
      const st = stationOf(sd.id),
        L = app.line[st.id],
        issues = issuesOf((cur.res as StationResult).checks),
        fb = FALLBACK[st.id] ? FALLBACK[st.id](app, run) : null;
      if (fb && fb.checks.every((c) => c.ok)) {
        L.checks = fb.checks;
        L.facts = fb.facts || [];
        L.fellBack = true;
        say(
          app,
          'orchestrator',
          AGENTS[st.agent].name + ' did not pass after ' + triesWord(o.def.attempts) + ', so I used the safe default for this station.',
        );
        return { ok: true, issues: [] };
      }
      return { ok: false, issues };
    }),
    sentBack: watch(async ({ station: sd, attempt, issues }) => {
      const st = stationOf(sd.id),
        L = app.line[st.id],
        who = AGENTS[st.agent].name;
      run.retries++;
      L.status = 'sentback';
      // a step of its own in the timeline, so a send-back shows where it happened
      const s = stepStart(run, st.id, 'orchestrator', 'Sent back to ' + who, 'check');
      say(app, 'orchestrator', 'A check failed, so I sent the work back to ' + who + '.', {
        type: 'sentback',
        station: st.id,
        attempt,
        issues: issues.slice(0, 4),
      });
      try {
        await pace(app, 1100);
      } finally {
        stepEnd(s, false);
      }
    }),
    stationDone: watch(async ({ station: sd }) => {
      const st = stationOf(sd.id),
        L = app.line[st.id];
      L.status = 'ok';
      L.t1 = Date.now();
      app.rev++;
      emit('STATE_DELTA', {
        app: app.id,
        delta: [
          {
            op: 'replace',
            path: '/' + st.out,
            value: L.facts.join(', '),
          },
        ],
      });
      say(
        app,
        st.id === 'walkthrough' || L.byRules ? 'orchestrator' : st.agent,
        L.byRules ? 'Built by the built-in rules, as you set it: no agent and no model call. ' + DONE_SAY[st.id] : DONE_SAY[st.id],
        CARD[st.id](app),
      );
    }),
    handoff: watch(async ({ station: sd }) => {
      U.handoff[app.id] = stationIdx(sd.id);
      notify();
      await pace(app, 520);
      U.handoff[app.id] = null;
    }),
    runStep: watch(async ({ step }) => {
      // a step the owner removed while the line was running does not run
      if (REVIEWERS[step.id] && flowOf(app).reviewers.includes(step.id)) await runReview(app, step.id, run, false);
    }),
    lateSteps: watch(async () => {
      // steps added while their station had already passed
      const f = flowOf(app);
      return f.reviewers
        .filter((id: string) => REVIEWERS[id] && !app.reviews[id])
        .map((id: string) => ({ id, name: REVIEWERS[id].name, after: stepAfter(f, id), mode: 'advise' as const }));
    }),
    owner: {
      question: async (sd) => {
        const q = sd.id === 'research' && app.def.brief.question;
        return q && app.answers.q == null ? { text: q.text, options: q.options, recommended: q.recommended } : null;
      },
      answered: watch(async ({ index }) => {
        if (ctl.held) ctl.held.answered?.(index);
        ctl.held = null;
      }),
      decided: watch(async ({ approved }) => {
        if (ctl.held) ctl.held.decided?.(approved);
        ctl.held = null;
      }),
    },
    ready: watch(async () => {
      if (app.def.team) {
        const off = teamNeeds(app.def.team).filter((id) => !connOn(id));
        if (off.length) {
          off.forEach((id) => {
            S.conns[id] = true;
          });
          say(
            app,
            'orchestrator',
            "This app's own agents use " +
              off.map((id) => (allConnectors().find((c) => c.id === id) || { name: id }).name).join(' and ') +
              ', so I switched ' +
              (off.length > 1 ? 'those connections' : 'that connection') +
              ' on for this workspace. You can switch ' +
              (off.length > 1 ? 'them' : 'it') +
              ' off under Connections.',
          );
        }
      }
      app.status = 'ready'; /* the app exists; the Tester now decides whether it is fit to release */
      const auto = applyAuto(app, run);
      if (auto.n) await pace(app, 500);
      logChange(app, o.part ? 'Rebuild from ' + o.first.name : 'Rebuild the app from the request', 'database');
    }),
    tester: {
      write: watch(tester.write),
      run: watch(tester.run),
      repair: watch(tester.repair),
      done: watch(tester.done),
    },
    wrapUp: watch(async () => {
      run.status = 'ok';
      if (Object.keys(app.reviews || {}).length) {
        Object.keys(app.reviews).forEach((k) => {
          app.reviews[k].rev = app.rev;
        });
        const v = await verifyFindings(app); /* each review read its own station's output, which later stations did not change */
        if (v.n)
          say(
            app,
            'orchestrator',
            'The reviewers proposed ' +
              v.n +
              (v.n === 1 ? ' fix' : ' fixes') +
              '. I tried each one out in a savepoint and put it back: ' +
              (v.pass === v.n
                ? (v.n === 1 ? 'it passes' : 'all of them pass') + ' every check.'
                : v.pass + ' of ' + v.n + ' pass every check.') +
              ' Nothing is changed until you apply one.',
          );
      }
      say(
        app,
        'orchestrator',
        o.part
          ? 'Done. ' + o.again.join(', ') + ' ran again and ' + o.kept.join(', ') + (o.kept.length > 1 ? ' were kept.' : ' was kept.')
          : app.name +
              ' is ready. ' +
              app.def.tables.length +
              ' tables, ' +
              deriveEndpoints(app.def).length +
              ' endpoints, ' +
              Object.keys(app.def.views).reduce((k, t) => k + app.def.views[t].length, 0) +
              ' views, ' +
              app.def.screens.length +
              ' pages' +
              (app.def.team ? ', a team of ' + app.def.team.agents.length + ' agents' : '') +
              (run.retries ? ', ' + run.retries + ' send-back' + (run.retries > 1 ? 's' : '') : '') +
              '.',
        {
          type: 'ready',
        },
      );
      toast(o.part ? app.name + ' is ready again.' : app.name + ' is ready. Open the App view to use it.', 'success');
    }),
  };
}

/** Wait for the owner's answer to what the run is waiting for. The chat card calls `answer` or `gate`; Stop rejects. */
function ownerAnswer(app: BuildApp, run: Run, ctl: RunCtl, wf: WorkflowRun, ask: AskRequest): Promise<number | boolean> {
  ctl.held = ask.reason === 'question' ? showQuestion(app, run) : showGate(app, run, stationOf(ask.station));
  return new Promise((resolve, reject) => {
    const settle = (v: number | boolean) => {
      ctl.answer = null;
      ctl.gate = null;
      ctl.abort = null;
      resolve(v);
    };
    if (ask.reason === 'question') ctl.answer = (i) => settle(i);
    else ctl.gate = (ok) => settle(!!ok);
    ctl.abort = () => {
      ctl.answer = null;
      ctl.gate = null;
      ctl.abort = null;
      if (ctl.held) ctl.held.cancel();
      ctl.held = null;
      wf.stop();
      reject(new Stopped());
    };
  });
}

export async function runBuild(app: BuildApp, from?: string) {
  // from: a station id to start at. The stations before it are kept as they are.
  if (RUNS[app.id]) return;
  const i0 = from ? Math.max(0, stationIdx(from)) : 0,
    part = i0 > 0,
    live = app.mode === 'live',
    flow = flowOf(app);
  const run = newRun(app, part ? 'rerun' : 'build', part ? 'From ' + STATIONS[i0].name : 'Build', String(app.mode)),
    ctl: RunCtl = (RUNS[app.id] = {
      stop: false,
      runId: run.id,
    });
  // a run that keeps the database can be undone as a whole: if a check fails or it is stopped, the app goes back to what it was
  const keep =
    part && i0 > 1
      ? JSON.stringify({
          def: app.def,
          name: app.name,
          icon: app.icon,
          accent: app.accent,
          seed: app.seed,
          matrix: app.matrix || null,
          line: app.line,
          reviews: app.reviews,
          renamed: app.renamed,
          tests: app.tests || null,
          touched: app.touched || {},
        })
      : null;
  const again = STATIONS.slice(i0).map((s) => s.name),
    kept = STATIONS.slice(0, i0).map((s) => s.name);
  app.status = 'building';
  app.updated = Date.now();
  if (!part) {
    app.def = blankDef() as BackedDef; // the stations fill it in, in order
    app.answers = {};
    app.lookups = [];
    app.matrix = null;
    app.seed = null;
    app.reviews = {};
    app.touched = {};
  }
  STATIONS.forEach((s, i) => {
    if (i >= i0) app.line[s.id] = blankLine();
    else app.line[s.id].note = 'Kept';
  });
  Object.keys(app.reviews || {}).forEach((id) => {
    if (!REVIEWERS[id] || stationIdx(stepAfter(flowOf(app), id)) >= i0) delete app.reviews[id];
  });
  U.sel[app.id] = STATIONS[i0].id;
  U.follow[app.id] = true;
  U.runSel[app.id] = null;
  commit();
  // what the orchestrator says before the first station; it runs inside the graph, so Stop works here too
  const open = async () => {
    if (!part) pushChat(app, 'user', String(app.request));
    say(
      app,
      'orchestrator',
      part
        ? 'Running again from ' +
            STATIONS[i0].name +
            '. ' +
            kept.join(', ') +
            (kept.length > 1 ? ' stay as they are' : ' stays as it is') +
            ', so ' +
            (live
              ? 'only ' + again.length + ' of the six stations call the model, then the Tester.'
              : 'only ' + again.length + ' of the six stations replay, then the Tester.')
        : live
          ? 'Starting a live build. Each agent makes its own model call, code checks every handoff before the next one starts, and the Tester has the last word.'
          : 'Replaying a saved build. Same line, same checks, same SQLite engine, and no model calls.',
    );
    const custom = flowList(flow);
    if (custom.length)
      say(
        app,
        'orchestrator',
        'This app has its own workflow: ' +
          custom.map((x) => x.text.charAt(0).toLowerCase() + x.text.slice(1)).join(', ') +
          '.' +
          (!live && Object.keys(flow.notes).length
            ? ' A saved build replays recorded work, so the instructions take effect in Live builds.'
            : ''),
      );
    await pace(app, 600);
    if (i0 <= 1) dbDrop(app.id);
  };
  let res: Pick<RunResult, 'status' | 'reason' | 'ask'>;
  try {
    const def = workflowOf(app, part ? STATIONS[i0].id : undefined);
    const ports = linePorts(app, run, ctl, {
      def,
      part,
      first: STATIONS[i0],
      again,
      kept,
      open,
      snapshot: part
        ? null
        : {
            request: app.request,
            brief: null,
            schema: null,
            api: null,
            screens: null,
            tour: null,
            workflow: flowList(flow).map((x) => x.text),
          },
    });
    const wf = (ctl.wf = createRun(def, ports, { app: app.id, runId: run.id, threadId: app.id + ':' + run.id }));
    res = await wf.start();
    while (res.status === 'waiting') {
      const answer = await ownerAnswer(app, run, ctl, wf, res.ask as AskRequest);
      res = await wf.resume(answer);
    }
  } catch (e) {
    // Stop while the run waited for the owner (the run has already logged its end), or a workflow that would not compile
    if (e instanceof Stopped) res = { status: 'stopped' };
    else {
      console.error(e);
      res = { status: 'failed', reason: errText(e) };
      emit('RUN_ERROR', { runId: run.id, app: app.id, message: res.reason });
      emit('RUN_FINISHED', { runId: run.id, threadId: app.id, app: app.id, status: 'failed' });
    }
  }
  try {
    const stopped = res.status === 'stopped',
      msg = res.reason || 'The build failed.';
    if (res.status === 'ok') {
      // the wrap-up has said everything
    } else if (keep) {
      // nothing before the first station of this run was touched, and the database kept its tables: put the app back
      const b = JSON.parse(keep);
      app.def = b.def;
      app.name = b.name;
      app.icon = b.icon;
      app.accent = b.accent;
      app.seed = b.seed;
      app.matrix = b.matrix;
      app.line = b.line;
      app.reviews = b.reviews;
      app.renamed = b.renamed;
      app.tests = b.tests;
      app.touched = b.touched;
      app.rev++;
      app.status = 'ready';
      run.status = stopped ? 'stopped' : 'failed';
      say(
        app,
        'orchestrator',
        (stopped ? 'Stopped.' : 'That did not pass. ' + msg) + ' I put the app back exactly as it was.',
        stopped
          ? null
          : {
              type: 'error',
            },
      );
      runTestsSync(app);
    } else if (stopped) {
      run.status = 'stopped';
      app.status = 'stopped';
      STATIONS.forEach((s) => {
        const L = app.line[s.id];
        if (L.status !== 'ok') L.status = 'idle';
      });
      say(app, 'orchestrator', 'Stopped. Run it again when you are ready.');
    } else {
      run.status = 'failed';
      app.status = 'failed';
      STATIONS.forEach((s) => {
        const L = app.line[s.id];
        if (L.status === 'working' || L.status === 'checking' || L.status === 'waiting' || L.status === 'sentback') L.status = 'failed';
      });
      say(app, 'orchestrator', 'The build stopped. ' + msg, {
        type: 'error',
      });
    }
  } finally {
    run.t1 = Date.now();
    if (RUNS[app.id] === ctl) delete RUNS[app.id];
    U.handoff[app.id] = null;
    U.stream[app.id] = 0;
    app.updated = Date.now();
    commit();
  }
}
export function startBuild(o: { request: string; tpl?: string | null }) {
  // o: { request, tpl } · no tpl means a live build from the sentence
  if (!o.tpl && !liveModelOn()) {
    const m = modeNow().id;
    toast(
      m === 'demo'
        ? 'Demo replays saved builds. Switch Live on to build from your own words.'
        : m === 'offline'
          ? 'You are offline, so Live is paused. Pick a saved build, or try again when you are back online.'
          : m === 'checking'
            ? 'Still connecting to the model. Try again in a moment.'
            : NO_MODEL + ' Pick a saved build instead.',
      'warning',
    );
    return null;
  }
  const app = newApp({
    request: o.request,
    tpl: o.tpl,
    mode: o.tpl ? 'demo' : 'live',
  });
  openTab(app.id);
  U.view[app.id] = 'build';
  commit();
  runBuild(app as BuildApp);
  return app;
}
export function rebuild(app: BuildApp) {
  if (RUNS[app.id]) return;
  if (app.mode === 'live') {
    if (!online())
      return void toast(
        'You are offline, so Live is paused. This app was built by the model; run it again when you are back online.',
        'warning',
      );
    if (U.live !== 'ready')
      return void toast(
        U.live === 'unknown'
          ? 'Still connecting to the model. Try again in a moment.'
          : NO_MODEL + ' This app was built by the model, so it cannot be re-run here.',
        'warning',
      );
  }
  app.renamed = false;
  runBuild(app);
}
export function resumeInterrupted() {
  Object.values(S.apps).forEach((app) => {
    if (app.status === 'building') {
      app.status = 'stopped';
      STATIONS.forEach((s) => {
        const L = app.line[s.id];
        if (L && L.status !== 'ok') L.status = 'idle';
      });
      const r = app.runs[app.runs.length - 1];
      if (r && r.status === 'running') {
        r.status = 'stopped';
        r.t1 = r.t1 || Date.now();
      }
      pushChat(app, 'orchestrator', 'The page was reloaded while this build was running. Run it again to finish.');
    }
  });
}
export function duplicateApp(app: AppRecord) {
  // a saved app is its definition plus its SQLite file, so a copy is both
  if (RUNS[app.id] || app.status !== 'ready') return null;
  dbFlush(app.id);
  const id = uid('app'),
    raw = LS.get('db:' + app.id),
    copy = clone(app);
  let name = app.name + ' copy',
    k = 2;
  while (myApps().some((a) => a.name === name)) name = app.name + ' copy ' + k++;
  if (raw && !LS.set('db:' + id, raw)) {
    toast('Browser storage is full, so the copy could not be saved. Delete an app first.', 'danger');
    return null;
  }
  Object.assign(copy, {
    id,
    name,
    renamed: true,
    created: Date.now(),
    updated: Date.now(),
    runs: [],
    chat: [],
    rev: 0,
  });
  Object.keys(copy.reviews || {}).forEach((k) => {
    copy.reviews[k].rev = 0;
  });
  S.apps[id] = copy;
  pushChat(
    copy,
    'orchestrator',
    'This is a copy of ' +
      app.name +
      ', with its tables, data, rules, views and screens. Changes you ask for here apply to this copy only.',
  );
  commit();
  return copy;
}
export function deleteApp(app: AppRecord) {
  stopRun(app);
  stopTeam(app);
  delete TEAMS[app.id];
  delete TESTS[app.id];
  delete SUITES[app.id];
  if (app.shared && S.shared) delete S.shared[app.shared.key];
  if (U.solo && (U.solo as { app?: string }).app === app.id) U.solo = null;
  dbDrop(app.id);
  delete S.apps[app.id];
  Object.keys(S.prefs || {}).forEach((k) => {
    if (k.indexOf(app.id + '|') === 0) delete S.prefs[k];
  });
  Object.keys(S.tabs).forEach((k) => {
    S.tabs[k].forEach((t) => {
      if (t.app === app.id) t.app = null;
    });
  });
  commit();
}
export function resetAppData(app: AppRecord) {
  const r = reseed(app);
  toolCall(
    {
      agent: 'orchestrator',
      appId: app.id,
    },
    'run_sql',
    {
      purpose: 'reset data',
    },
    () => r,
    'backend',
  );
  if (r.problems.length) toast('Reset finished with ' + r.problems.length + ' skipped rows.', 'warning');
  else toast('Data reset. ' + r.rows + ' seed rows are back.', 'success');
  commit();
  return r;
}

export { AGENTS };

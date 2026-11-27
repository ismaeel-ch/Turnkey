/*
 * The build as a plain list of steps, for an owner who does not want to read a workflow canvas.
 *
 * This is the model only: it reads what the build line already records (the stations, the workflow the app runs on,
 * the reviews, the tests) and says it again as one row per job, in plain words. It adds no state of its own, so the
 * list and the canvas behind "Show how it was built" can never disagree. Only the steps this app's workflow has are
 * listed: a review or an approval appears when the workflow holds one. When the app was built from a plan, the team
 * picked from that plan gives each step its name and its reason, and the agents the plan left out are named under
 * the list.
 */
import type { AppDef } from '@/shared/types/app';
import type { AppFlow, AppRecord, Dict, ReviewerInfo } from '@/shared/types/workspace';

/** done, working now, waiting for the owner, not started yet, or stopped on a problem */
export type StepState = 'done' | 'now' | 'ask' | 'wait' | 'bad';

export interface BuildStep {
  /** a station id, `rv_<reviewer>`, `ok_<station>` for an approval, or `tests` */
  id: string;
  kind: 'agent' | 'code' | 'review' | 'approval' | 'tests';
  title: string;
  /** who does it, in plain words */
  who: string;
  /** the agent whose picture stands beside the row; null for the owner and for code */
  agent: string | null;
  /** a reviewer's own picture, when it has no entry in the agent list */
  icon?: string;
  acc?: string;
  state: StepState;
  text: string;
  /** what the owner is asked: the first agent's question, or an approval of this station's work */
  ask?: 'question' | 'approval';
  /** why the plan put this pause here, when it did */
  why?: string;
  /** the station to select behind "Show how it was built" */
  station: string;
}

export interface BuildSteps {
  steps: BuildStep[];
  /** the agents the plan left out for this app, and why */
  skipped: { who: string; why: string }[];
  done: number;
  /** 1-based number of the step the build is at; 0 when every step is done */
  at: number;
  /** the step that waits for the owner, if one does */
  asking: BuildStep | null;
}

/** The stations in the order they run. The walkthrough is code playing the tour, so it is told as part of testing. */
const ORDER = ['research', 'database', 'backend', 'views', 'screens', 'walkthrough'] as const;

/** Each step in plain words: its name, the agent that does it, and what to say while it works or waits. */
const PLAIN: Dict<{ title: string; agent: string; now: string; wait: string }> = {
  research: { title: 'Understand and plan', agent: 'researcher', now: 'Reading your request.', wait: 'Starts first.' },
  database: { title: 'Set up the lists', agent: 'database', now: 'Setting up the lists.', wait: 'Starts once your request is understood.' },
  backend: {
    title: 'Add the rules and approvals',
    agent: 'backend',
    now: 'Writing who can see and do what.',
    wait: 'Starts after the lists.',
  },
  views: {
    title: 'Choose views and the overview',
    agent: 'views',
    now: 'Choosing how each list is best shown.',
    wait: 'Starts after the rules.',
  },
  screens: {
    title: 'Build the screens',
    agent: 'ui',
    now: 'Laying out a screen for each kind of person.',
    wait: 'Starts after the views.',
  },
  tests: {
    title: 'Test everything',
    agent: 'tester',
    now: 'Using the app as each kind of person.',
    wait: 'Runs last, as each kind of person.',
  },
};
/** Plain names for the reviews a plan can add. Any other review keeps the name it has in the library. */
const REVIEW_TITLE: Dict<string> = { security: 'Check who can see what', data: 'Check the lists' };
/** Who a step is credited to when code does it. */
const BY_CODE = 'Turnkey';

const n = (k: number, one: string, many?: string) => k + ' ' + (k === 1 ? one : many || one + 's');
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const list = (a: string[]) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);

/** What one finished station made, read from the definition, in one plain sentence. */
function made(id: string, app: AppRecord): string {
  const def = app.def,
    roles = def.brief ? def.brief.roles.length : 0;
  if (id === 'research') {
    const b = def.brief;
    if (!b) return 'Your request is understood.';
    return (
      n(b.roles.length, 'kind of person', 'kinds of people') +
      ' and ' +
      n(b.entities.length, 'list') +
      ' planned.' +
      (b.decision && b.decision.answer ? ' You chose: ' + b.decision.answer + '.' : '')
    );
  }
  if (id === 'database') {
    const fields = def.tables.reduce((k, t) => k + t.columns.length, 0),
      rows = Object.values((app.seed && app.seed.rows) || {}).reduce((k, r) => k + r.length, 0);
    return n(def.tables.length, 'list') + ' with ' + n(fields, 'field') + (rows ? ', and ' + n(rows, 'example record') : '') + '.';
  }
  if (id === 'backend') {
    const p = def.process,
      who = n(roles, 'kind of person', 'kinds of people');
    if (!p) return 'The rules are written.';
    // an app with no stages has a process with nothing in it: its rules are only who can see and do what
    if (!p.states.length)
      return roles > 1
        ? 'No stages. Who can see and do what is set for ' + who + '.'
        : 'No stages, and one kind of person who can see and do everything.';
    return (
      n(p.states.length, 'stage') +
      ', ' +
      n(p.transitions.length, 'way', 'ways') +
      ' to move a record, and who can see what for ' +
      who +
      '.'
    );
  }
  if (id === 'views') {
    const views = Object.values(def.views || {}).reduce((k, v) => k + v.length, 0),
      charts = def.dash ? def.dash.widgets.length : 0;
    return n(views, 'view') + (charts ? ' and an overview with ' + n(charts, 'tile') : '') + '.';
  }
  if (id === 'screens') return n(def.screens.length, 'screen') + ' for ' + n(roles, 'kind of person', 'kinds of people') + '.';
  return '';
}

/**
 * The rules an owner is asked to check, in plain words: one line for each kind of person, read from the access rules
 * and the moves the app really has, not from what was asked for.
 */
export function rulesInWords(def: AppDef): string[] {
  const roles = def.brief ? def.brief.roles : [],
    out: string[] = [];
  roles.forEach((r) => {
    const all: string[] = [],
      own: string[] = [],
      removes: string[] = [];
    def.tables.forEach((t) => {
      const p = (def.access[t.name] || {})[r.id];
      if (!p) return;
      const name = low(t.label);
      if (p.list === 'all') all.push(name);
      else if (p.list === 'own') own.push(name);
      if (p.delete) removes.push(name);
    });
    const moves = def.process ? def.process.transitions.filter((t) => t.roles.includes(r.id)).map((t) => low(t.label)) : [];
    const sees = [all.length ? 'every record in ' + list(all) : '', own.length ? 'only their own ' + list(own) : ''].filter(Boolean);
    out.push(
      r.name +
        ': ' +
        (sees.length ? 'sees ' + sees.join(', and ') : 'sees no records') +
        '.' +
        (moves.length ? ' Can ' + list(moves.slice(0, 5)) + '.' : '') +
        (removes.length ? ' Can delete from ' + list(removes) + '.' : ''),
    );
  });
  return out;
}

export interface StepsInput {
  app: AppRecord;
  flow: AppFlow;
  /** the review steps a workflow can hold, by id */
  reviewers: Dict<ReviewerInfo>;
  /** the station a review runs after */
  after: (id: string) => string;
  /** what the last test run found, if there was one */
  tests: { total: number; passed: number; failed: number; fresh: boolean } | null;
  /** a run is in progress on this app */
  running: boolean;
  /** the owner's name for each agent and reviewer, by id */
  names: Readonly<Record<string, string>>;
  /** the team picked from the app's plan, when it was built from one: step names, reasons and who was not needed */
  team?: {
    steps: { id: string; name: string; by?: string; why: string }[];
    reviews: { id: string; why: string }[];
    pauses: { after: string; why: string }[];
    notNeeded: { agent: string; who: string; why: string }[];
  } | null;
}

/** The build of this app as a list of steps: only the steps its workflow has, each with where it stands. */
export function buildSteps({ app, flow, reviewers, after, tests, running, names, team }: StepsInput): BuildSteps {
  const steps: BuildStep[] = [],
    line = app.line,
    planned = (id: string) => (team ? team.steps.find((s) => s.id === id) : undefined);
  const extras = (st: string) => {
    flow.reviewers
      .filter((id) => reviewers[id] && after(id) === st)
      .forEach((id) => {
        const rv = reviewers[id],
          R = (app.reviews || {})[id],
          why = team ? team.reviews.find((x) => x.id === id)?.why : undefined,
          open = R && R.status === 'ok' ? R.findings.filter((f) => f.state === 'open').length : 0,
          did = R && R.status === 'ok' ? R.findings.filter((f) => f.state === 'applied').length : 0;
        steps.push({
          id: 'rv_' + id,
          kind: 'review',
          title: REVIEW_TITLE[id] || (rv.custom ? rv.name : rv.short),
          who: rv.custom ? 'Your agent' : names[id] || rv.name,
          agent: null,
          icon: rv.icon,
          acc: rv.acc,
          station: 'rv_' + id,
          state: !R ? 'wait' : R.status === 'working' ? 'now' : R.status === 'failed' ? 'bad' : 'done',
          text: !R
            ? why || 'Reads ' + rv.reads + ' once they are made.'
            : R.status === 'working'
              ? 'Reading ' + rv.reads + '.'
              : R.status === 'failed'
                ? 'This check did not finish. The build went on without it.'
                : open
                  ? n(open, 'suggestion') + ' for you in chat.'
                  : did
                    ? n(did, 'change') + ' made, each one checked.'
                    : 'Read ' + rv.reads + '. Nothing needs to change.',
        });
      });
    if (flow.approve[st]) {
      const L = line[st],
        held = !!L && L.status === 'waiting' && L.hold === 'approval',
        ok = !!L && !!L.approved && L.status === 'ok',
        rules = st === 'backend',
        why = team ? team.pauses.find((x) => x.after === st)?.why : undefined;
      // a pause added after the build went past this point belongs to the next build, not to the one this list tells
      if (!held && !ok && !running && !!L && L.status === 'ok') return;
      steps.push({
        id: 'ok_' + st,
        kind: 'approval',
        title: 'Your approval',
        who: 'You',
        agent: null,
        station: st,
        state: held ? 'ask' : ok ? 'done' : 'wait',
        ask: held ? 'approval' : undefined,
        why,
        text: held
          ? rules
            ? 'Waiting for you: do the rules look right?'
            : 'Waiting for you: does this look right?'
          : ok
            ? rules
              ? 'You approved the rules.'
              : 'You approved this step.'
            : why || 'The build stops here until you say it looks right.',
      });
    }
  };
  ORDER.forEach((id) => {
    if (id === 'walkthrough') return extras(id);
    const L = line[id],
      p = PLAIN[id],
      plan = planned(id);
    if (!L) return;
    const byCode = !!L.byRules || flow.by[id] === 'rules',
      // the plan's words for a step fit only when the step was done the way the plan said: by an agent, or by code
      fits = !!plan && (!plan.by || (plan.by === 'code') === byCode),
      held = L.status === 'waiting' && L.hold === 'approval',
      state: StepState =
        L.status === 'ok' || held
          ? 'done'
          : L.status === 'waiting'
            ? 'ask'
            : L.status === 'failed'
              ? 'bad'
              : L.status === 'idle'
                ? 'wait'
                : 'now';
    steps.push({
      id,
      kind: byCode ? 'code' : 'agent',
      title: plan && fits ? plan.name : p.title,
      who: byCode ? BY_CODE : names[p.agent] || '',
      agent: byCode ? null : p.agent,
      station: id,
      state,
      ask: state === 'ask' ? 'question' : undefined,
      text:
        state === 'done'
          ? made(id, app) + (L.attempt > 1 ? ' One part was sent back and fixed.' : '')
          : state === 'ask'
            ? 'Waiting for you: one question in chat.'
            : state === 'bad'
              ? 'This step did not finish.'
              : state === 'wait'
                ? (plan && fits && plan.why) || p.wait
                : L.status === 'sentback'
                  ? 'One part was not right. It is being fixed.'
                  : L.status === 'checking'
                    ? 'Checking the work.'
                    : p.now,
    });
    extras(id);
  });
  {
    // the last step: code plays the app end to end, then the Tester's cases and every generated test run
    const W = line.walkthrough,
      Q = app.qa,
      p = PLAIN.tests,
      busy = (s: string | undefined) => s === 'working' || s === 'checking' || s === 'sentback',
      fixes = Q ? Q.rounds.reduce((k, r) => k + r.fixes.filter((f) => f.ok).length, 0) : 0,
      tried = !!W && W.status === 'ok',
      fresh = !!tests && tests.fresh,
      state: StepState =
        !W || W.status === 'idle'
          ? 'wait'
          : busy(W.status) || (tried && (busy(Q ? Q.status : undefined) || (running && !fresh)))
            ? 'now'
            : W.status === 'failed' || (tried && ((Q && Q.status === 'failed') || (fresh && tests.failed > 0)))
              ? 'bad'
              : tried && fresh
                ? 'done'
                : 'wait';
    steps.push({
      id: 'tests',
      kind: 'tests',
      title: p.title,
      who: names[p.agent] || '',
      agent: p.agent,
      station: 'qa',
      state,
      text:
        state === 'done' && tests
          ? n(tests.total, 'check') + ', all pass.' + (fixes ? ' ' + n(fixes, 'problem') + ' found and fixed on the way.' : '')
          : state === 'bad'
            ? tests && tests.fresh && tests.failed
              ? tests.failed + ' of ' + n(tests.total, 'check') + ' do not pass yet.'
              : 'Testing did not finish.'
            : state === 'now'
              ? p.now
              : tried && tests && !tests.fresh
                ? 'The app changed since the checks last ran.'
                : planned('tests')?.why || p.wait,
    });
  }
  const done = steps.filter((s) => s.state === 'done').length,
    first = steps.findIndex((s) => s.state !== 'done');
  return {
    steps,
    // the plan says who was not needed; the workflow says who ran. An agent the owner put back to work is not listed.
    skipped: team
      ? team.notNeeded
          .filter((x) => !flow.reviewers.includes(x.agent) && !steps.some((st) => st.agent === x.agent))
          .map((x) => ({ who: x.who, why: x.why }))
      : [],
    done,
    at: first + 1,
    asking: steps.find((s) => s.state === 'ask') || null,
  };
}

/** The heading over the list and the line under it. */
export function stepsHeadline(app: AppRecord, S: BuildSteps, busy: boolean): { title: string; sub: string } {
  const total = S.steps.length,
    cur = S.steps[S.at - 1];
  if (busy || app.status === 'building')
    return {
      title: 'Building ' + app.name,
      sub:
        'Step ' +
        Math.max(1, S.at) +
        ' of ' +
        total +
        (S.asking ? '. The build is paused for one answer from you.' : cur ? ': ' + low(cur.title) + '.' : '.'),
    };
  if (app.status === 'ready')
    return S.at === 0
      ? { title: app.name + ' is built', sub: 'All ' + n(total, 'step') + ' are done. Every check passes.' }
      : {
          title: app.name + ' is built',
          sub:
            cur && cur.state === 'bad'
              ? 'One step needs a look: ' + low(cur.title) + '.'
              : S.done + ' of ' + n(total, 'step') + ' are done.',
        };
  if (app.status === 'failed')
    return { title: app.name + ' did not finish', sub: 'The build stopped at step ' + Math.max(1, S.at) + ' of ' + total + '.' };
  return { title: app.name + ' is not finished', sub: 'The build was stopped at step ' + Math.max(1, S.at) + ' of ' + total + '.' };
}

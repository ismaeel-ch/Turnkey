import { describe, expect, it } from 'vitest';
import { AGENT_NAMES, COMPANY_EXPENSES, PERSONAL_EXPENSES, planFromDef, teamFor } from '@/shared/plan';
import type { AppDef } from '@/shared/types/app';
import type { AppFlow, AppRecord, ReviewerInfo, StationLine } from '@/shared/types/workspace';
import { type StepsInput, buildSteps, rulesInWords, stepsHeadline } from '@/workspace/steps';

/* The Build tab's plain list of steps is a second telling of what the build line records. These tests give the model a
   build line by hand, at the moments an owner looks at it, and read the list it makes. */

const STATIONS = ['research', 'database', 'backend', 'views', 'screens', 'walkthrough'];
const line = (status: string, more: Partial<StationLine> = {}): StationLine => ({
  status,
  attempt: status === 'idle' ? 0 : 1,
  attempts: [],
  checks: [],
  facts: [],
  note: null,
  results: [],
  ...more,
});
const flow = (more: Partial<AppFlow> = {}): AppFlow => ({
  attempts: 3,
  approve: {},
  notes: {},
  by: {},
  reviewers: [],
  agents: [],
  at: {},
  auto: {},
  ...more,
});

/** A made-up claims app: two kinds of people, two lists, three stages. */
const def = {
  brief: {
    name: 'Claims desk',
    summary: '',
    roles: [
      { id: 'employee', name: 'Employee', can: '' },
      { id: 'manager', name: 'Manager', can: '' },
    ],
    entities: [
      { name: 'claims', what: '' },
      { name: 'categories', what: '' },
    ],
    process: { entity: 'claims', states: ['draft', 'sent', 'approved'], note: '' },
    stories: [],
    rules: [],
    question: null,
    decision: { text: 'Who approves?', answer: 'Managers only' },
    sources: [],
  },
  tables: [
    { name: 'claims', label: 'Claims', one: 'Claim', columns: [{ name: 'title' }, { name: 'amount' }, { name: 'status' }] },
    { name: 'categories', label: 'Categories', one: 'Category', columns: [{ name: 'name' }] },
  ],
  users: [],
  process: {
    table: 'claims',
    column: 'status',
    initial: 'draft',
    states: [
      { id: 'draft', label: 'Draft', tone: 'neutral' },
      { id: 'sent', label: 'Sent', tone: 'info' },
      { id: 'approved', label: 'Approved', tone: 'success' },
    ],
    transitions: [
      { id: 'send', label: 'Send', from: ['draft'], to: 'sent', roles: ['employee'], set: {} },
      { id: 'approve', label: 'Approve', from: ['sent'], to: 'approved', roles: ['manager'], set: {} },
    ],
  },
  access: {
    claims: {
      employee: { list: 'own', create: true, update: 'own', delete: false },
      manager: { list: 'all', create: false, update: 'all', delete: true },
    },
    categories: {
      employee: { list: 'all', create: false, update: 'none', delete: false },
      manager: { list: 'all', create: true, update: 'all', delete: false },
    },
  },
  team: null,
  views: { claims: [{}, {}], categories: [{}] },
  dash: { widgets: [{}, {}, {}] },
  screens: [{}, {}, {}, {}],
  theme: {},
  tour: [],
  actions: [],
  migrations: [],
} as unknown as AppDef;

function app(status: string, lines: Record<string, StationLine>, more: Partial<AppRecord> = {}): AppRecord {
  const all: Record<string, StationLine> = {};
  STATIONS.forEach((id) => (all[id] = lines[id] || line('idle')));
  return {
    id: 'a1',
    name: 'Claims desk',
    status,
    def,
    line: all,
    seed: { rows: { claims: [{}, {}, {}], categories: [{}] } },
    ...more,
  } as unknown as AppRecord;
}
const REVIEWERS: Record<string, ReviewerInfo> = {
  security: {
    name: 'Security reviewer',
    short: 'Security review',
    after: 'backend',
    icon: 'shieldKey',
    acc: 'cranberry',
    reads: 'the access rules',
    job: '',
  },
};
const input = (a: AppRecord, more: Partial<StepsInput> = {}): StepsInput => ({
  app: a,
  flow: flow(),
  reviewers: REVIEWERS,
  after: (id) => REVIEWERS[id].after,
  tests: null,
  running: false,
  names: AGENT_NAMES,
  team: null,
  ...more,
});
const built = () => {
  const lines: Record<string, StationLine> = {};
  STATIONS.forEach((id) => (lines[id] = line('ok')));
  return lines;
};
const pass = { total: 40, passed: 40, failed: 0, fresh: true };

describe('the build as a list of steps', () => {
  it('lists six steps for a standard build, each with the plain name of its agent', () => {
    const B = buildSteps(input(app('building', { research: line('working') }), { running: true }));
    expect(B.steps.map((s) => s.title + ' / ' + s.who)).toEqual([
      'Understand and plan / Planner',
      'Set up the lists / List builder',
      'Add the rules and approvals / Rules builder',
      'Choose views and the overview / View advisor',
      'Build the screens / Screen designer',
      'Test everything / Tester',
    ]);
    expect(B.steps.map((s) => s.state)).toEqual(['now', 'wait', 'wait', 'wait', 'wait', 'wait']);
    expect(B.at).toBe(1);
    expect(B.skipped).toEqual([]);
  });

  it('says what each finished step made, from the definition', () => {
    const B = buildSteps(input(app('ready', { ...built(), database: line('ok', { attempt: 2 }) }), { tests: pass }));
    expect(B.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
    expect(B.steps.map((s) => s.text)).toEqual([
      '2 kinds of people and 2 lists planned. You chose: Managers only.',
      '2 lists with 4 fields, and 4 example records. One part was sent back and fixed.',
      '3 stages, 2 ways to move a record, and who can see what for 2 kinds of people.',
      '3 views and an overview with 3 tiles.',
      '4 screens for 2 kinds of people.',
      '40 checks, all pass.',
    ]);
    expect(B.at).toBe(0);
    expect(stepsHeadline(app('ready', built()), B, false)).toEqual({
      title: 'Claims desk is built',
      sub: 'All 6 steps are done. Every check passes.',
    });
  });

  it('does not count stages for an app that has none', () => {
    // an app planned with no stages keeps a process with nothing in it
    const empty = { table: '', column: '', initial: '', states: [], transitions: [] };
    const several = { ...def, process: empty } as unknown as AppDef;
    const alone = { ...several, brief: { ...def.brief, roles: [def.brief?.roles[0]] } } as unknown as AppDef;
    const text = (d: AppDef) => buildSteps(input(app('ready', built(), { def: d }), { tests: pass })).steps[2].text;
    expect(text(several)).toBe('No stages. Who can see and do what is set for 2 kinds of people.');
    expect(text(alone)).toBe('No stages, and one kind of person who can see and do everything.');
  });

  it('shows the first agent waiting for an answer as the step that needs the owner', () => {
    const a = app('building', { research: line('waiting', { hold: 'question' }) });
    const B = buildSteps(input(a, { running: true }));
    expect(B.steps[0]).toMatchObject({ state: 'ask', ask: 'question' });
    expect(B.asking?.id).toBe('research');
    expect(stepsHeadline(a, B, true).sub).toBe('Step 1 of 6. The build is paused for one answer from you.');
  });

  it('adds a step for an approval the workflow holds, and asks there while the build waits', () => {
    const lines = { research: line('ok'), database: line('ok'), backend: line('waiting', { hold: 'approval' }) };
    const a = app('building', lines);
    const B = buildSteps(input(a, { flow: flow({ approve: { backend: true } }), running: true }));
    expect(B.steps.map((s) => s.id)).toEqual(['research', 'database', 'backend', 'ok_backend', 'views', 'screens', 'tests']);
    // the station's own work is done: it is the owner's step that is open
    expect(B.steps[2].state).toBe('done');
    expect(B.steps[3]).toMatchObject({
      kind: 'approval',
      who: 'You',
      state: 'ask',
      ask: 'approval',
      text: 'Waiting for you: do the rules look right?',
    });
    expect(stepsHeadline(a, B, true).sub).toBe('Step 4 of 7. The build is paused for one answer from you.');
    lines.backend = line('ok', { approved: 1 });
    const after = buildSteps(input(app('building', lines), { flow: flow({ approve: { backend: true } }), running: true }));
    expect(after.steps[3]).toMatchObject({ state: 'done', text: 'You approved the rules.' });
    // a pause added to an app that is already built is for its next build: the list of this build does not grow a step
    const later = buildSteps(input(app('ready', built()), { flow: flow({ approve: { backend: true } }), tests: pass }));
    expect(later.steps.map((s) => s.id)).not.toContain('ok_backend');
    expect(later.at).toBe(0);
  });

  it('adds a review after the step it reads, with what it found', () => {
    const f = flow({ reviewers: ['security'] });
    const waiting = buildSteps(input(app('building', { research: line('ok') }), { flow: f, running: true }));
    expect(waiting.steps.map((s) => s.id)).toEqual(['research', 'database', 'backend', 'rv_security', 'views', 'screens', 'tests']);
    expect(waiting.steps[3]).toMatchObject({ title: 'Check who can see what', who: 'Access checker', state: 'wait' });
    const reviews = {
      security: { status: 'ok', at: 1, rev: 1, by: 'rules', note: '', findings: [{ state: 'applied' }, { state: 'open' }] },
    };
    const done = buildSteps(input(app('ready', built(), { reviews } as unknown as Partial<AppRecord>), { flow: f, tests: pass }));
    expect(done.steps[3]).toMatchObject({ state: 'done', text: '1 suggestion for you in chat.' });
  });

  it('credits a step to Turnkey when code did it', () => {
    const B = buildSteps(
      input(app('ready', { ...built(), views: line('ok', { byRules: true }) }), { flow: flow({ by: { views: 'rules' } }), tests: pass }),
    );
    expect(B.steps[3]).toMatchObject({ kind: 'code', who: 'Turnkey', agent: null, state: 'done' });
  });

  it('keeps testing open while the Tester works, and says so when a check fails', () => {
    const lines = built();
    // the app exists and the Tester has started: the last step is the one in progress
    const working = buildSteps(input(app('ready', lines), { running: true, tests: null }));
    expect(working.steps[5].state).toBe('now');
    expect(stepsHeadline(app('ready', lines), working, true)).toEqual({
      title: 'Building Claims desk',
      sub: 'Step 6 of 6: test everything.',
    });
    const failing = buildSteps(input(app('ready', lines), { tests: { total: 40, passed: 38, failed: 2, fresh: true } }));
    expect(failing.steps[5]).toMatchObject({ state: 'bad', text: '2 of 40 checks do not pass yet.' });
    expect(stepsHeadline(app('ready', lines), failing, false).sub).toBe('One step needs a look: test everything.');
    // a new build has reset the line: an old test result does not make the last step look done
    const again = buildSteps(input(app('building', { research: line('working') }), { running: true, tests: pass }));
    expect(again.steps[5]).toMatchObject({ state: 'wait', text: 'Runs last, as each kind of person.' });
    // a built app that was changed since its checks ran says so
    const stale = buildSteps(input(app('ready', lines), { tests: { ...pass, fresh: false } }));
    expect(stale.steps[5]).toMatchObject({ state: 'wait', text: 'The app changed since the checks last ran.' });
  });

  it('names a stopped build and where it stopped', () => {
    const a = app('failed', { research: line('ok'), database: line('failed') });
    const B = buildSteps(input(a));
    expect(B.steps[1]).toMatchObject({ state: 'bad', text: 'This step did not finish.' });
    expect(stepsHeadline(a, B, false)).toEqual({ title: 'Claims desk did not finish', sub: 'The build stopped at step 2 of 6.' });
  });
});

describe('the steps of an app built from a plan', () => {
  it('uses the plan for step names, reasons and the agents that were not needed', () => {
    const team = teamFor(PERSONAL_EXPENSES);
    const B = buildSteps(
      input(app('building', { research: line('ok'), backend: line('idle', { byRules: true }) }), {
        flow: flow({ by: { backend: 'rules' } }),
        team,
        running: true,
      }),
    );
    expect(B.steps[2]).toMatchObject({ title: 'Add the rules', who: 'Turnkey', kind: 'code' });
    expect(B.steps[1].text).toBe(team.steps[1].why);
    expect(B.skipped.map((s) => s.who)).toEqual(['Rules builder', 'Access checker', 'List checker']);
  });

  it('does not call an agent "not needed" when the workflow put it to work', () => {
    const team = teamFor(PERSONAL_EXPENSES);
    // the plan would leave the rules to code and skip the access check; this workflow runs both
    const B = buildSteps(
      input(app('building', { research: line('ok') }), { flow: flow({ reviewers: ['security'] }), team, running: true }),
    );
    expect(B.steps[2]).toMatchObject({ title: 'Add the rules and approvals', who: 'Rules builder', kind: 'agent' });
    expect(B.steps[2].text).toBe('Starts after the lists.');
    expect(B.skipped.map((s) => s.who)).toEqual(['List checker']);
  });

  it('reads the plan of a saved build off what was built', () => {
    const plan = planFromDef(def);
    expect(plan).not.toBeNull();
    if (!plan) return;
    const B = buildSteps(input(app('ready', built()), { team: teamFor(plan), tests: pass }));
    expect(B.steps.map((s) => s.title)).toEqual([
      'Understand and plan',
      'Set up the lists',
      'Add the rules and approvals',
      'Choose views and the overview',
      'Build the screens',
      'Test everything',
    ]);
    expect(B.steps.every((s) => s.state === 'done')).toBe(true);
    expect(B.skipped.map((s) => s.who)).toEqual(['List checker']);
  });

  it('gives the pause the reason the plan gave it', () => {
    const team = teamFor(COMPANY_EXPENSES);
    const B = buildSteps(
      input(app('building', { research: line('ok') }), {
        flow: flow({ approve: { backend: true }, reviewers: ['security'] }),
        team,
        running: true,
      }),
    );
    expect(B.steps.map((s) => s.id)).toEqual(['research', 'database', 'backend', 'rv_security', 'ok_backend', 'views', 'screens', 'tests']);
    expect(B.steps[4].why).toBe(team.pauses[0].why);
    expect(B.steps[3].text).toBe(team.reviews[0].why);
  });
});

describe('the rules in plain words', () => {
  it('writes one line for each kind of person from the access rules and the moves', () => {
    expect(rulesInWords(def)).toEqual([
      'Employee: sees every record in categories, and only their own claims. Can send.',
      'Manager: sees every record in claims and categories. Can approve. Can delete from claims.',
    ]);
  });
});

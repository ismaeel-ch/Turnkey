import { REC } from './registry';
import { CARDS } from './catalog';
import type { AccessRule, Dict } from '@/shared/types/workspace';

/* ===== Turnkey · three saved builds a software house runs on =====
   The apps a software house asks for about itself, beside the ones it builds for clients. Each works numbers out,
   enforces rules and holds moves back until a condition is met (src/shared/logic):
   - sprints     a sprint board with bug triage: story points against capacity, critical bugs that cannot be dropped
   - billing     timesheets and client billing: hours priced at the project's rate, invoices, payments and what is owed
   - onboarding  client onboarding: a checklist and a team for each new client, and go-live only once it is ready
   All people, companies and amounts are made up. */

type Perm = Omit<AccessRule, 'table' | 'role'>;
const ALL: Perm = { list: 'all', create: true, update: 'all', delete: true };
const EDIT: Perm = { list: 'all', create: true, update: 'all', delete: false };
const LOOK: Perm = { list: 'all', create: false, update: 'none', delete: false };
const MINE: Perm = { list: 'own', create: true, update: 'own', delete: false };
const NONE: Perm = { list: 'none', create: false, update: 'none', delete: false };
const rules = (table: string, by: Dict<Perm>): AccessRule[] => Object.entries(by).map(([role, p]) => ({ table, role, ...p }));
const noQuestion = { question: null };

/* ---------- a sprint board with bug triage ---------- */

// [name, starts, ends, capacity in points, goal]
const SPRINTS: [string, number, number, number, string][] = [
  ['Sprint 13', -24, -11, 38, 'Checkout works well on phones.'],
  ['Sprint 14', -10, 3, 40, 'Customers can pay by bank transfer.'],
  ['Sprint 15', 4, 17, 40, 'Search is fast and forgives typos.'],
];
// [title, kind, severity, points, sprint, component, assignee, reported by, what was changed, stage, verified by]
type Item = [
  string,
  string,
  string | null,
  number | null,
  number | null,
  number,
  number | null,
  number,
  string | null,
  string,
  number | null,
];
const ITEMS: Item[] = [
  ['Card form fits small screens', 'story', null, 8, 1, 1, 1, 5, 'The form fields stack on screens under 400 px.', 'done', 4],
  [
    'Pay button hidden behind the keyboard',
    'bug',
    'high',
    5,
    1,
    3,
    3,
    4,
    'The button scrolls into view when the keyboard opens.',
    'done',
    4,
  ],
  ['Save a card for next time', 'story', null, 13, 1, 1, 2, 5, 'The payment provider keeps the card; we keep a token.', 'done', 4],
  ['Wrong total after removing a coupon', 'bug', 'critical', 3, 1, 1, 1, 4, 'The total is worked out again when a coupon goes.', 'done', 4],
  ['Refunds by day for the admin', 'story', null, 5, 1, 4, 3, 5, 'A new page lists refunds grouped by day.', 'done', 4],
  ['Bank transfer as a way to pay', 'story', null, 13, 2, 1, 1, 5, null, 'in_progress', null],
  [
    'Transfer details on the receipt',
    'story',
    null,
    5,
    2,
    1,
    2,
    5,
    'The receipt shows the account number and the reference.',
    'in_qa',
    null,
  ],
  ['Order stuck as pending after a transfer', 'bug', 'critical', 3, 2, 1, 1, 4, null, 'to_do', null],
  ['Search ignores accents', 'bug', 'medium', 3, 2, 2, 2, 4, 'Accents are folded before matching.', 'done', 4],
  ['Notice on the phone when a payment arrives', 'story', null, 5, 2, 3, 3, 5, null, 'in_progress', null],
  ['Crash when opening an old order', 'bug', 'high', 2, 2, 3, 3, 4, 'Old orders without a delivery date open again.', 'in_qa', null],
  ['Suggestions while typing a search', 'story', null, 8, 3, 2, 2, 5, null, 'to_do', null],
  ['Dark mode in the mobile app', 'story', null, 8, 3, 3, null, 5, null, 'backlog', null],
  ['Export orders to a spreadsheet', 'story', null, 5, null, 4, null, 5, null, 'backlog', null],
  ['Typo on the password reset page', 'bug', 'low', 1, null, 4, null, 4, null, 'backlog', null],
  ['Slow search on long product names', 'bug', 'medium', null, null, 2, null, 4, null, 'backlog', null],
  ['Admin can sign in without the second step', 'bug', 'critical', 3, null, 4, null, 4, null, 'backlog', null],
];

REC.sprints = {
  ...CARDS.sprints,
  usage: {
    research: [1310, 710, 6350],
    database: [2940, 3180, 15100],
    backend: [3560, 1120, 8700],
    views: [2830, 1340, 8900],
    ui: [4280, 1530, 10550],
  },
  say: {
    research: [
      'Reading the request. Work items are stories and bugs with story points, planned into sprints that have a capacity.',
      'Three kinds of people. The app adds up the points in each sprint, counts the open critical bugs and refuses a sprint that is overfull.',
    ],
    database: ['Creating the lists. A sprint totals the points planned into it and the points done; a component counts its open bugs.'],
    backend: [
      'Writing the rules: a sprint never takes more points than its capacity, a critical bug cannot be closed as won’t fix, and only a tester marks work as done.',
    ],
    views: [
      'Work items have a stage, a sprint and a person, so a board with a lane per sprint, a tree and charts by component fit.',
      'The dashboard shows what is left in the current sprint and where the critical bugs are.',
    ],
    ui: ['Laying out the pages: the sprint board, the backlog, bug triage, sprints and components. Royal blue, side navigation.'],
  },
  research: () => ({
    name: 'Sprint Board',
    summary: 'Plan sprints from a backlog of stories and bugs, keep each sprint within its capacity, and triage bugs by severity.',
    reflect:
      'An app for a software team: what is in the backlog, what goes into each sprint, who works on it, and whether testers have checked it.',
    planned: true,
    settings: ['components'],
    roles: [
      { id: 'developer', name: 'Developer', can: 'Picks up work, fixes it and says what was changed' },
      { id: 'tester', name: 'Tester', can: 'Reports bugs, checks finished work and marks it done or sends it back' },
      { id: 'product_owner', name: 'Product owner', can: 'Orders the backlog, plans sprints and decides what is not fixed' },
    ],
    entities: [
      { name: 'work_items', what: 'A story or a bug, with its story points, sprint and stage' },
      { name: 'sprints', what: 'Two weeks of work with a capacity in points, and the points planned and done worked out' },
      { name: 'components', what: 'The parts of the product, each with its open bugs counted' },
    ],
    process: {
      entity: 'work_items',
      states: ['backlog', 'to_do', 'in_progress', 'in_qa', 'done', 'wont_fix'],
      note: 'The product owner plans an item into a sprint. A developer works on it and sends it to QA. A tester marks it done or sends it back.',
    },
    stories: [
      { role: 'tester', want: 'report a bug with its severity', so: 'the worst ones are fixed first' },
      { role: 'product_owner', want: 'plan work into a sprint and be stopped when it is full', so: 'the team commits to what it can do' },
      { role: 'developer', want: 'see my work on one board and say what I changed', so: 'the tester knows what to check' },
      { role: 'tester', want: 'mark work done only after checking it', so: 'nothing ships untested' },
      { role: 'product_owner', want: 'see open critical bugs by component', so: 'I can step in before a release' },
    ],
    rules: [
      'A sprint cannot take more story points than its capacity.',
      'An item is planned only once it has a sprint and story points.',
      'A developer sends work to QA only after writing what was changed.',
      'Only a tester marks work as done. Done work can no longer be changed.',
      'A critical bug cannot be closed as won’t fix.',
      'Story points go from 0 to 13. Anything bigger is split first.',
    ],
    ...noQuestion,
    notInThisVersion: [
      { ask: 'A link to the code change for each item', instead: 'The developer writes what was changed on the item itself' },
    ],
  }),
  database: () => ({
    tables: [
      {
        name: 'work_items',
        label: 'Work items',
        one: 'Work item',
        title: 'title',
        owner: 'reported_by',
        columns: [
          { name: 'title', label: 'Title', type: 'text', required: true },
          { name: 'kind', label: 'Kind', type: 'select', required: true, options: ['story', 'bug', 'chore'] },
          { name: 'severity', label: 'Severity', type: 'select', options: ['low', 'medium', 'high', 'critical'] },
          { name: 'points', label: 'Story points', type: 'number' },
          { name: 'sprint', label: 'Sprint', type: 'ref', ref: 'sprints' },
          { name: 'component', label: 'Component', type: 'ref', ref: 'components' },
          { name: 'assignee', label: 'Assigned to', type: 'user', role: 'developer' },
          { name: 'reported_by', label: 'Reported by', type: 'user' },
          { name: 'fix_notes', label: 'What was changed', type: 'longtext' },
          { name: 'verified_by', label: 'Checked by', type: 'user' },
          {
            name: 'urgency',
            label: 'Urgency',
            type: 'select',
            options: ['fix_now', 'next_up', 'normal'],
            formula: "if(kind = 'bug' and severity = 'critical', 'fix_now', if(kind = 'bug' and severity = 'high', 'next_up', 'normal'))",
          },
          {
            name: 'status',
            label: 'Stage',
            type: 'select',
            required: true,
            options: ['backlog', 'to_do', 'in_progress', 'in_qa', 'done', 'wont_fix'],
          },
        ],
        rows: ITEMS.map(([title, kind, severity, points, sprint, component, assignee, reported_by, fix_notes, status, verified_by]) => ({
          title,
          kind,
          severity,
          points,
          sprint,
          component,
          assignee,
          reported_by,
          fix_notes,
          status,
          verified_by,
        })),
      },
      {
        name: 'sprints',
        label: 'Sprints',
        one: 'Sprint',
        title: 'name',
        owner: null,
        columns: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'goal', label: 'Goal', type: 'longtext' },
          { name: 'starts_on', label: 'Starts', type: 'date', required: true },
          { name: 'ends_on', label: 'Ends', type: 'date', required: true },
          { name: 'capacity', label: 'Capacity (points)', type: 'number', required: true },
          { name: 'planned', label: 'Planned (points)', type: 'number', formula: "sum(work_items.points, status != 'wont_fix')" },
          { name: 'done_points', label: 'Done (points)', type: 'number', formula: "sum(work_items.points, status = 'done')" },
          { name: 'room_left', label: 'Room left (points)', type: 'number', formula: 'capacity - planned' },
          { name: 'progress', label: 'Done (%)', type: 'number', formula: 'round(100 * done_points / planned, 0)' },
          {
            name: 'open_critical',
            label: 'Open critical bugs',
            type: 'number',
            formula: "count(work_items, severity = 'critical' and status != 'done' and status != 'wont_fix')",
          },
          {
            name: 'health',
            label: 'Health',
            type: 'select',
            options: ['on_track', 'at_risk', 'critical_open'],
            formula: "if(open_critical > 0, 'critical_open', if(progress < 50 and days(today(), ends_on) <= 3, 'at_risk', 'on_track'))",
          },
        ],
        rows: SPRINTS.map(([name, starts_on, ends_on, capacity, goal]) => ({ name, starts_on, ends_on, capacity, goal })),
      },
      {
        name: 'components',
        label: 'Components',
        one: 'Component',
        title: 'name',
        owner: null,
        columns: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'lead', label: 'Lead developer', type: 'user', role: 'developer' },
          {
            name: 'open_bugs',
            label: 'Open bugs',
            type: 'number',
            formula: "count(work_items, kind = 'bug' and status != 'done' and status != 'wont_fix')",
          },
          {
            name: 'critical_bugs',
            label: 'Open critical bugs',
            type: 'number',
            formula: "count(work_items, severity = 'critical' and status != 'done' and status != 'wont_fix')",
          },
        ],
        rows: [
          { name: 'Checkout', lead: 1 },
          { name: 'Search', lead: 2 },
          { name: 'Mobile app', lead: 3 },
          { name: 'Admin portal', lead: 1 },
        ],
      },
    ],
    users: [
      { name: 'Usman Ali', role: 'developer' },
      { name: 'Hira Shah', role: 'developer' },
      { name: 'Kamran Javed', role: 'developer' },
      { name: 'Sadia Iqbal', role: 'tester' },
      { name: 'Zara Ahmed', role: 'product_owner' },
    ],
  }),
  backend: () => ({
    status: {
      table: 'work_items',
      column: 'status',
      initial: 'backlog',
      locked: ['done', 'wont_fix'],
      states: [
        { id: 'backlog', label: 'Backlog', tone: 'neutral' },
        { id: 'to_do', label: 'To do', tone: 'info' },
        { id: 'in_progress', label: 'In progress', tone: 'info' },
        { id: 'in_qa', label: 'In QA', tone: 'warning' },
        { id: 'done', label: 'Done', tone: 'success' },
        { id: 'wont_fix', label: 'Won’t fix', tone: 'danger' },
      ],
      transitions: [
        { id: 'plan', label: 'Plan into sprint', from: ['backlog'], to: 'to_do', roles: ['product_owner'], needs: ['sprint', 'points'] },
        { id: 'start', label: 'Start', from: ['to_do'], to: 'in_progress', roles: ['developer'], needs: ['assignee'] },
        { id: 'send_to_qa', label: 'Send to QA', from: ['in_progress'], to: 'in_qa', roles: ['developer'], needs: ['fix_notes'] },
        { id: 'verify', label: 'Mark done', from: ['in_qa'], to: 'done', roles: ['tester'], set: { verified_by: ':me' } },
        { id: 'send_back', label: 'Send back', from: ['in_qa'], to: 'in_progress', roles: ['tester'] },
        {
          id: 'close_wont_fix',
          label: 'Close as won’t fix',
          from: ['backlog'],
          to: 'wont_fix',
          roles: ['product_owner'],
          when: "severity != 'critical'",
          unless: 'A critical bug cannot be closed as won’t fix. Plan it into a sprint instead.',
        },
      ],
    },
    logic: {
      rules: [
        {
          id: 'sprint_capacity',
          table: 'sprints',
          when: 'planned <= capacity',
          message: 'A sprint cannot take more story points than its capacity. Move something out first.',
        },
        { id: 'sprint_dates', table: 'sprints', when: 'ends_on >= starts_on', message: 'A sprint ends on or after the day it starts.' },
        { id: 'capacity_positive', table: 'sprints', when: 'capacity > 0', message: 'A sprint needs a capacity of more than zero points.' },
        {
          id: 'points_range',
          table: 'work_items',
          when: 'points >= 0 and points <= 13',
          message: 'Story points go from 0 to 13. Split anything bigger.',
        },
      ],
    },
    access: [
      ...rules('work_items', { developer: EDIT, tester: EDIT, product_owner: ALL }),
      ...rules('sprints', { developer: LOOK, tester: LOOK, product_owner: ALL }),
      ...rules('components', { developer: LOOK, tester: LOOK, product_owner: ALL }),
    ],
  }),
  views: () => ({
    views: [
      {
        table: 'work_items',
        use: [
          { type: 'board', by: 'status', lane: 'sprint', why: 'A column per stage and a lane per sprint.' },
          { type: 'table', why: 'For sorting and filtering, with the points added up.' },
          { type: 'tree', levels: ['sprint', 'assignee'], why: 'Work nested under each sprint and person.' },
          { type: 'chart', x: 'component', split: 'severity', why: 'Bugs by component and severity.' },
          { type: 'pivot', rows: 'sprint', cols: 'status', measure: 'sum:points', why: 'Story points by sprint and stage.' },
        ],
      },
      {
        table: 'sprints',
        use: [
          { type: 'table', why: 'Capacity, planned, done and room left side by side.' },
          { type: 'timeline', start: 'starts_on', end: 'ends_on', why: 'When each sprint runs.' },
          { type: 'board', by: 'health', why: 'Sprints grouped by health, so a critical bug stands out.' },
        ],
      },
      {
        table: 'components',
        use: [
          { type: 'table', why: 'Each part of the product with its open bugs.' },
          { type: 'cards', why: 'One card per component.' },
        ],
      },
    ],
    dashboard: {
      title: 'Overview',
      date: { table: 'sprints', column: 'starts_on' },
      widgets: [
        { kind: 'kpi', label: 'Open critical bugs', table: 'components', measure: 'sum:critical_bugs' },
        { kind: 'kpi', label: 'Waiting for QA', table: 'work_items', where: { status: 'in_qa' } },
        { kind: 'kpi', label: 'In the backlog', table: 'work_items', where: { status: 'backlog' } },
        { kind: 'kpi', label: 'Points done', table: 'sprints', measure: 'sum:done_points' },
        { kind: 'bar', label: 'Room left by sprint', table: 'sprints', x: 'name', measure: 'sum:room_left' },
        { kind: 'stack', label: 'Points by sprint and stage', table: 'work_items', x: 'sprint', split: 'status', measure: 'sum:points' },
        { kind: 'bar', label: 'Open bugs by component', table: 'components', x: 'name', measure: 'sum:open_bugs' },
        { kind: 'recent', label: 'Latest work items', table: 'work_items' },
      ],
    },
  }),
  ui: () => ({
    theme: { accent: 'royalBlue', nav: 'side', icon: 'bug', density: 'comfortable' },
    screens: [
      { name: 'Overview', type: 'dashboard', table: 'work_items', roles: ['developer', 'tester', 'product_owner'], icon: 'pie' },
      {
        name: 'Sprint board',
        type: 'board',
        table: 'work_items',
        roles: ['developer', 'tester', 'product_owner'],
        group: 'status',
        label: 'title',
        columns: ['sprint', 'assignee', 'points', 'urgency'],
        icon: 'board',
      },
      { name: 'Report a bug', type: 'form', table: 'work_items', roles: ['tester', 'product_owner'], icon: 'bug' },
      {
        name: 'Backlog',
        type: 'table',
        table: 'work_items',
        roles: ['product_owner', 'developer', 'tester'],
        columns: ['title', 'kind', 'severity', 'points', 'component', 'urgency', 'status'],
        icon: 'list',
      },
      {
        name: 'Sprints',
        type: 'table',
        table: 'sprints',
        roles: ['product_owner', 'developer', 'tester'],
        columns: ['name', 'capacity', 'planned', 'done_points', 'room_left', 'open_critical', 'health'],
        icon: 'timeline',
      },
      {
        name: 'Components',
        type: 'table',
        table: 'components',
        roles: ['product_owner', 'developer', 'tester'],
        columns: ['name', 'lead', 'open_bugs', 'critical_bugs'],
        icon: 'puzzle',
      },
    ],
    tour: [
      {
        role: 'product_owner',
        do: 'create',
        table: 'work_items',
        values: {
          title: 'Coupon code accepted twice',
          kind: 'bug',
          severity: 'high',
          points: 2,
          component: 1,
          sprint: 2,
          assignee: 'Usman Ali',
        },
        say: 'Zara, the product owner, adds a bug a tester found to Sprint 14 and gives it to Usman. It is marked "Next up".',
      },
      {
        role: 'product_owner',
        do: 'transition',
        table: 'work_items',
        transition: 'plan',
        say: 'It has a sprint and story points, and the sprint has room, so she plans it in.',
      },
      { role: 'developer', user: 'usman', do: 'transition', table: 'work_items', transition: 'start', say: 'Usman starts on it.' },
      {
        role: 'developer',
        user: 'usman',
        do: 'denied',
        table: 'work_items',
        action: 'send_to_qa',
        say: 'He cannot send it to QA until he writes what he changed, so the tester knows what to check.',
      },
      {
        role: 'developer',
        do: 'denied',
        table: 'work_items',
        action: 'verify',
        say: 'Nor can a developer mark work done. Only a tester may.',
      },
      {
        role: 'tester',
        do: 'create',
        table: 'work_items',
        values: { title: 'Orders of other customers visible', kind: 'bug', severity: 'critical', points: 3, component: 4 },
        say: 'Sadia, a tester, reports a critical bug. It goes to the top as "Fix now".',
      },
      {
        role: 'product_owner',
        do: 'denied',
        table: 'work_items',
        action: 'close_wont_fix',
        say: 'Zara tries to close it as won\u2019t fix. A critical bug cannot be dropped.',
      },
      { role: 'product_owner', do: 'open', screen: 'Sprints', say: 'The sprints show their room left and open critical bugs.' },
    ],
  }),
  tester: () => ({
    cases: [
      {
        name: 'A sprint cannot go over its capacity',
        why: 'A sprint cannot take more story points than its capacity.',
        steps: [
          {
            role: 'tester',
            do: 'invalid',
            table: 'work_items',
            values: { title: 'Rewrite the whole checkout', kind: 'story', points: 13, sprint: 2, component: 1 },
          },
        ],
      },
      {
        name: 'Story points stop at 13',
        why: 'Story points go from 0 to 13. Anything bigger is split first.',
        steps: [{ role: 'tester', do: 'invalid', table: 'work_items', values: { title: 'Huge story', kind: 'story', points: 20 } }],
      },
      {
        name: 'A critical bug cannot be closed as won’t fix',
        why: 'A critical bug cannot be closed as won’t fix.',
        steps: [
          {
            role: 'tester',
            do: 'create',
            table: 'work_items',
            values: { title: 'Data lost on sign out', kind: 'bug', severity: 'critical', points: 3, component: 4 },
          },
          { role: 'product_owner', do: 'denied', table: 'work_items', action: 'close_wont_fix' },
        ],
      },
      {
        name: 'Work goes to QA only with a note of what was changed',
        why: 'A developer sends work to QA only after writing what was changed.',
        steps: [
          {
            role: 'product_owner',
            do: 'create',
            table: 'work_items',
            values: { title: 'Show delivery time', kind: 'story', points: 1, sprint: 3, assignee: 'Hira Shah' },
          },
          { role: 'product_owner', do: 'transition', table: 'work_items', transition: 'plan' },
          { role: 'developer', user: 'hira', do: 'transition', table: 'work_items', transition: 'start' },
          { role: 'developer', user: 'hira', do: 'denied', table: 'work_items', action: 'send_to_qa' },
        ],
      },
    ],
  }),
};

/* ---------- timesheets and client billing ---------- */

// [note, project, person, day, hours, billable, invoice, stage]
type Entry = [string, number, number, number, number, boolean, number | null, string];
const ENTRIES: Entry[] = [
  ['Sign-up and sign-in screens', 1, 1, -40, 8, true, 1, 'invoiced'],
  ['Points balance service', 1, 2, -39, 7, true, 1, 'invoiced'],
  ['Points balance service, tests', 1, 2, -38, 6, true, 1, 'invoiced'],
  ['Sprint planning with the client', 1, 1, -36, 2, false, null, 'approved'],
  ['Calendar of free rooms', 2, 2, -28, 8, true, 2, 'invoiced'],
  ['Payment page', 2, 1, -26, 8, true, 2, 'invoiced'],
  ['Payment page, refunds', 2, 1, -25, 5, true, 2, 'invoiced'],
  ['Monthly security updates', 3, 2, -15, 3, true, null, 'approved'],
  ['Rewards screen', 1, 3, -12, 8, true, 3, 'invoiced'],
  ['Rewards screen, animations', 1, 3, -11, 6, true, 3, 'approved'],
  ['Room photo upload', 2, 3, -5, 6, true, null, 'approved'],
  ['Password reset fault', 3, 1, -4, 2, true, null, 'submitted'],
  ['Notices for new rewards', 1, 1, -3, 7.5, true, null, 'submitted'],
  ['Crash on older phones', 1, 2, -2, 4, true, null, 'submitted'],
  ['Booking emails', 2, 3, -1, 11, true, null, 'rejected'],
];

REC.billing = {
  ...CARDS.billing,
  usage: {
    research: [1340, 730, 6500],
    database: [3010, 3460, 16100],
    backend: [3650, 1210, 9100],
    views: [2870, 1390, 9100],
    ui: [4310, 1550, 10700],
  },
  say: {
    research: [
      'Reading the request. People log hours on client projects, the lead approves them, and finance bills the approved hours.',
      'Three kinds of people. The app prices each entry at the project rate, totals invoices and works out what each client owes.',
    ],
    database: [
      'Creating the lists. An entry is priced from its hours and the project rate; an invoice totals its hours and subtracts its payments.',
    ],
    backend: [
      'Writing the rules: at most 12 hours in one entry and none for a day still to come, only approved hours go on an invoice, and payments never add up to more than it.',
    ],
    views: [
      'Entries have a person, a project, a day and an amount, so a timesheet pivot, a calendar and charts by client fit.',
      'The dashboard shows hours waiting for approval, approved hours not yet billed and what clients still owe.',
    ],
    ui: [
      'Laying out the pages: log time, my timesheet, approvals for the lead, invoices and payments for finance, and clients. Teal, side navigation.',
    ],
  },
  research: () => ({
    name: 'Timesheets and Billing',
    summary: 'Log hours on client projects, approve them, price them at each project rate, and invoice clients until nothing is owed.',
    reflect:
      'An app for billing clients by the hour: who worked on what, whether it was approved, what it is worth, what was invoiced and what is still owed.',
    planned: true,
    settings: ['clients'],
    roles: [
      { id: 'developer', name: 'Developer', can: 'Logs their own hours on client projects' },
      { id: 'project_lead', name: 'Project lead', can: 'Approves or rejects hours and watches each project budget' },
      { id: 'finance', name: 'Finance', can: 'Raises invoices from approved hours and records payments' },
    ],
    entities: [
      { name: 'time_entries', what: 'Hours someone worked on a project on a day, priced at the project rate' },
      { name: 'projects', what: 'Work for a client with an hourly rate and a budget, and what is used of it' },
      { name: 'invoices', what: 'A bill to a client, totalled from its hours, with what is paid and still owed' },
      { name: 'payments', what: 'Money a client paid towards an invoice' },
      { name: 'clients', what: 'Who the company works for, with what they were billed and still owe' },
    ],
    process: {
      entity: 'time_entries',
      states: ['submitted', 'approved', 'invoiced', 'rejected'],
      note: 'A developer logs hours. The project lead approves or rejects them. Finance puts approved, billable hours on an invoice.',
    },
    stories: [
      { role: 'developer', want: 'log my hours in a few seconds', so: 'my week is recorded without a spreadsheet' },
      { role: 'project_lead', want: 'approve the hours on my projects and see the budget used', so: 'clients pay only for real work' },
      { role: 'finance', want: 'invoice approved hours at the right rate', so: 'nothing is billed twice or forgotten' },
      { role: 'finance', want: 'record part payments and see what is still owed', so: 'I know whom to chase' },
    ],
    rules: [
      'One entry is more than zero and at most 12 hours, and never for a day that has not come yet.',
      'Only a project lead approves hours. Developers see only their own.',
      'Only approved hours go on an invoice, and only on an invoice for the same client.',
      'Hours that are not billable are never invoiced. Invoiced hours can no longer be changed.',
      'Payments cannot add up to more than the invoice.',
    ],
    ...noQuestion,
    notInThisVersion: [{ ask: 'Sending the invoice to the client by email', instead: 'Finance downloads the invoice list and sends it' }],
  }),
  database: () => ({
    tables: [
      {
        name: 'time_entries',
        label: 'Time entries',
        one: 'Time entry',
        title: 'note',
        owner: 'person',
        columns: [
          { name: 'note', label: 'What you worked on', type: 'text', required: true },
          { name: 'project', label: 'Project', type: 'ref', ref: 'projects', required: true },
          { name: 'person', label: 'Person', type: 'user', role: 'developer' },
          { name: 'worked_on', label: 'Day', type: 'date', required: true },
          { name: 'hours', label: 'Hours', type: 'number', required: true },
          { name: 'billable', label: 'Billable', type: 'bool' },
          { name: 'amount', label: 'Amount', type: 'money', formula: 'if(billable, hours * project.hourly_rate, 0)' },
          { name: 'invoice', label: 'Invoice', type: 'ref', ref: 'invoices' },
          { name: 'approved_by', label: 'Approved by', type: 'user' },
          { name: 'status', label: 'Stage', type: 'select', required: true, options: ['submitted', 'approved', 'invoiced', 'rejected'] },
        ],
        rows: ENTRIES.map(([note, project, person, worked_on, hours, billable, invoice, status]) => ({
          note,
          project,
          person,
          worked_on,
          hours,
          billable,
          invoice,
          status,
          approved_by: status === 'approved' || status === 'invoiced' ? 4 : null,
        })),
      },
      {
        name: 'projects',
        label: 'Projects',
        one: 'Project',
        title: 'name',
        owner: null,
        columns: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'client', label: 'Client', type: 'ref', ref: 'clients', required: true },
          { name: 'lead', label: 'Project lead', type: 'user', role: 'project_lead' },
          { name: 'hourly_rate', label: 'Hourly rate', type: 'money', required: true },
          { name: 'budget', label: 'Budget', type: 'money' },
          {
            name: 'approved_hours',
            label: 'Approved hours',
            type: 'number',
            formula: "sum(time_entries.hours, status = 'approved' or status = 'invoiced')",
          },
          {
            name: 'used',
            label: 'Budget used',
            type: 'money',
            formula: "sum(time_entries.amount, status = 'approved' or status = 'invoiced')",
          },
          { name: 'not_billed', label: 'Approved, not billed', type: 'money', formula: "sum(time_entries.amount, status = 'approved')" },
          { name: 'budget_left', label: 'Budget left', type: 'money', formula: 'budget - used' },
          {
            name: 'budget_state',
            label: 'Budget',
            type: 'select',
            options: ['on_track', 'nearly_used', 'over_budget'],
            formula: "if(budget_left < 0, 'over_budget', if(used >= budget * 0.8, 'nearly_used', 'on_track'))",
          },
        ],
        rows: [
          { name: 'Loyalty app', client: 1, lead: 4, hourly_rate: 45, budget: 18000 },
          { name: 'Booking site', client: 2, lead: 4, hourly_rate: 40, budget: 1300 },
          { name: 'Support retainer', client: 3, lead: 4, hourly_rate: 35, budget: 4000 },
        ],
      },
      {
        name: 'invoices',
        label: 'Invoices',
        one: 'Invoice',
        title: 'number',
        owner: null,
        columns: [
          { name: 'number', label: 'Invoice number', type: 'text', required: true },
          { name: 'client', label: 'Client', type: 'ref', ref: 'clients', required: true },
          { name: 'issued_on', label: 'Issued', type: 'date' },
          { name: 'due_on', label: 'Due', type: 'date' },
          { name: 'hours', label: 'Hours', type: 'number', formula: 'sum(time_entries.hours)' },
          { name: 'total', label: 'Total', type: 'money', formula: 'sum(time_entries.amount)' },
          { name: 'paid', label: 'Paid', type: 'money', formula: 'sum(payments.amount)' },
          { name: 'balance', label: 'Still owed', type: 'money', formula: 'total - paid' },
          {
            name: 'state',
            label: 'Payment',
            type: 'select',
            options: ['empty', 'open', 'part_paid', 'overdue', 'paid'],
            formula:
              "if(total = 0, 'empty', if(balance <= 0, 'paid', if(days(due_on, today()) > 0, 'overdue', if(paid > 0, 'part_paid', 'open'))))",
          },
        ],
        rows: [
          { number: 'INV-1041', client: 1, issued_on: -35, due_on: -5 },
          { number: 'INV-1042', client: 2, issued_on: -20, due_on: -6 },
          { number: 'INV-1043', client: 1, issued_on: -2, due_on: 28 },
        ],
      },
      {
        name: 'payments',
        label: 'Payments',
        one: 'Payment',
        title: 'reference',
        owner: null,
        columns: [
          { name: 'reference', label: 'Reference', type: 'text', required: true },
          { name: 'invoice', label: 'Invoice', type: 'ref', ref: 'invoices', required: true },
          { name: 'received_on', label: 'Received', type: 'date', required: true },
          { name: 'amount', label: 'Amount', type: 'money', required: true },
        ],
        rows: [
          { reference: 'Bank transfer 40211', invoice: 1, received_on: -10, amount: 945 },
          { reference: 'Bank transfer 40377', invoice: 2, received_on: -3, amount: 500 },
        ],
      },
      {
        name: 'clients',
        label: 'Clients',
        one: 'Client',
        title: 'name',
        owner: null,
        columns: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'contact', label: 'Contact', type: 'text' },
          { name: 'email', label: 'Email', type: 'text' },
          { name: 'payment_days', label: 'Pays within (days)', type: 'number' },
          { name: 'billed', label: 'Billed', type: 'money', formula: 'sum(invoices.total)' },
          { name: 'owed', label: 'Still owed', type: 'money', formula: 'sum(invoices.balance)' },
        ],
        rows: [
          { name: 'Fourth Coffee', contact: 'Rehan Aslam', email: 'accounts@fourthcoffee.example', payment_days: 30 },
          { name: 'Alpine Ski House', contact: 'Mariam Butt', email: 'finance@alpineski.example', payment_days: 14 },
          { name: 'Litware', contact: 'Junaid Haider', email: 'ap@litware.example', payment_days: 30 },
        ],
      },
    ],
    users: [
      { name: 'Ahmed Raza', role: 'developer' },
      { name: 'Maryam Iqbal', role: 'developer' },
      { name: 'Danish Khan', role: 'developer' },
      { name: 'Sobia Nawaz', role: 'project_lead' },
      { name: 'Faisal Sheikh', role: 'finance' },
    ],
  }),
  backend: () => ({
    status: {
      table: 'time_entries',
      column: 'status',
      initial: 'submitted',
      locked: ['invoiced'],
      states: [
        { id: 'submitted', label: 'Submitted', tone: 'info' },
        { id: 'approved', label: 'Approved', tone: 'success' },
        { id: 'invoiced', label: 'Invoiced', tone: 'success' },
        { id: 'rejected', label: 'Rejected', tone: 'danger' },
      ],
      transitions: [
        { id: 'approve', label: 'Approve', from: ['submitted'], to: 'approved', roles: ['project_lead'], set: { approved_by: ':me' } },
        { id: 'reject', label: 'Reject', from: ['submitted'], to: 'rejected', roles: ['project_lead'] },
        { id: 'resubmit', label: 'Submit again', from: ['rejected'], to: 'submitted', roles: ['developer'] },
        {
          id: 'mark_invoiced',
          label: 'Mark invoiced',
          from: ['approved'],
          to: 'invoiced',
          roles: ['finance'],
          needs: ['invoice'],
          when: 'billable = true',
          unless: 'Hours that are not billable are never invoiced.',
        },
      ],
    },
    logic: {
      rules: [
        {
          id: 'entry_hours',
          table: 'time_entries',
          when: 'hours > 0 and hours <= 12',
          message: 'One time entry is more than zero and at most 12 hours.',
        },
        {
          id: 'not_ahead',
          table: 'time_entries',
          when: 'days(worked_on, today()) >= 0',
          message: 'Time cannot be logged for a day that has not come yet.',
        },
        {
          id: 'approved_only',
          table: 'time_entries',
          when: "not filled(invoice) or status = 'approved' or status = 'invoiced'",
          message: 'Only approved hours can go on an invoice.',
        },
        {
          id: 'same_client',
          table: 'time_entries',
          when: 'not filled(invoice) or invoice.client = project.client',
          message: 'An invoice only takes hours from its own client’s projects.',
        },
        { id: 'not_overpaid', table: 'invoices', when: 'balance >= 0', message: 'Payments cannot add up to more than the invoice.' },
        { id: 'payment_positive', table: 'payments', when: 'amount > 0', message: 'A payment must be more than zero.' },
        { id: 'rate_positive', table: 'projects', when: 'hourly_rate > 0', message: 'A project needs an hourly rate above zero.' },
      ],
    },
    access: [
      ...rules('time_entries', { developer: MINE, project_lead: EDIT, finance: { ...LOOK, update: 'all' } }),
      ...rules('projects', { developer: LOOK, project_lead: EDIT, finance: LOOK }),
      ...rules('invoices', { developer: NONE, project_lead: LOOK, finance: ALL }),
      ...rules('payments', { developer: NONE, project_lead: LOOK, finance: ALL }),
      ...rules('clients', { developer: LOOK, project_lead: LOOK, finance: ALL }),
    ],
  }),
  views: () => ({
    views: [
      {
        table: 'time_entries',
        use: [
          { type: 'table', why: 'Every entry with its amount, the hours added up.' },
          { type: 'board', by: 'status', why: 'A column per stage, so the lead sees what waits.' },
          { type: 'calendar', date: 'worked_on', why: 'Who worked on what, by day.' },
          { type: 'pivot', rows: 'person', cols: 'project', measure: 'sum:hours', why: 'A timesheet: people against projects.' },
          { type: 'chart', x: 'project', split: 'status', measure: 'sum:amount', why: 'What each project is worth, by stage.' },
        ],
      },
      {
        table: 'projects',
        use: [
          { type: 'table', why: 'Rate, budget, used and left side by side.' },
          { type: 'board', by: 'budget_state', why: 'Projects grouped by how their budget is doing.' },
        ],
      },
      {
        table: 'invoices',
        use: [
          { type: 'table', why: 'Each invoice with its total, what is paid and what is owed.' },
          { type: 'board', by: 'state', why: 'Open, part paid, overdue and paid in columns.' },
          { type: 'calendar', date: 'due_on', why: 'When each invoice is due.' },
        ],
      },
      {
        table: 'payments',
        use: [
          { type: 'table', why: 'Every payment, added up.' },
          { type: 'calendar', date: 'received_on', why: 'When each payment came in.' },
        ],
      },
      {
        table: 'clients',
        use: [
          { type: 'table', why: 'Each client with what they were billed and still owe.' },
          { type: 'cards', why: 'One card per client.' },
        ],
      },
    ],
    dashboard: {
      title: 'Overview',
      date: { table: 'time_entries', column: 'worked_on' },
      widgets: [
        { kind: 'kpi', label: 'Entries waiting for approval', table: 'time_entries', where: { status: 'submitted' } },
        { kind: 'kpi', label: 'Approved, not billed', table: 'projects', measure: 'sum:not_billed' },
        { kind: 'kpi', label: 'Billed', table: 'invoices', measure: 'sum:total' },
        { kind: 'kpi', label: 'Still owed', table: 'invoices', measure: 'sum:balance' },
        { kind: 'bar', label: 'Still owed by client', table: 'clients', x: 'name', measure: 'sum:owed' },
        { kind: 'stack', label: 'Hours by person and project', table: 'time_entries', x: 'person', split: 'project', measure: 'sum:hours' },
        { kind: 'line', label: 'Hours logged each week', table: 'time_entries', x: 'worked_on', bucket: 'week', measure: 'sum:hours' },
        { kind: 'recent', label: 'Latest entries', table: 'time_entries' },
      ],
    },
  }),
  ui: () => ({
    theme: { accent: 'teal', nav: 'side', icon: 'clock', density: 'comfortable' },
    screens: [
      { name: 'Overview', type: 'dashboard', table: 'time_entries', roles: ['developer', 'project_lead', 'finance'], icon: 'pie' },
      { name: 'Log time', type: 'form', table: 'time_entries', roles: ['developer'], icon: 'clock' },
      {
        name: 'My timesheet',
        type: 'table',
        table: 'time_entries',
        roles: ['developer'],
        columns: ['note', 'project', 'worked_on', 'hours', 'billable', 'status'],
        icon: 'list',
      },
      {
        name: 'Approvals',
        type: 'board',
        table: 'time_entries',
        roles: ['project_lead', 'finance'],
        group: 'status',
        label: 'note',
        columns: ['person', 'project', 'hours', 'amount'],
        icon: 'board',
      },
      {
        name: 'Projects',
        type: 'table',
        table: 'projects',
        roles: ['project_lead', 'finance', 'developer'],
        columns: ['name', 'client', 'hourly_rate', 'budget', 'used', 'not_billed', 'budget_state'],
        icon: 'briefcase',
      },
      {
        name: 'Invoices',
        type: 'table',
        table: 'invoices',
        roles: ['finance', 'project_lead'],
        columns: ['number', 'client', 'due_on', 'total', 'paid', 'balance', 'state'],
        icon: 'receipt',
      },
      {
        name: 'Payments',
        type: 'table',
        table: 'payments',
        roles: ['finance'],
        columns: ['reference', 'invoice', 'received_on', 'amount'],
        icon: 'payment',
      },
      {
        name: 'Clients',
        type: 'table',
        table: 'clients',
        roles: ['finance', 'project_lead'],
        columns: ['name', 'contact', 'payment_days', 'billed', 'owed'],
        icon: 'building',
      },
    ],
    tour: [
      {
        role: 'developer',
        user: 'ahmed',
        do: 'create',
        table: 'time_entries',
        values: { note: 'Offline mode for the loyalty card', project: 1, worked_on: 0, hours: 6, billable: true },
        say: 'Ahmed logs six hours on the loyalty app. At 45 an hour, the app prices them at 270.',
      },
      {
        role: 'developer',
        user: 'ahmed',
        do: 'denied',
        table: 'time_entries',
        action: 'approve',
        say: 'He cannot approve his own hours.',
      },
      {
        role: 'project_lead',
        do: 'transition',
        table: 'time_entries',
        transition: 'approve',
        say: 'Sobia, the project lead, approves them. They now count against the project budget.',
      },
      {
        role: 'developer',
        do: 'denied',
        table: 'invoices',
        action: 'list',
        say: 'Developers do not see invoices or what clients pay.',
      },
      {
        role: 'finance',
        do: 'open',
        screen: 'Invoices',
        say: 'Faisal in finance sees each invoice totalled from its hours, with what is paid and still owed.',
      },
      {
        role: 'finance',
        do: 'create',
        table: 'payments',
        values: { reference: 'Bank transfer 40512', invoice: 3, received_on: 0, amount: 300 },
        say: 'Fourth Coffee pays 300 towards INV-1043. The app shows the 330 still owed.',
      },
      { role: 'finance', do: 'open', screen: 'Clients', say: 'He sees what each client was billed and still owes.' },
    ],
  }),
  tester: () => ({
    cases: [
      {
        name: 'One entry is at most 12 hours',
        why: 'One entry is more than zero and at most 12 hours, and never for a day that has not come yet.',
        steps: [
          {
            role: 'developer',
            do: 'invalid',
            table: 'time_entries',
            values: { note: 'A very long day', project: 1, worked_on: 0, hours: 14, billable: true },
          },
        ],
      },
      {
        name: 'Time cannot be logged ahead',
        why: 'One entry is more than zero and at most 12 hours, and never for a day that has not come yet.',
        steps: [
          {
            role: 'developer',
            do: 'invalid',
            table: 'time_entries',
            values: { note: 'Next week, in advance', project: 1, worked_on: 5, hours: 4, billable: true },
          },
        ],
      },
      {
        name: 'Hours not yet approved cannot go on an invoice',
        why: 'Only approved hours go on an invoice, and only on an invoice for the same client.',
        steps: [
          {
            role: 'project_lead',
            do: 'invalid',
            table: 'time_entries',
            values: { note: 'Straight onto the bill', project: 1, worked_on: 0, hours: 2, billable: true, invoice: 3 },
          },
        ],
      },
      {
        name: 'Payments cannot add up to more than the invoice',
        why: 'Payments cannot add up to more than the invoice.',
        steps: [
          { role: 'finance', do: 'create', table: 'invoices', values: { number: 'INV-2001', client: 3, issued_on: 0, due_on: 30 } },
          { role: 'finance', do: 'invalid', table: 'payments', values: { reference: 'Too much', received_on: 0, amount: 100 } },
        ],
      },
      {
        name: 'Developers cannot see invoices',
        why: 'Only a project lead approves hours. Developers see only their own.',
        steps: [{ role: 'developer', do: 'denied', table: 'invoices', action: 'list' }],
      },
    ],
  }),
};

/* ---------- client onboarding ---------- */

// [client, project, delivery lead, client contact, contract value, deposit received, kickoff, go-live, scope, stage]
type Onboard = [string, string, number | null, number | null, number, number, number | null, number, string | null, string];
const ONBOARDINGS: Onboard[] = [
  ['Fourth Coffee', 'Loyalty app', 2, 4, 42000, 12600, -50, -5, 'iPhone and Android apps for points and rewards.', 'live'],
  ['Alpine Ski House', 'Booking site', 3, 5, 24000, 7200, -18, 20, 'Room booking, payments and booking emails.', 'scope_signed'],
  ['Coho Winery', 'Online shop', 2, 6, 30000, 0, -4, 40, null, 'setup'],
  ['Litware', 'Support retainer', 3, null, 8000, 0, 6, 30, null, 'kickoff'],
  ['Woodgrove Bank', 'Branch finder', null, null, 15000, 0, null, 60, null, 'handed_over'],
];
// [step, onboarding, area, who does it, required, due, done]
const STEPS: [string, number, string, string, boolean, number, boolean][] = [
  ['Signed contract filed', 1, 'contract', 'our_team', true, -58, true],
  ['Store accounts shared with us', 1, 'access', 'client', true, -45, true],
  ['Test and live servers ready', 1, 'environments', 'our_team', true, -40, true],
  ['Weekly call booked', 1, 'team', 'our_team', false, -48, true],
  ['Signed contract filed', 2, 'contract', 'our_team', true, -24, true],
  ['Payment provider account', 2, 'access', 'client', true, -10, true],
  ['Test server ready', 2, 'environments', 'our_team', true, -8, true],
  ['Room photos and prices', 2, 'client', 'client', true, 5, false],
  ['Brand guide sent', 2, 'client', 'client', false, 2, false],
  ['Signed contract filed', 3, 'contract', 'our_team', true, -10, true],
  ['Shop platform access', 3, 'access', 'client', true, 3, false],
  ['Product list and photos', 3, 'client', 'client', true, 10, false],
  ['Test server ready', 3, 'environments', 'our_team', true, 7, false],
];
// [person, role, onboarding, starts, hours a week]
const TEAM: [string, string, number, number, number][] = [
  ['Ahmed Raza', 'developer', 1, -50, 32],
  ['Maryam Iqbal', 'developer', 1, -50, 24],
  ['Sadia Iqbal', 'tester', 1, -30, 16],
  ['Danish Khan', 'developer', 2, -15, 32],
  ['Hira Shah', 'designer', 2, -15, 12],
  ['Usman Ali', 'developer', 3, -2, 24],
  ['Mahnoor Khalid', 'designer', 3, -2, 16],
];

REC.onboarding = {
  ...CARDS.onboarding,
  usage: {
    research: [1290, 700, 6250],
    database: [2920, 3220, 15200],
    backend: [3590, 1150, 8800],
    views: [2790, 1310, 8750],
    ui: [4240, 1510, 10450],
  },
  say: {
    research: [
      'Reading the request. Each new client gets a checklist and a team, and moves from handover to live.',
      'Three kinds of people, one of them the client. The app counts the open required steps and works out the deposit due.',
    ],
    database: [
      'Creating the lists. An onboarding counts its steps done and still required, its team and weekly hours, and the deposit due.',
    ],
    backend: [
      'Writing the rules: setup starts only with a checklist and a team, the client signs off the scope, and go-live waits for every required step and the deposit.',
    ],
    views: [
      'Onboardings have a stage, a lead and a go-live date, so a board, a timeline and a calendar fit. Steps nest under their client.',
      'The dashboard shows who is waiting on what and how many required steps are still open.',
    ],
    ui: [
      'Laying out the pages: the onboarding board, the checklist, teams, and a page for the client to sign off. Purple, side navigation.',
    ],
  },
  research: () => ({
    name: 'Client Onboarding',
    summary: 'Take each new client from signed deal to live: a checklist, a team, the client’s sign-off and the deposit.',
    reflect:
      'An app to onboard new clients: who hands over the deal, what has to be ready, who is on the team, and when the client can go live.',
    planned: true,
    settings: [],
    roles: [
      { id: 'account_manager', name: 'Account manager', can: 'Hands over signed deals and records the deposit' },
      { id: 'delivery_lead', name: 'Delivery lead', can: 'Runs the kickoff, the checklist and the team, and takes the client live' },
      { id: 'client', name: 'Client contact', can: 'Sees their own onboarding and signs off the scope' },
    ],
    entities: [
      { name: 'onboardings', what: 'One new client from signed deal to live, with its open steps, team and deposit worked out' },
      { name: 'checklist_items', what: 'A step that must be done before go-live, by our team or the client' },
      { name: 'team_members', what: 'Who works on the client and for how many hours a week' },
    ],
    process: {
      entity: 'onboardings',
      states: ['handed_over', 'kickoff', 'setup', 'scope_signed', 'live', 'on_hold'],
      note: 'Sales hands over the deal. The delivery lead books the kickoff and runs setup. The client signs off the scope, and the lead takes it live.',
    },
    stories: [
      { role: 'account_manager', want: 'hand over a signed deal with its value', so: 'delivery starts without a meeting' },
      { role: 'delivery_lead', want: 'see every step still open before go-live', so: 'nothing is forgotten on launch day' },
      { role: 'client', want: 'see my own onboarding and sign off the scope', so: 'we agree on what is built' },
      { role: 'delivery_lead', want: 'see each team and its weekly hours', so: 'I know who is busy' },
    ],
    rules: [
      'Setup starts only once there is a checklist and at least one team member.',
      'Only the client signs off the scope, and only once it is written.',
      'A client goes live only when every required step is done and 30% of the contract value has been received.',
      'A live client can no longer be changed, and its checklist is closed.',
      'A team member works more than zero and at most 40 hours a week on one client.',
      'Clients see only their own onboarding.',
    ],
    ...noQuestion,
    notInThisVersion: [
      { ask: 'An email to the client when a step is due', instead: 'The client sees their steps and dates when they sign in' },
    ],
  }),
  database: () => ({
    tables: [
      {
        name: 'onboardings',
        label: 'Onboardings',
        one: 'Onboarding',
        title: 'client_name',
        owner: 'client_contact',
        columns: [
          { name: 'client_name', label: 'Client', type: 'text', required: true },
          { name: 'project', label: 'Project', type: 'text' },
          { name: 'delivery_lead', label: 'Delivery lead', type: 'user', role: 'delivery_lead' },
          { name: 'client_contact', label: 'Client contact', type: 'user', role: 'client' },
          { name: 'contract_value', label: 'Contract value', type: 'money', required: true },
          { name: 'deposit_due', label: 'Deposit due', type: 'money', formula: 'round(contract_value * 0.3, 0)' },
          { name: 'deposit_received', label: 'Deposit received', type: 'money' },
          { name: 'kickoff_on', label: 'Kickoff', type: 'date' },
          { name: 'go_live_on', label: 'Go-live', type: 'date' },
          { name: 'scope', label: 'Agreed scope', type: 'longtext' },
          { name: 'steps', label: 'Steps', type: 'number', formula: 'count(checklist_items)' },
          {
            name: 'required_open',
            label: 'Required steps open',
            type: 'number',
            formula: 'count(checklist_items, required = true and done != true)',
          },
          { name: 'team_size', label: 'Team', type: 'number', formula: 'count(team_members)' },
          {
            name: 'status',
            label: 'Stage',
            type: 'select',
            required: true,
            options: ['handed_over', 'kickoff', 'setup', 'scope_signed', 'live', 'on_hold'],
          },
        ],
        rows: ONBOARDINGS.map(
          ([
            client_name,
            project,
            delivery_lead,
            client_contact,
            contract_value,
            deposit_received,
            kickoff_on,
            go_live_on,
            scope,
            status,
          ]) => ({
            client_name,
            project,
            delivery_lead,
            client_contact,
            contract_value,
            deposit_received,
            kickoff_on,
            go_live_on,
            scope,
            status,
          }),
        ),
      },
      {
        name: 'checklist_items',
        label: 'Checklist',
        one: 'Checklist step',
        title: 'step',
        owner: null,
        columns: [
          { name: 'step', label: 'Step', type: 'text', required: true },
          { name: 'onboarding', label: 'Client', type: 'ref', ref: 'onboardings', required: true },
          { name: 'area', label: 'Area', type: 'select', options: ['contract', 'access', 'environments', 'team', 'client'] },
          { name: 'side', label: 'Who does it', type: 'select', options: ['our_team', 'client'] },
          { name: 'required', label: 'Required for go-live', type: 'bool' },
          { name: 'due_on', label: 'Due', type: 'date' },
          { name: 'done', label: 'Done', type: 'bool' },
        ],
        rows: STEPS.map(([step, onboarding, area, side, required, due_on, done]) => ({
          step,
          onboarding,
          area,
          side,
          required,
          due_on,
          done,
        })),
      },
      {
        name: 'team_members',
        label: 'Team',
        one: 'Team member',
        title: 'person',
        owner: null,
        columns: [
          { name: 'person', label: 'Person', type: 'text', required: true },
          { name: 'role_on_team', label: 'Role', type: 'select', options: ['developer', 'designer', 'tester', 'analyst'] },
          { name: 'onboarding', label: 'Client', type: 'ref', ref: 'onboardings', required: true },
          { name: 'starts_on', label: 'Starts', type: 'date' },
          { name: 'hours_per_week', label: 'Hours a week', type: 'number', required: true },
        ],
        rows: TEAM.map(([person, role_on_team, onboarding, starts_on, hours_per_week]) => ({
          person,
          role_on_team,
          onboarding,
          starts_on,
          hours_per_week,
        })),
      },
    ],
    users: [
      { name: 'Nida Farooq', role: 'account_manager' },
      { name: 'Imran Qadir', role: 'delivery_lead' },
      { name: 'Sana Mir', role: 'delivery_lead' },
      { name: 'Rehan Aslam', role: 'client' },
      { name: 'Mariam Butt', role: 'client' },
      { name: 'Omer Siddiqui', role: 'client' },
    ],
  }),
  backend: () => ({
    status: {
      table: 'onboardings',
      column: 'status',
      initial: 'handed_over',
      locked: ['live'],
      states: [
        { id: 'handed_over', label: 'Handed over', tone: 'neutral' },
        { id: 'kickoff', label: 'Kickoff', tone: 'info' },
        { id: 'setup', label: 'Setup', tone: 'info' },
        { id: 'scope_signed', label: 'Scope signed', tone: 'warning' },
        { id: 'live', label: 'Live', tone: 'success' },
        { id: 'on_hold', label: 'On hold', tone: 'danger' },
      ],
      transitions: [
        {
          id: 'book_kickoff',
          label: 'Book kickoff',
          from: ['handed_over'],
          to: 'kickoff',
          roles: ['delivery_lead'],
          needs: ['delivery_lead', 'kickoff_on'],
        },
        {
          id: 'start_setup',
          label: 'Start setup',
          from: ['kickoff'],
          to: 'setup',
          roles: ['delivery_lead'],
          when: 'steps > 0 and team_size > 0',
          unless: 'Add the checklist and at least one team member first.',
        },
        {
          id: 'sign_off_scope',
          label: 'Sign off the scope',
          from: ['setup'],
          to: 'scope_signed',
          roles: ['client'],
          needs: ['scope'],
        },
        {
          id: 'go_live',
          label: 'Go live',
          from: ['scope_signed'],
          to: 'live',
          roles: ['delivery_lead'],
          when: 'required_open = 0 and deposit_received >= deposit_due',
          unless: 'Finish every required checklist step and receive the deposit first.',
        },
        {
          id: 'pause',
          label: 'Put on hold',
          from: ['kickoff', 'setup', 'scope_signed'],
          to: 'on_hold',
          roles: ['delivery_lead', 'account_manager'],
        },
        { id: 'resume', label: 'Resume', from: ['on_hold'], to: 'setup', roles: ['delivery_lead'] },
      ],
    },
    logic: {
      rules: [
        {
          id: 'checklist_closed',
          table: 'checklist_items',
          when: "onboarding.status != 'live'",
          message: 'This client is live, so its checklist is closed.',
        },
        {
          id: 'team_hours',
          table: 'team_members',
          when: 'hours_per_week > 0 and hours_per_week <= 40',
          message: 'A team member works more than zero and at most 40 hours a week on one client.',
        },
        { id: 'value_positive', table: 'onboardings', when: 'contract_value > 0', message: 'A contract value must be more than zero.' },
      ],
    },
    access: [
      ...rules('onboardings', {
        account_manager: EDIT,
        delivery_lead: EDIT,
        client: { list: 'own', create: false, update: 'none', delete: false },
      }),
      ...rules('checklist_items', { account_manager: LOOK, delivery_lead: ALL, client: NONE }),
      ...rules('team_members', { account_manager: LOOK, delivery_lead: ALL, client: NONE }),
    ],
  }),
  views: () => ({
    views: [
      {
        table: 'onboardings',
        use: [
          { type: 'board', by: 'status', why: 'A column per stage, so everyone sees who is where.' },
          { type: 'table', why: 'Value, deposit, steps and team side by side.' },
          { type: 'timeline', start: 'kickoff_on', end: 'go_live_on', lane: 'delivery_lead', why: 'From kickoff to go-live, per lead.' },
          { type: 'calendar', date: 'go_live_on', why: 'When each client goes live.' },
        ],
      },
      {
        table: 'checklist_items',
        use: [
          { type: 'table', why: 'Every step with its due date.' },
          { type: 'tree', levels: ['onboarding', 'area'], why: 'Steps nested under each client and area.' },
          { type: 'calendar', date: 'due_on', why: 'What is due when.' },
        ],
      },
      {
        table: 'team_members',
        use: [
          { type: 'table', why: 'Who works for which client.' },
          {
            type: 'pivot',
            rows: 'person',
            cols: 'onboarding',
            measure: 'sum:hours_per_week',
            why: 'Hours a week, people against clients.',
          },
        ],
      },
    ],
    dashboard: {
      title: 'Overview',
      date: { table: 'onboardings', column: 'go_live_on' },
      widgets: [
        { kind: 'kpi', label: 'Waiting for the client', table: 'onboardings', where: { status: 'setup' } },
        { kind: 'kpi', label: 'Required steps open', table: 'onboardings', measure: 'sum:required_open' },
        { kind: 'kpi', label: 'Contract value onboarding', table: 'onboardings', measure: 'sum:contract_value' },
        { kind: 'kpi', label: 'Team hours a week', table: 'team_members', measure: 'sum:hours_per_week' },
        { kind: 'bar', label: 'Required steps open by client', table: 'onboardings', x: 'client_name', measure: 'sum:required_open' },
        { kind: 'bar', label: 'Hours a week by client', table: 'team_members', x: 'onboarding', measure: 'sum:hours_per_week' },
        { kind: 'recent', label: 'Latest clients', table: 'onboardings' },
      ],
    },
  }),
  ui: () => ({
    theme: { accent: 'purple', nav: 'side', icon: 'rocket', density: 'comfortable' },
    screens: [
      { name: 'Overview', type: 'dashboard', table: 'onboardings', roles: ['account_manager', 'delivery_lead'], icon: 'pie' },
      {
        name: 'Onboarding board',
        type: 'board',
        table: 'onboardings',
        roles: ['account_manager', 'delivery_lead'],
        group: 'status',
        label: 'client_name',
        columns: ['project', 'delivery_lead', 'go_live_on', 'required_open'],
        icon: 'board',
      },
      { name: 'Hand over a deal', type: 'form', table: 'onboardings', roles: ['account_manager'], icon: 'personAdd' },
      {
        name: 'Checklist',
        type: 'table',
        table: 'checklist_items',
        roles: ['delivery_lead', 'account_manager'],
        columns: ['step', 'onboarding', 'side', 'required', 'due_on', 'done'],
        icon: 'checkbox',
      },
      {
        name: 'Teams',
        type: 'table',
        table: 'team_members',
        roles: ['delivery_lead', 'account_manager'],
        columns: ['person', 'role_on_team', 'onboarding', 'hours_per_week'],
        icon: 'people',
      },
      {
        name: 'My onboarding',
        type: 'table',
        table: 'onboardings',
        roles: ['client'],
        columns: ['client_name', 'project', 'go_live_on', 'required_open', 'status'],
        icon: 'rocket',
      },
    ],
    tour: [
      {
        role: 'account_manager',
        do: 'create',
        table: 'onboardings',
        values: {
          client_name: 'Tailspin Toys',
          project: 'Toy shop app',
          contract_value: 20000,
          go_live_on: 45,
          delivery_lead: 'Imran Qadir',
          client_contact: 'Omer Siddiqui',
          kickoff_on: 5,
        },
        say: 'Nida, an account manager, hands over a signed deal for 20,000. The app works out a deposit of 6,000.',
      },
      {
        role: 'delivery_lead',
        do: 'transition',
        table: 'onboardings',
        transition: 'book_kickoff',
        say: 'Imran, the delivery lead, books the kickoff.',
      },
      {
        role: 'delivery_lead',
        do: 'denied',
        table: 'onboardings',
        action: 'start_setup',
        say: 'He cannot start setup yet: there is no checklist and no team.',
      },
      {
        role: 'delivery_lead',
        do: 'create',
        table: 'checklist_items',
        values: { step: 'App store accounts shared with us', area: 'access', side: 'client', required: true, due_on: 10 },
        say: 'He adds a required step for the client.',
      },
      {
        role: 'delivery_lead',
        do: 'create',
        table: 'team_members',
        values: { person: 'Danish Khan', role_on_team: 'developer', starts_on: 5, hours_per_week: 32 },
        say: 'And puts a developer on the team for 32 hours a week.',
      },
      {
        role: 'delivery_lead',
        do: 'transition',
        table: 'onboardings',
        transition: 'start_setup',
        say: 'Now setup can start.',
      },
      {
        role: 'client',
        user: 'omer',
        do: 'denied',
        table: 'onboardings',
        action: 'update',
        say: 'Omer, the client, can see his onboarding but not change it.',
      },
      {
        role: 'delivery_lead',
        do: 'open',
        screen: 'Onboarding board',
        say: 'Go-live waits until every required step is done and the deposit is in.',
      },
    ],
  }),
  tester: () => ({
    cases: [
      {
        name: 'Setup needs a checklist and a team',
        why: 'Setup starts only once there is a checklist and at least one team member.',
        steps: [
          {
            role: 'account_manager',
            do: 'create',
            table: 'onboardings',
            values: { client_name: 'Proseware', contract_value: 9000, delivery_lead: 'Sana Mir', kickoff_on: 3 },
          },
          { role: 'delivery_lead', do: 'transition', table: 'onboardings', transition: 'book_kickoff' },
          { role: 'delivery_lead', do: 'denied', table: 'onboardings', action: 'start_setup' },
        ],
      },
      {
        name: 'A live client’s checklist is closed',
        why: 'A live client can no longer be changed, and its checklist is closed.',
        steps: [
          {
            role: 'delivery_lead',
            do: 'invalid',
            table: 'checklist_items',
            values: { step: 'One more thing', onboarding: 1, side: 'our_team', required: false },
          },
        ],
      },
      {
        name: 'A team member works at most 40 hours a week',
        why: 'A team member works more than zero and at most 40 hours a week on one client.',
        steps: [
          {
            role: 'delivery_lead',
            do: 'invalid',
            table: 'team_members',
            values: { person: 'Ahmed Raza', onboarding: 2, hours_per_week: 50 },
          },
        ],
      },
      {
        name: 'Only the client signs off the scope',
        why: 'Only the client signs off the scope, and only once it is written.',
        steps: [{ role: 'delivery_lead', do: 'denied', table: 'onboardings', action: 'sign_off_scope' }],
      },
    ],
  }),
};

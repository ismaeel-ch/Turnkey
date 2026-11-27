import { REC } from './registry';
import { CARDS } from './catalog';
import type { AccessRule, Dict, BuildContext } from '@/shared/types/workspace';

/* ===== Turnkey · the expense manager, a saved build with two answers =====
   "I want to build an expense management app" is the example the guided build was designed around. Its one question
   is who the app is for, and the two answers lead to two different apps, recorded here:
   - "Just me" (answer 0): one person, a list of expenses and a list of categories with a monthly budget, no stages and
     no sign-in. It follows PERSONAL_EXPENSES in src/shared/plan/examples.ts.
   - "A company or team" (answer 1): employees, managers and Finance, claims that move from draft to paid, teams,
     categories and payments. It follows COMPANY_EXPENSES.
   Categories and teams are settings lists: removing the demo data keeps them. All people, teams and amounts are made up. */

const JUST_ME = 0;
const solo = (ctx: BuildContext | undefined) => ctx?.answer === JUST_ME;

// said back before the question, the same for both answers
const REFLECT = 'An app to keep track of expenses: what was spent, on what, and against which budget.';
const QUESTION = {
  text: 'Who is this for?',
  options: ['Just me', 'A company or team'],
  recommended: 1,
};

type Perm = Omit<AccessRule, 'table' | 'role'>;
const ALL: Perm = { list: 'all', create: true, update: 'all', delete: true };
const LOOK: Perm = { list: 'all', create: false, update: 'none', delete: false };
const NONE: Perm = { list: 'none', create: false, update: 'none', delete: false };
const rules = (table: string, by: Dict<Perm>): AccessRule[] => Object.entries(by).map(([role, p]) => ({ table, role, ...p }));

/* ---------- "Just me" ---------- */

const MY_CATEGORIES: [string, number][] = [
  ['Groceries', 40000],
  ['Transport', 15000],
  ['Eating out', 12000],
  ['Bills', 25000],
  ['Health', 8000],
  ['Fun', 10000],
];
// [what for, day offset, amount, category position, paid with]
const MY_EXPENSES: [string, number, number, number, string, string][] = [
  ['Weekly groceries', -2, 6200, 1, 'card', ''],
  ['Fuel', -3, 4500, 2, 'cash', ''],
  ['Dinner with friends', -5, 3800, 3, 'card', 'Split four ways'],
  ['Electricity bill', -6, 11400, 4, 'bank_transfer', ''],
  ['Pharmacy', -8, 1650, 5, 'cash', ''],
  ['Weekly groceries', -9, 5900, 1, 'card', ''],
  ['Cinema tickets', -11, 2400, 6, 'card', ''],
  ['Ride to the airport', -13, 2100, 2, 'card', ''],
  ['Internet', -15, 4999, 4, 'bank_transfer', ''],
  ['Weekly groceries', -16, 7100, 1, 'card', 'Stocked up for guests'],
  ['Lunch at work', -18, 950, 3, 'cash', ''],
  ['Gym fee', -20, 5000, 5, 'bank_transfer', ''],
  ['Fuel', -24, 4300, 2, 'cash', ''],
  ['Weekly groceries', -30, 6400, 1, 'card', ''],
  ['Book fair', -33, 3200, 6, 'cash', ''],
  ['Gas bill', -36, 3600, 4, 'bank_transfer', ''],
];

const personal = {
  research: () => ({
    name: 'My Expenses',
    summary: 'Track what you spend by category and by month, against a budget you set.',
    reflect: REFLECT,
    planned: true,
    settings: ['categories'],
    roles: [{ id: 'owner', name: 'You', can: 'Add expenses and see where the money goes' }],
    entities: [
      { name: 'expenses', what: 'Everything you spend' },
      { name: 'categories', what: 'What you group your spending by, each with a monthly budget' },
    ],
    process: { entity: 'expenses', states: [], note: 'No stages: an expense is just kept.' },
    stories: [
      { role: 'owner', want: 'add an expense in a few seconds', so: 'nothing is forgotten' },
      { role: 'owner', want: 'see what I spent this month in each category', so: 'I know where the money goes' },
      { role: 'owner', want: 'see my spending beside the budget I set', so: 'I notice when a category runs over' },
    ],
    rules: ['Only you use the app. You add, change and delete expenses freely.'],
    question: QUESTION,
    notInThisVersion: [
      { ask: 'A warning when a category goes over its budget', instead: 'The budget is shown beside what you spent in each category' },
    ],
  }),
  database: () => ({
    tables: [
      {
        name: 'expenses',
        label: 'Expenses',
        one: 'Expense',
        title: 'what_for',
        owner: null,
        columns: [
          { name: 'what_for', label: 'What it was for', type: 'text', required: true },
          { name: 'spent_on', label: 'Date', type: 'date', required: true },
          { name: 'amount', label: 'Amount', type: 'money', required: true },
          { name: 'category', label: 'Category', type: 'ref', ref: 'categories' },
          { name: 'paid_with', label: 'Paid with', type: 'select', options: ['cash', 'card', 'bank_transfer'] },
          { name: 'note', label: 'Note', type: 'longtext' },
        ],
        rows: MY_EXPENSES.map(([what_for, spent_on, amount, category, paid_with, note]) => ({
          what_for,
          spent_on,
          amount,
          category,
          paid_with,
          note,
        })),
      },
      {
        name: 'categories',
        label: 'Categories',
        one: 'Category',
        title: 'name',
        owner: null,
        columns: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'monthly_budget', label: 'Monthly budget', type: 'money' },
        ],
        rows: MY_CATEGORIES.map(([name, monthly_budget]) => ({ name, monthly_budget })),
      },
    ],
    users: [{ name: 'Hina Siddiqui', role: 'owner' }],
  }),
  backend: () => ({
    status: null,
    access: [...rules('expenses', { owner: ALL }), ...rules('categories', { owner: ALL })],
  }),
  views: () => ({
    views: [
      {
        table: 'expenses',
        use: [
          { type: 'table', why: 'Every expense, newest first, with the amounts totalled at the bottom.' },
          { type: 'chart', x: 'category', measure: 'sum:amount', why: 'Where the money goes, by category.' },
          { type: 'calendar', date: 'spent_on', why: 'What you spent on which day.' },
          { type: 'pivot', rows: 'category', cols: 'paid_with', measure: 'sum:amount', why: 'Each category split by how you paid.' },
          { type: 'cards', why: 'A card per expense, easy to read on a phone.' },
        ],
      },
      {
        table: 'categories',
        use: [
          { type: 'table', why: 'A short list with each monthly budget.' },
          { type: 'cards', why: 'One card per category.' },
        ],
      },
    ],
    dashboard: {
      title: 'This month',
      date: { table: 'expenses', column: 'spent_on' },
      widgets: [
        { kind: 'kpi', label: 'Spent', table: 'expenses', measure: 'sum:amount' },
        { kind: 'kpi', label: 'Expenses', table: 'expenses' },
        { kind: 'kpi', label: 'Monthly budget', table: 'categories', measure: 'sum:monthly_budget' },
        { kind: 'bar', label: 'Spent by category', table: 'expenses', x: 'category', measure: 'sum:amount' },
        { kind: 'line', label: 'Spent each week', table: 'expenses', x: 'spent_on', bucket: 'week', measure: 'sum:amount' },
        { kind: 'stack', label: 'How you paid', table: 'expenses', x: 'category', split: 'paid_with', measure: 'sum:amount' },
        { kind: 'recent', label: 'Latest expenses', table: 'expenses' },
      ],
    },
  }),
  ui: () => ({
    theme: { accent: 'seafoam', nav: 'side', icon: 'receipt', density: 'comfortable' },
    screens: [
      { name: 'This month', type: 'dashboard', table: 'expenses', roles: ['owner'], icon: 'pie' },
      { name: 'Add an expense', type: 'form', table: 'expenses', roles: ['owner'], icon: 'add' },
      {
        name: 'Expenses',
        type: 'table',
        table: 'expenses',
        roles: ['owner'],
        columns: ['what_for', 'spent_on', 'amount', 'category', 'paid_with'],
        icon: 'list',
      },
      { name: 'Calendar', type: 'calendar', table: 'expenses', roles: ['owner'], date: 'spent_on', label: 'what_for', icon: 'calendar' },
      { name: 'Categories', type: 'table', table: 'categories', roles: ['owner'], columns: ['name', 'monthly_budget'], icon: 'tag' },
    ],
    tour: [
      {
        role: 'owner',
        do: 'create',
        table: 'expenses',
        values: { what_for: 'Coffee beans', spent_on: 0, amount: 1800, category: 1, paid_with: 'card' },
        say: 'You add what you just spent: coffee beans, under Groceries.',
      },
      { role: 'owner', do: 'see', table: 'expenses', screen: 'Expenses', say: 'It is at the top of your expenses.' },
      { role: 'owner', do: 'open', screen: 'This month', say: 'This month shows what you spent by category, beside your budget.' },
    ],
  }),
};

/* ---------- "A company or team" ---------- */

// people, by their position in the list of users
const EMP = { ayesha: 1, bilal: 2, zara: 3 },
  MGR = { omar: 4, nadia: 5 };
const TEAMS: [string, number, number][] = [
  ['Sales', MGR.omar, 300000],
  ['Operations', MGR.nadia, 200000],
  ['Product', MGR.omar, 150000],
];
const CATEGORIES: [string, number, number][] = [
  ['Travel', 60000, 1],
  ['Meals', 8000, 1],
  ['Hotel', 45000, 1],
  ['Office supplies', 15000, 0],
  ['Training', 50000, 1],
];
// [what for, employee, day offset, amount, category, team, receipt link, stage, reason if sent back, approved by]
const CLAIMS: [string, number, number, number, number, number, string, string, string, number | null][] = [
  ['Flight to Karachi for the client visit', EMP.ayesha, -24, 38500, 1, 1, 'https://example.com/r/1041', 'paid', '', MGR.omar],
  ['Hotel, two nights in Karachi', EMP.ayesha, -23, 29000, 3, 1, 'https://example.com/r/1042', 'paid', '', MGR.omar],
  ['Team lunch after the launch', EMP.zara, -15, 7600, 2, 3, 'https://example.com/r/1043', 'approved', '', MGR.omar],
  ['Printer paper and toner', EMP.bilal, -12, 9800, 4, 2, 'https://example.com/r/1044', 'paid', '', MGR.nadia],
  ['Taxi to the warehouse', EMP.bilal, -9, 2400, 1, 2, '', 'submitted', '', null],
  ['Online course: project planning', EMP.zara, -8, 42000, 5, 3, 'https://example.com/r/1046', 'submitted', '', null],
  [
    'Dinner with a supplier',
    EMP.bilal,
    -7,
    11500,
    2,
    2,
    '',
    'draft',
    'Over the meals limit. Please add the receipt and who attended.',
    null,
  ],
  ['Train to Lahore for the trade fair', EMP.ayesha, -6, 6800, 1, 1, 'https://example.com/r/1048', 'approved', '', MGR.omar],
  ['Conference ticket', EMP.ayesha, -5, 55000, 5, 1, 'https://example.com/r/1049', 'rejected', '', null],
  ['Desk lamp', EMP.zara, -4, 4200, 4, 3, 'https://example.com/r/1050', 'submitted', '', null],
  ['Fuel for the site visit', EMP.bilal, -2, 5200, 1, 2, 'https://example.com/r/1051', 'submitted', '', null],
  ['Coffee for the workshop', EMP.zara, -1, 3100, 2, 3, '', 'draft', '', null],
];
const PAYMENTS: [string, number, number, string][] = [
  ['PAY-2041', 1, -18, 'bank_transfer'],
  ['PAY-2042', 2, -18, 'bank_transfer'],
  ['PAY-2047', 4, -6, 'cash'],
];

const company = {
  research: () => ({
    name: 'Expense Desk',
    summary: 'Employees claim expenses, managers approve them, and Finance pays them back.',
    reflect: REFLECT,
    settings: ['categories', 'teams'],
    roles: [
      { id: 'employee', name: 'Employee', can: 'Adds claims and sees only their own' },
      { id: 'manager', name: 'Manager', can: 'Approves, sends back or rejects claims' },
      { id: 'finance', name: 'Finance', can: 'Pays approved claims, manages categories and teams' },
    ],
    entities: [
      { name: 'claims', what: 'An expense someone asks to be paid back' },
      { name: 'categories', what: 'What a claim is for, with its limit' },
      { name: 'teams', what: 'The teams people claim for, each with a manager and a budget' },
      { name: 'payments', what: 'A payment Finance made for an approved claim' },
    ],
    process: {
      entity: 'claims',
      states: ['draft', 'submitted', 'approved', 'paid', 'rejected'],
      note: 'The Employee submits. The Manager approves, sends it back to Draft with a reason, or rejects it. Finance marks it as paid.',
    },
    stories: [
      { role: 'employee', want: 'submit a claim with a link to its receipt', so: 'I am paid back' },
      { role: 'employee', want: 'see where each of my claims is', so: 'I do not have to ask' },
      { role: 'employee', want: 'fix and resend a claim that was sent back', so: 'it can still be approved' },
      { role: 'manager', want: 'approve a claim or send it back with a reason', so: 'only fair claims are paid' },
      { role: 'finance', want: 'pay approved claims and record the payment', so: 'the books are right' },
      { role: 'finance', want: 'see spending by category and by team', so: 'I can watch the budgets' },
    ],
    rules: [
      'Employees see and change only their own claims.',
      'Managers see every claim and are the only ones who approve. They do not add claims of their own.',
      'Finance sees everything and is the only one who records payments.',
      'Only Finance changes categories and teams.',
    ],
    question: QUESTION,
    notInThisVersion: [
      { ask: 'Managers limited to the claims of their own team', instead: 'Managers see every claim' },
      { ask: 'Receipt photos', instead: 'Each claim has a receipt link or note' },
      { ask: 'Locking a claim once it is paid', instead: 'Nobody but its employee can change a claim, at any stage' },
    ],
  }),
  database: () => ({
    tables: [
      {
        name: 'claims',
        label: 'Claims',
        one: 'Claim',
        title: 'what_for',
        owner: 'employee',
        columns: [
          { name: 'what_for', label: 'What it was for', type: 'text', required: true },
          { name: 'employee', label: 'Employee', type: 'user', role: 'employee', required: true },
          { name: 'spent_on', label: 'Date', type: 'date', required: true },
          { name: 'amount', label: 'Amount', type: 'money', required: true },
          { name: 'category', label: 'Category', type: 'ref', ref: 'categories' },
          { name: 'team', label: 'Team', type: 'ref', ref: 'teams' },
          { name: 'receipt_link', label: 'Receipt link', type: 'text' },
          {
            name: 'status',
            label: 'Stage',
            type: 'select',
            options: ['draft', 'submitted', 'approved', 'paid', 'rejected'],
            required: true,
          },
          { name: 'sent_back_reason', label: 'Reason if sent back', type: 'longtext' },
          { name: 'approved_by', label: 'Approved by', type: 'user', role: 'manager' },
        ],
        rows: CLAIMS.map(([what_for, employee, spent_on, amount, category, team, receipt_link, status, sent_back_reason, approved_by]) => ({
          what_for,
          employee,
          spent_on,
          amount,
          category,
          team,
          receipt_link,
          status,
          sent_back_reason,
          approved_by,
        })),
      },
      {
        name: 'categories',
        label: 'Categories',
        one: 'Category',
        title: 'name',
        owner: null,
        columns: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'limit_per_claim', label: 'Limit per claim', type: 'money' },
          { name: 'receipt_needed', label: 'Receipt needed', type: 'bool' },
        ],
        rows: CATEGORIES.map(([name, limit_per_claim, receipt_needed]) => ({ name, limit_per_claim, receipt_needed })),
      },
      {
        name: 'teams',
        label: 'Teams',
        one: 'Team',
        title: 'name',
        owner: null,
        columns: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'manager', label: 'Manager', type: 'user', role: 'manager' },
          { name: 'monthly_budget', label: 'Monthly budget', type: 'money' },
        ],
        rows: TEAMS.map(([name, manager, monthly_budget]) => ({ name, manager, monthly_budget })),
      },
      {
        name: 'payments',
        label: 'Payments',
        one: 'Payment',
        title: 'reference',
        owner: null,
        columns: [
          { name: 'reference', label: 'Reference', type: 'text', required: true },
          { name: 'claim', label: 'Claim', type: 'ref', ref: 'claims', required: true },
          { name: 'paid_on', label: 'Paid on', type: 'date', required: true },
          { name: 'method', label: 'Method', type: 'select', options: ['bank_transfer', 'cash', 'cheque'] },
        ],
        rows: PAYMENTS.map(([reference, claim, paid_on, method]) => ({ reference, claim, paid_on, method })),
      },
    ],
    users: [
      { name: 'Ayesha Malik', role: 'employee' },
      { name: 'Bilal Ahmed', role: 'employee' },
      { name: 'Zara Hussain', role: 'employee' },
      { name: 'Omar Farooq', role: 'manager' },
      { name: 'Nadia Qureshi', role: 'manager' },
      { name: 'Saad Khan', role: 'finance' },
    ],
  }),
  backend: () => ({
    status: {
      table: 'claims',
      column: 'status',
      initial: 'draft',
      states: [
        { id: 'draft', label: 'Draft', tone: 'neutral' },
        { id: 'submitted', label: 'Submitted', tone: 'info' },
        { id: 'approved', label: 'Approved', tone: 'warning' },
        { id: 'paid', label: 'Paid', tone: 'success' },
        { id: 'rejected', label: 'Rejected', tone: 'danger' },
      ],
      transitions: [
        { id: 'submit', label: 'Submit', from: ['draft'], to: 'submitted', roles: ['employee'] },
        { id: 'approve', label: 'Approve', from: ['submitted'], to: 'approved', roles: ['manager'] },
        { id: 'send_back', label: 'Send back', from: ['submitted'], to: 'draft', roles: ['manager'] },
        { id: 'reject', label: 'Reject', from: ['submitted'], to: 'rejected', roles: ['manager'] },
        { id: 'mark_as_paid', label: 'Mark as paid', from: ['approved'], to: 'paid', roles: ['finance'] },
      ],
    },
    access: [
      ...rules('claims', { employee: { list: 'own', create: true, update: 'own', delete: false }, manager: LOOK, finance: LOOK }),
      ...rules('categories', { employee: LOOK, manager: LOOK, finance: ALL }),
      ...rules('teams', { employee: LOOK, manager: LOOK, finance: ALL }),
      ...rules('payments', { employee: NONE, manager: LOOK, finance: { list: 'all', create: true, update: 'all', delete: false } }),
    ],
  }),
  views: () => ({
    views: [
      {
        table: 'claims',
        use: [
          { type: 'board', by: 'status', why: 'A column per stage, so a manager sees at once what waits for them.' },
          { type: 'table', why: 'For sorting and filtering, with the amounts totalled.' },
          { type: 'calendar', date: 'spent_on', why: 'When the money was spent.' },
          { type: 'chart', x: 'category', split: 'status', measure: 'sum:amount', why: 'Amounts claimed by category and stage.' },
          { type: 'pivot', rows: 'team', cols: 'category', measure: 'sum:amount', why: 'What each team spends on what.' },
          { type: 'tree', levels: ['team', 'employee'], why: 'Claims nested under each team and person.' },
        ],
      },
      {
        table: 'categories',
        use: [
          { type: 'table', why: 'A short list with each limit.' },
          { type: 'cards', why: 'One card per category.' },
        ],
      },
      {
        table: 'teams',
        use: [
          { type: 'table', why: 'Each team with its manager and budget.' },
          { type: 'cards', why: 'One card per team.' },
        ],
      },
      {
        table: 'payments',
        use: [
          { type: 'table', why: 'A ledger of what Finance paid.' },
          { type: 'calendar', date: 'paid_on', why: 'When payments went out.' },
          { type: 'chart', x: 'method', why: 'How claims were paid.' },
        ],
      },
    ],
    dashboard: {
      title: 'Overview',
      date: { table: 'claims', column: 'spent_on' },
      widgets: [
        { kind: 'kpi', label: 'Claims', table: 'claims' },
        { kind: 'kpi', label: 'Waiting for a manager', table: 'claims', where: { status: 'submitted' } },
        { kind: 'kpi', label: 'Approved, not paid yet', table: 'claims', measure: 'sum:amount', where: { status: 'approved' } },
        { kind: 'kpi', label: 'Paid back', table: 'claims', measure: 'sum:amount', where: { status: 'paid' } },
        { kind: 'bar', label: 'Claims by stage', table: 'claims', x: 'status' },
        { kind: 'bar', label: 'Amount by category', table: 'claims', x: 'category', measure: 'sum:amount' },
        { kind: 'stack', label: 'Amount by team', table: 'claims', x: 'team', split: 'status', measure: 'sum:amount' },
        { kind: 'line', label: 'Claimed each week', table: 'claims', x: 'spent_on', bucket: 'week', measure: 'sum:amount' },
        { kind: 'recent', label: 'Latest claims', table: 'claims' },
      ],
    },
  }),
  ui: () => ({
    theme: { accent: 'seafoam', nav: 'side', icon: 'receipt', density: 'comfortable' },
    screens: [
      { name: 'New claim', type: 'form', table: 'claims', roles: ['employee'], icon: 'add' },
      {
        name: 'My claims',
        type: 'table',
        table: 'claims',
        roles: ['employee'],
        columns: ['what_for', 'spent_on', 'amount', 'category', 'status'],
        icon: 'list',
      },
      {
        name: 'Approvals',
        type: 'board',
        table: 'claims',
        roles: ['manager', 'finance'],
        group: 'status',
        label: 'what_for',
        columns: ['employee', 'amount', 'category'],
        icon: 'board',
      },
      {
        name: 'All claims',
        type: 'table',
        table: 'claims',
        roles: ['manager', 'finance'],
        columns: ['what_for', 'employee', 'team', 'spent_on', 'amount', 'status'],
        icon: 'list',
      },
      {
        name: 'Payments',
        type: 'table',
        table: 'payments',
        roles: ['finance', 'manager'],
        columns: ['reference', 'claim', 'paid_on', 'method'],
        icon: 'payment',
      },
      {
        name: 'Categories',
        type: 'table',
        table: 'categories',
        roles: ['employee', 'manager', 'finance'],
        columns: ['name', 'limit_per_claim', 'receipt_needed'],
        icon: 'tag',
      },
      {
        name: 'Teams',
        type: 'table',
        table: 'teams',
        roles: ['manager', 'finance'],
        columns: ['name', 'manager', 'monthly_budget'],
        icon: 'people',
      },
      { name: 'Overview', type: 'dashboard', table: 'claims', roles: ['employee', 'manager', 'finance'], icon: 'pie' },
    ],
    tour: [
      {
        role: 'employee',
        do: 'create',
        table: 'claims',
        values: {
          what_for: 'Taxi to the client meeting',
          spent_on: -1,
          amount: 1900,
          category: 1,
          team: 1,
          receipt_link: 'https://example.com/r/1060',
          status: 'draft',
        },
        say: 'Ayesha adds a claim for a taxi to a client meeting.',
      },
      { role: 'employee', do: 'transition', table: 'claims', transition: 'submit', say: 'She submits it for approval.' },
      { role: 'manager', do: 'see', table: 'claims', screen: 'Approvals', say: 'Omar, a manager, finds it on the approvals board.' },
      { role: 'manager', do: 'transition', table: 'claims', transition: 'approve', say: 'Omar approves it.' },
      {
        role: 'employee',
        do: 'denied',
        table: 'payments',
        action: 'create',
        say: 'Ayesha tries to record a payment herself. The backend refuses.',
      },
      { role: 'finance', do: 'transition', table: 'claims', transition: 'mark_as_paid', say: 'Saad in Finance marks it as paid.' },
      { role: 'finance', do: 'open', screen: 'Overview', say: 'Saad opens the overview to see what was claimed by category and by team.' },
    ],
  }),
};

const pick =
  <K extends keyof typeof personal>(key: K) =>
  (ctx: BuildContext | undefined) =>
    (solo(ctx) ? personal : company)[key]();

REC.expenses = {
  ...CARDS.expenses,
  usage: {
    research: [1150, 560, 5600],
    database: [2310, 2420, 12600],
    backend: [2980, 820, 7000],
    views: [2470, 1130, 7900],
    ui: [3880, 1350, 9400],
  },
  say: {
    research: [
      'Reading the request and your answer about who the app is for.',
      'The kinds of people, the lists and the stages follow that answer, as in the plan you approved.',
    ],
    database: [
      'Creating the lists from the plan, with made-up expenses dated around today. Categories are settings, so they stay when you remove the demo data.',
    ],
    backend: ['Writing who may see and change what, and the stages a claim moves through when the app has them.'],
    views: [
      'Expenses have a date, an amount and a category, so a table, a calendar and charts that total the amount all fit.',
      'The dashboard totals what was spent and shows it by category and by week.',
    ],
    ui: [
      'Laying out the pages: a form to add an expense, the list, a calendar and the dashboard. Seafoam, side navigation, a receipt for the icon.',
    ],
  },
  research: pick('research'),
  database: pick('database'),
  backend: pick('backend'),
  views: pick('views'),
  ui: pick('ui'),
};

import { describe, expect, it } from 'vitest';
import {
  aAn,
  checklist,
  emptyDash,
  emptyList,
  firstAction,
  guideFor,
  hasExamples,
  isDone,
  roleLine,
  soleUser,
  toYou,
  tourStops,
  welcomePoints,
  type Progress,
} from '@/workspace/onboarding';
import type { AppDef, AppTable, Permission } from '@/shared/types/app';
import type { AppRecord } from '@/shared/types/workspace';

/* A made-up expense app: employees submit claims, a manager approves, finance pays. */
const table = (name: string, label: string, one: string): AppTable => ({
  name,
  label,
  one,
  title: 'title',
  owner: name === 'claims' ? 'employee_id' : null,
  columns: [{ name: 'title', label: 'Title', type: 'text', required: true }],
});
const allow = (list: Permission['list'], create: boolean): Permission => ({ list, create, update: create ? 'own' : 'none', delete: false });
const def: AppDef = {
  brief: {
    name: 'Expense Desk',
    summary: 'Employees claim expenses.',
    roles: [
      { id: 'employee', name: 'Employee', can: 'Submits claims and tracks them.' },
      { id: 'manager', name: 'Manager', can: 'Approves claims or sends them back' },
      { id: 'finance', name: 'Finance', can: '' },
    ],
    entities: [],
    process: { entity: 'claims', states: ['draft', 'submitted', 'approved', 'paid'], note: '' },
    stories: [
      { role: 'employee', want: 'submit a claim with its receipt link', so: 'I get paid back' },
      { role: 'employee', want: 'see where each of my claims is', so: '' },
      { role: 'employee', want: 'fix and resend a claim that was sent back to me', so: '' },
      { role: 'employee', want: 'a fourth thing that must not show', so: '' },
      { role: 'manager', want: 'approve a claim or send it back with a reason', so: '' },
    ],
    rules: [],
    question: null,
    decision: null,
    sources: [],
  },
  tables: [table('claims', 'Claims', 'Claim'), table('payments', 'Payments', 'Payment'), table('categories', 'Categories', 'Category')],
  users: [],
  process: {
    table: 'claims',
    column: 'status',
    states: [],
    initial: 'draft',
    transitions: [
      { id: 'submit', label: 'Submit', from: ['draft'], to: 'submitted', roles: ['employee'], set: {} },
      { id: 'approve', label: 'Approve', from: ['submitted'], to: 'approved', roles: ['manager'], set: {} },
      { id: 'send_back', label: 'Send back', from: ['submitted'], to: 'draft', roles: ['manager'], set: {} },
      { id: 'pay', label: 'Pay', from: ['approved'], to: 'paid', roles: ['finance'], set: {} },
    ],
  },
  access: {
    claims: { employee: allow('own', true), manager: allow('all', false), finance: allow('all', false) },
    payments: { employee: allow('none', false), manager: allow('all', false), finance: allow('all', true) },
    categories: { employee: allow('all', false), manager: allow('all', false), finance: allow('all', true) },
  },
  team: null,
  views: {},
  dash: null,
  screens: [
    { id: 'overview', name: 'Overview', type: 'dashboard', table: 'claims', roles: ['manager', 'finance'], columns: [] },
    { id: 'mine', name: 'My claims', type: 'table', table: 'claims', roles: ['employee'], columns: [] },
    { id: 'new', name: 'New claim', type: 'form', table: 'claims', roles: ['employee'], columns: [] },
    { id: 'review', name: 'Waiting for me', type: 'board', table: 'claims', roles: ['manager'], columns: [] },
    { id: 'pay', name: 'Ready to pay', type: 'table', table: 'claims', roles: ['finance'], columns: [] },
    { id: 'payments', name: 'Payments', type: 'table', table: 'payments', roles: ['finance'], columns: [] },
  ],
  theme: { accent: 'teal', nav: 'side', icon: 'receipt' },
  tour: [],
  actions: [],
  migrations: [],
};
const claims = def.tables[0];

describe('words for the person', () => {
  it('turns a user story into a sentence spoken to the person', () => {
    expect(toYou('see where each of my claims is.')).toBe('See where each of your claims is');
    expect(toYou('I want to fix a claim sent back to me')).toBe('Fix a claim sent back to you');
    expect(toYou('know when I am next on call')).toBe('Know when you are next on call');
  });
  it('picks a or an', () => {
    expect(aAn('claim')).toBe('a claim');
    expect(aAn('appointment')).toBe('an appointment');
  });
  it('uses what the kind of person can do as the line under their name, without a full stop', () => {
    expect(roleLine(def, 'employee')).toBe('Submits claims and tracks them');
    expect(roleLine(def, 'manager')).toBe('Approves claims or sends them back');
  });
  it('works the line out from the access rules when the brief has none', () => {
    expect(roleLine(def, 'finance')).toBe('Adds payments and categories');
    expect(roleLine({ ...def, brief: null }, 'manager')).toBe('Sees claims, payments and categories');
  });
});

describe('the welcome', () => {
  it('shows at most three things, the person’s own stories first', () => {
    expect(welcomePoints(def, 'employee')).toEqual([
      'Submit a claim with its receipt link',
      'See where each of your claims is',
      'Fix and resend a claim that was sent back to you',
    ]);
  });
  it('fills up from the status steps and the screens when there are few stories', () => {
    // "Approve a claim" would say the manager's own story twice
    expect(welcomePoints(def, 'manager')).toEqual([
      'Approve a claim or send it back with a reason',
      'Use "Send back" on a claim',
      'Open Overview',
    ]);
    expect(welcomePoints(def, 'finance')).toEqual(['Add a payment', 'Add a category', 'Pay a claim']);
  });
  it('a different kind of person gets a different first thing to do', () => {
    // the employee's first story makes a record, and they have a form page for it
    expect(firstAction(def, 'employee')).toEqual({ label: 'Submit your first claim', screen: 'new', create: null });
    // the manager's is about claims they cannot add: their list of claims opens
    expect(firstAction(def, 'manager')).toEqual({ label: 'Open Waiting for me', screen: 'review', create: null });
  });
  it('with no story, adding the main record comes first, in the form over its list', () => {
    expect(firstAction(def, 'finance')).toEqual({ label: 'Add your first payment', screen: 'payments', create: 'payments' });
  });
  it('a kind of person with no screens has no first thing to do', () => {
    expect(firstAction({ ...def, screens: [] }, 'manager')).toBeNull();
  });
  it('still works with no brief at all', () => {
    const g = guideFor({ ...def, brief: null }, 'employee');
    expect(g.roleName).toBe('Employee');
    expect(g.points).toEqual(['Add a claim', 'Submit a claim', 'Open My claims']);
    expect(g.action).toEqual({ label: 'Add your first claim', screen: 'new', create: null });
  });
});

describe('the checklist', () => {
  const ids = (role: string, o?: { owner?: boolean; demo?: boolean }) => checklist(def, role, o).map((x) => x.id);
  it('is three to five real things, by what the kind of person may do', () => {
    expect(ids('employee')).toEqual(['open', 'create', 'move']);
    expect(ids('manager')).toEqual(['open', 'move', 'dash']);
    expect(checklist(def, 'manager').map((x) => x.text)).toEqual([
      'Open a claim and look around',
      'Open a claim and press "Approve"',
      'Look at Overview',
    ]);
  });
  it('adds the owner’s item only for the owner, and only while demo data is there', () => {
    expect(ids('manager', { owner: true, demo: true })).toContain('demo');
    expect(ids('manager', { owner: false, demo: true })).not.toContain('demo');
    expect(ids('manager', { owner: true, demo: false })).not.toContain('demo');
  });
  it('ticks an item from what the person has done', () => {
    const none: Progress = { opened: false, seen: {}, did: new Set(), demo: true };
    const some: Progress = { opened: true, seen: { overview: true }, did: new Set(['claims|approve']), demo: false };
    const items = checklist(def, 'manager', { owner: true, demo: true });
    expect(items.map((it) => isDone(it, none))).toEqual([false, false, false, false]);
    expect(items.map((it) => isDone(it, some))).toEqual([true, true, true, true]);
    // someone else's kind of step does not tick it
    expect(isDone(items[1], { ...none, did: new Set(['claims|pay', 'payments|approve']) })).toBe(false);
  });
});

describe('the tour', () => {
  it('has at most four stops and each fits in a bubble', () => {
    const stops = tourStops(def, 'employee');
    expect(stops.map((s) => s.target)).toEqual(['nav', 'list', 'add', 'status']);
    expect(stops.every((s) => s.text.length <= 160)).toBe(true);
    expect(stops[1].text).toMatch(/^Your claims are listed here/);
  });
  it('leaves out a stop for something the person does not have', () => {
    // a manager cannot add a claim: the third stop is what they do to one
    const m = tourStops(def, 'manager');
    expect(m.map((s) => s.target)).toEqual(['nav', 'list', 'list', 'status']);
    expect(m[2].text).toBe('Open a claim and use Approve or Send back.');
    // one screen: no stop on the navigation
    const one = { ...def, screens: def.screens.filter((s) => s.id === 'mine') };
    expect(tourStops(one, 'employee').map((s) => s.target)).toEqual(['list', 'add', 'status']);
    // only a dashboard: nothing to point at but the navigation
    const dash = { ...def, screens: def.screens.filter((s) => s.id === 'overview' || s.id === 'pay') };
    expect(tourStops(dash, 'manager')).toEqual([]);
  });
  it('says who moves the status on when the person cannot', () => {
    const watcher = {
      ...def,
      screens: [...def.screens, { id: 'all', name: 'All claims', type: 'table', table: 'claims', roles: ['auditor'], columns: [] }],
    };
    watcher.access = { ...def.access, claims: { ...def.access.claims, auditor: allow('all', false) } };
    const s = tourStops(watcher, 'auditor');
    expect(s[s.length - 1].text).toBe(
      'Each claim has a status. It moves on when someone signed in as Employee, Manager or Finance acts on it.',
    );
  });
});

describe('empty screens', () => {
  it('offers Add to a person who may add', () => {
    expect(emptyList(def, def.tables[1], 'finance', 0)).toMatchObject({ title: 'No payments yet', button: 'add', label: 'New payment' });
  });
  it('tells a person who sees only their own that the list is theirs', () => {
    expect(emptyList(def, claims, 'employee', 0)).toMatchObject({
      title: 'You have no claims yet',
      text: 'You see your own claims here.',
      button: 'add',
    });
  });
  it('tells a person who may not add who does', () => {
    expect(emptyList(def, claims, 'manager', 0)).toMatchObject({
      title: 'No claims yet',
      text: 'They appear here when someone signed in as Employee adds one.',
      button: null,
    });
    expect(emptyList(def, def.tables[2], 'manager', 0).text).toBe('They appear here when someone signed in as Finance adds one.');
  });
  it('offers Clear filters when records exist but none match', () => {
    expect(emptyList(def, claims, 'manager', 12)).toMatchObject({ title: 'No claims match', button: 'clear', label: 'Clear filters' });
  });
  it('a dashboard with nothing to count offers Add only to someone who may add', () => {
    expect(emptyDash(def, claims, 'employee')).toMatchObject({ title: 'Nothing to count yet', button: 'add', label: 'New claim' });
    expect(emptyDash(def, claims, 'manager').button).toBeNull();
  });
});

describe('apps with no sign-in screen', () => {
  const people = [
    { id: 1, role: 'owner' },
    { id: 2, role: 'owner' },
  ];
  const app = (audience?: string) => ({ plan: audience ? { audience } : null }) as Pick<AppRecord, 'plan'>;
  it('one kind of person: the app opens as its first person', () => {
    expect(soleUser(app(), people)).toBe(people[0]);
    expect(soleUser(app(), [people[1]])).toBe(people[1]);
  });
  it('several kinds of people: the sign-in screen stays', () => {
    expect(soleUser(app(), [...people, { id: 3, role: 'manager' }])).toBeNull();
    expect(soleUser(app(), [])).toBeNull();
  });
  it('a plan answered "Just me" opens straight away whoever is in it', () => {
    expect(soleUser(app('just_me'), [...people, { id: 3, role: 'manager' }])).toBe(people[0]);
    expect(soleUser(app('company'), [...people, { id: 3, role: 'manager' }])).toBeNull();
  });
});

describe('demo data', () => {
  it('is not marked yet, so the welcome does not claim it is', () => {
    expect(hasExamples({ id: 'a1' } as AppRecord)).toBe(false);
  });
});

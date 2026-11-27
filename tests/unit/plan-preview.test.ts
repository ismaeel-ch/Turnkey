import { describe, expect, it } from 'vitest';
import {
  COMPANY_EXPENSES,
  PERSONAL_EXPENSES,
  accessRows,
  answerText,
  cardsToAsk,
  nextCard,
  planAnswers,
  previewPlan,
  stagePath,
  teamFor,
  type CardAnswers,
  type PlanSpec,
  type QuestionCard,
} from '@/shared/plan';

const copy = (plan: PlanSpec): PlanSpec => structuredClone(plan);
const person = (id: string) => COMPANY_EXPENSES.people.filter((p) => p.id === id);
const you = (...picked: string[]) => ({ picked, by: 'you' as const });

/** The expense interview: the company plan is the draft, and "Just me" leads to the personal one. */
const CARDS: QuestionCard[] = [
  {
    id: 'audience',
    title: 'Who is this for?',
    why: 'this decides whether the app needs sign-ins and approvals at all.',
    kind: 'one',
    usual: ['company'],
    options: [
      {
        id: 'just_me',
        label: 'Just me',
        desc: 'Track my own spending',
        leads: {
          audience: 'just_me',
          people: PERSONAL_EXPENSES.people,
          lists: PERSONAL_EXPENSES.lists,
          stages: null,
          permissions: PERSONAL_EXPENSES.permissions,
          rules: PERSONAL_EXPENSES.rules,
        },
      },
      { id: 'company', label: 'A company or team', desc: 'People claim, someone approves' },
    ],
  },
  {
    id: 'people',
    title: 'Who does what?',
    why: 'each kind of person gets their own screens.',
    kind: 'many',
    usual: ['employee', 'manager', 'finance'],
    onlyIf: { card: 'audience', anyOf: ['company'] },
    options: [
      { id: 'employee', label: 'Employee', desc: 'Adds claims', leads: { people: person('employee') } },
      { id: 'manager', label: 'Manager', desc: 'Approves claims', leads: { people: person('manager') } },
      { id: 'finance', label: 'Finance', desc: 'Pays claims', leads: { people: person('finance') } },
    ],
  },
  {
    id: 'approval',
    title: 'What happens after someone submits a claim?',
    why: 'this is the path every claim follows.',
    kind: 'one',
    usual: ['two'],
    onlyIf: { card: 'audience', anyOf: ['company'] },
    options: [
      { id: 'two', label: 'Manager approves, then Finance pays', desc: 'Draft, Submitted, Approved, Paid' },
      { id: 'none', label: 'No approval', desc: 'A claim is saved and that is all', leads: { stages: null } },
    ],
  },
  {
    id: 'demo_data',
    title: 'Would you like demo data to try the app?',
    why: 'an empty app is hard to judge.',
    kind: 'one',
    usual: ['yes'],
    options: [
      { id: 'yes', label: 'Yes, add demo data', desc: 'Made-up records' },
      { id: 'no', label: 'No, start empty', desc: 'Only the starter settings' },
    ],
  },
];

describe('cardsToAsk', () => {
  it('asks every card while the usual choices stand, and drops the ones an answer makes pointless', () => {
    expect(cardsToAsk(CARDS, {}).map((c) => c.id)).toEqual(['audience', 'people', 'approval', 'demo_data']);
    expect(cardsToAsk(CARDS, { audience: you('just_me') }).map((c) => c.id)).toEqual(['audience', 'demo_data']);
  });

  it('does not ask a card that hangs on an answer given in the owner’s own words', () => {
    const answers: CardAnswers = { audience: { picked: [], other: 'My football club', by: 'you' } };
    expect(cardsToAsk(CARDS, answers).map((c) => c.id)).toEqual(['audience', 'demo_data']);
  });

  it('walks the cards one at a time', () => {
    expect(nextCard(CARDS, {})?.id).toBe('audience');
    expect(nextCard(CARDS, { audience: you('company') })?.id).toBe('people');
    expect(nextCard(CARDS, { audience: you('just_me') })?.id).toBe('demo_data');
    expect(nextCard(CARDS, { audience: you('just_me'), demo_data: you('no') })).toBeNull();
  });
});

describe('previewPlan', () => {
  it('is the draft until something is answered, and never changes the draft', () => {
    const draft = copy(COMPANY_EXPENSES);
    const plan = previewPlan(draft, CARDS, {});
    expect(plan.people).toEqual(COMPANY_EXPENSES.people);
    expect(plan.lists).toEqual(COMPANY_EXPENSES.lists);
    previewPlan(draft, CARDS, { audience: you('just_me'), demo_data: you('no') });
    expect(draft).toEqual(COMPANY_EXPENSES);
  });

  it('"Just me" leads to one person, two lists, no stages and a smaller team', () => {
    const plan = previewPlan(COMPANY_EXPENSES, CARDS, { audience: you('just_me') });
    expect(plan.audience).toBe('just_me');
    expect(plan.people.map((p) => p.name)).toEqual(['You']);
    expect(plan.lists.map((l) => l.label)).toEqual(['Expenses', 'Categories']);
    expect(plan.stages).toBeNull();
    expect(teamFor(plan).agents).toBe(5);
    expect(teamFor(COMPANY_EXPENSES).agents).toBe(7);
  });

  it('ignores the answers of cards that no longer apply', () => {
    const answers: CardAnswers = { audience: you('just_me'), people: you('employee'), approval: you('none') };
    expect(previewPlan(COMPANY_EXPENSES, CARDS, answers).people.map((p) => p.name)).toEqual(['You']);
    expect(planAnswers(CARDS, answers).map((a) => a.slot)).toEqual(['audience']);
  });

  it('adds up what the ticked options lead to, and drops moves and stories of people who were unticked', () => {
    const plan = previewPlan(COMPANY_EXPENSES, CARDS, { audience: you('company'), people: you('employee', 'manager') });
    expect(plan.people.map((p) => p.id)).toEqual(['employee', 'manager']);
    expect(plan.stages?.moves.map((m) => m.label)).toEqual(['Submit', 'Approve', 'Send back', 'Reject']);
    expect(plan.stories.every((s) => s.role !== 'finance')).toBe(true);
    expect(accessRows(plan).every((r) => r.cells.length === 2)).toBe(true);
  });

  it('on a people card whose options say nothing more, code works out the plan for the kinds of people ticked', () => {
    const people: QuestionCard = { ...CARDS[1], onlyIf: undefined, options: CARDS[1].options.map(({ leads: _leads, ...o }) => o) };
    const plan = previewPlan(COMPANY_EXPENSES, [people], { people: you('employee', 'manager') });
    expect(plan.people.map((p) => p.id)).toEqual(['employee', 'manager']);
    expect(Object.keys(plan.permissions.claims).sort()).toEqual(['employee', 'manager']);
    expect(plan.stages?.moves.every((m) => m.by.length > 0 && !m.by.includes('finance'))).toBe(true);
    expect(plan.stories.every((s) => s.role !== 'finance')).toBe(true);
    expect(previewPlan(COMPANY_EXPENSES, [people], {}).people).toEqual(COMPANY_EXPENSES.people);
  });

  it('an option that leads to no stages removes them', () => {
    expect(previewPlan(COMPANY_EXPENSES, CARDS, { approval: you('none') }).stages).toBeNull();
  });

  it('reads the fixed slots even when the card does not spell out what they lead to', () => {
    expect(previewPlan(COMPANY_EXPENSES, CARDS, { demo_data: you('no') }).demoData).toBe(false);
    expect(previewPlan(COMPANY_EXPENSES, CARDS, { demo_data: you('yes') }).demoData).toBe(true);
    const bare: QuestionCard[] = [{ ...CARDS[0], options: CARDS[0].options.map(({ leads: _leads, ...o }) => o) }];
    expect(previewPlan(COMPANY_EXPENSES, bare, { audience: you('just_me') }).audience).toBe('just_me');
  });

  it('lays permissions over list by list, so an option only names the lists it changes', () => {
    const open: QuestionCard = {
      id: 'visibility',
      title: 'Who can see a claim?',
      why: 'it decides what each person finds.',
      kind: 'one',
      usual: ['own'],
      options: [
        { id: 'own', label: 'Only the person who made it', desc: '' },
        {
          id: 'all',
          label: 'Everyone sees every claim',
          desc: '',
          leads: {
            permissions: {
              claims: { ...COMPANY_EXPENSES.permissions.claims, employee: { list: 'all', create: true, update: 'own', delete: false } },
            },
          },
        },
      ],
    };
    const plan = previewPlan(COMPANY_EXPENSES, [open], { visibility: you('all') });
    expect(plan.permissions.claims.employee.list).toBe('all');
    expect(plan.permissions.payments).toEqual(COMPANY_EXPENSES.permissions.payments);
  });

  it('keeps the answers: chosen ones as "you", skipped ones as "assumed", and what the Planner assumed on its own', () => {
    const plan = previewPlan(COMPANY_EXPENSES, CARDS, {
      audience: you('company'),
      people: you('employee', 'manager'),
      approval: { picked: ['two'], by: 'usual' },
    });
    expect(plan.answers.slice(0, 3)).toEqual([
      { slot: 'audience', question: 'Who is this for?', answer: 'A company or team', value: 'company', by: 'you' },
      { slot: 'people', question: 'Who does what?', answer: 'Employee, Manager', by: 'you' },
      {
        slot: 'approval',
        question: 'What happens after someone submits a claim?',
        answer: 'Manager approves, then Finance pays',
        value: 'two',
        by: 'assumed',
      },
    ]);
    expect(plan.answers.filter((a) => a.by === 'assumed').map((a) => a.slot)).toEqual(['approval', 'currency', 'approver']);
    expect(plan.answers.some((a) => a.slot === 'demo_data')).toBe(false); // not answered yet
  });

  it('an answer in the owner’s own words is kept as text and leaves the plan for the Planner to change', () => {
    const answers: CardAnswers = { approval: { picked: [], other: 'The owner signs off on Fridays', by: 'you' } };
    const plan = previewPlan(COMPANY_EXPENSES, CARDS, answers);
    expect(plan.stages).toEqual(COMPANY_EXPENSES.stages);
    expect(plan.answers.find((a) => a.slot === 'approval')).toEqual({
      slot: 'approval',
      question: 'What happens after someone submits a claim?',
      answer: 'The owner signs off on Fridays',
      by: 'you',
    });
    expect(answerText(CARDS[2], answers.approval)).toBe('The owner signs off on Fridays');
  });
});

describe('stagePath', () => {
  it('follows the moves from where a record starts and lists the side exits apart', () => {
    expect(stagePath(COMPANY_EXPENSES.stages!)).toEqual({ main: ['Draft', 'Submitted', 'Approved', 'Paid'], also: ['Rejected'] });
  });

  it('falls back to the listed order when there are no moves to follow', () => {
    const st = { ...COMPANY_EXPENSES.stages!, moves: [] };
    expect(stagePath(st)).toEqual({ main: ['Draft', 'Submitted', 'Approved', 'Paid', 'Rejected'], also: [] });
  });
});

describe('accessRows', () => {
  const rows = accessRows(COMPANY_EXPENSES);
  const row = (what: string) => rows.find((r) => r.what === what)?.cells.map((c) => c.text);

  it('says who can see, add and change each list, one cell per kind of person', () => {
    expect(row('See claims')).toEqual(['Own only', 'All', 'All']);
    expect(row('Add claims')).toEqual(['Yes', 'No', 'No']);
    expect(row('Change claims')).toEqual(['Own only', 'No', 'No']);
  });

  it('puts lists with the same rights on one row', () => {
    expect(row('See categories and teams')).toEqual(['All', 'All', 'All']);
    expect(row('Change categories, teams and payments')).toEqual(['No', 'No', 'All']);
  });

  it('lists each move between stages, with moves made by the same people together', () => {
    expect(row('Submit')).toEqual(['Yes', 'No', 'No']);
    expect(row('Approve, Send back, Reject')).toEqual(['No', 'Yes', 'No']);
    expect(row('Mark as paid')).toEqual(['No', 'No', 'Yes']);
  });

  it('leaves out what nobody may do', () => {
    expect(rows.some((r) => r.what === 'Delete claims')).toBe(false);
    expect(rows.every((r) => r.cells.some((c) => c.tone !== 'no'))).toBe(true);
  });

  it('a one-person plan is a single column of Yes and All', () => {
    const mine = accessRows(PERSONAL_EXPENSES);
    expect(mine.map((r) => r.what)).toEqual([
      'See expenses and categories',
      'Add expenses and categories',
      'Change expenses and categories',
      'Delete expenses and categories',
    ]);
    expect(mine.every((r) => r.cells.length === 1 && r.cells[0].tone === 'yes')).toBe(true);
  });
});

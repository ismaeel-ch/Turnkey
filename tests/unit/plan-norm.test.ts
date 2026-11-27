import { describe, expect, it } from 'vitest';
import {
  COMPANY_EXPENSES,
  PERSONAL_EXPENSES,
  checkPlan,
  demoDataCard,
  leadsForPeople,
  normAsk,
  normCards,
  normPlan,
  planOk,
  teamFor,
  usualAnswers,
  type PlanAnswer,
  type PlanSpec,
} from '@/shared/plan';

const failed = (plan: PlanSpec) => checkPlan(plan).filter((c) => !c.ok);
const you = (slot: string, value: string): PlanAnswer => ({ slot, question: slot + '?', answer: value, value, by: 'you' });

describe('normPlan', () => {
  it('reads a complete plan back unchanged, apart from who gave each answer', () => {
    for (const plan of [PERSONAL_EXPENSES, COMPANY_EXPENSES]) {
      const read = normPlan(structuredClone(plan), { answers: plan.answers });
      expect(read).toEqual(plan);
      expect(normPlan(structuredClone(plan), { answers: plan.answers, repair: true })).toEqual(plan);
    }
  });

  it('reads nothing usable as an empty plan that fails the checks, without throwing', () => {
    for (const junk of [null, undefined, 'a plan', 42, [], { lists: 'many', people: { a: 1 }, stages: 'yes', permissions: [null, 3] }]) {
      const plan = normPlan(junk);
      expect(plan.v).toBe(1);
      expect(plan.lists).toEqual([]);
      expect(planOk(plan)).toBe(false);
    }
  });

  it('makes names snake_case, maps types written another way and drops the fields every list has anyway', () => {
    const plan = normPlan({
      name: 'Pet Sitting',
      summary: 'Book visits.',
      people: ['Sitter', { name: 'Pet Owner', can: 'Books visits' }],
      lists: [
        {
          name: 'Visits',
          fields: [
            { name: 'Pet Name', type: 'string' },
            { name: 'id', type: 'number' },
            { name: 'Fee', type: 'currency' },
            { name: 'Sitter', type: 'reference', ref: 'users', role: 'Sitter' },
            { name: 'Kind', type: 'enum', options: ['Drop In', 'Overnight', 'Drop In'] },
            { name: 'Done', type: 'checkbox' },
            { name: 'Mystery', type: 'hologram' },
          ],
        },
      ],
    });
    expect(plan.people.map((p) => p.id + ':' + p.name)).toEqual(['sitter:Sitter', 'pet_owner:Pet Owner']);
    const visits = plan.lists[0];
    expect(visits).toMatchObject({ name: 'visits', label: 'Visits', one: 'visit', title: 'pet_name', owner: null, settings: false });
    expect(visits.fields.map((f) => f.name + ':' + f.type)).toEqual([
      'pet_name:text',
      'fee:money',
      'sitter:user',
      'kind:select',
      'done:bool',
      'mystery:text',
    ]);
    expect(visits.fields[2]).toMatchObject({ role: 'sitter' });
    expect(visits.fields[3].options).toEqual(['drop_in', 'overnight']);
    expect(plan.audience).toBe('company');
  });

  it('reads permissions written as a map or as a list of entries', () => {
    const asMap = normPlan({ permissions: { Jobs: { Staff: { list: 'own', create: 'yes', update: 'OWN', delete: false } } } });
    const asList = normPlan({ permissions: [{ list: 'jobs', person: 'staff', see: 'own', add: true, change: 'own', remove: false }] });
    const want = { jobs: { staff: { list: 'own', create: true, update: 'own', delete: false } } };
    expect(asMap.permissions).toEqual(want);
    expect(asList.permissions).toEqual(want);
    expect(normPlan({ permissions: { jobs: { staff: { list: 'everything' } } } }).permissions.jobs.staff).toEqual({
      list: 'none',
      create: false,
      update: 'none',
      delete: false,
    });
  });

  it('keeps the stage field in step with the stages', () => {
    const raw = structuredClone(COMPANY_EXPENSES) as PlanSpec;
    raw.lists[0].fields = raw.lists[0].fields.filter((f) => f.name !== 'status');
    expect(normPlan(raw).lists[0].fields.find((f) => f.name === 'status')).toEqual({
      name: 'status',
      label: 'Stage',
      type: 'select',
      options: ['draft', 'submitted', 'approved', 'paid', 'rejected'],
    });
    const stale = structuredClone(COMPANY_EXPENSES) as PlanSpec;
    stale.lists[0].fields.find((f) => f.name === 'status')!.options = ['open', 'closed'];
    expect(failed(normPlan(stale, { answers: stale.answers }))).toEqual([]);
  });

  it('lets the owner’s answers win over what the model wrote back, and adds what the model assumed', () => {
    const raw = { ...structuredClone(COMPANY_EXPENSES), answers: undefined, demoData: true, audience: 'group' };
    const plan = normPlan(
      {
        ...raw,
        assumed: [
          { slot: 'currency', question: 'Which currencies?', answer: 'One currency' },
          { slot: 'audience', question: 'Who is this for?', answer: 'A club', value: 'group' },
          { slot: 'empty', question: 'Nothing?' },
        ],
      },
      { answers: [you('audience', 'company'), you('demo_data', 'no'), { ...you('visibility', 'sometimes') }] },
    );
    expect(plan.audience).toBe('company');
    expect(plan.demoData).toBe(false);
    expect(plan.answers.map((a) => a.slot + ':' + a.by)).toEqual(['audience:you', 'demo_data:you', 'visibility:you', 'currency:assumed']);
    // a value that is not one of the slot's options is not kept as a value
    expect(plan.answers[2].value).toBeUndefined();
  });

  it('does not repair unless asked, so the Planner hears what was wrong', () => {
    const raw = structuredClone(COMPANY_EXPENSES) as PlanSpec;
    delete raw.permissions.teams;
    expect(failed(normPlan(raw, { answers: raw.answers })).map((c) => c.label)).toEqual(['Who can see and do what']);
  });

  it('repairs on the last try: counts, permissions, names that point at nothing', () => {
    const raw = structuredClone(COMPANY_EXPENSES) as PlanSpec;
    delete raw.permissions.teams;
    raw.permissions.categories.employee = { list: 'own', create: false, update: 'own', delete: false };
    raw.people.push({ id: 'auditor', name: 'Auditor', can: 'Reads' }, { id: 'intern', name: 'Intern', can: 'Helps' });
    raw.lists[1].fields.push({ name: 'parent', label: 'Parent', type: 'ref', ref: 'folders' });
    raw.lists[1].fields.push({ name: 'kind', label: 'Kind', type: 'select', options: ['only_one'] });
    raw.lists[2].fields[1].role = 'director';
    raw.lists[3].title = 'nothing';
    raw.lists[0].fields.push(
      { name: 'extra_one', label: 'Extra one', type: 'text' },
      { name: 'extra_two', label: 'Extra two', type: 'text' },
      { name: 'extra_three', label: 'Extra three', type: 'text' },
    );
    raw.stages!.moves.push({ label: 'Audit', from: ['paid'], to: 'audited', by: ['auditor'] });
    raw.stories.push({ role: 'intern', want: 'help', so: 'I learn' });
    const plan = normPlan(raw, { answers: raw.answers, repair: true });
    expect(failed(plan)).toEqual([]);
    expect(plan.people.map((p) => p.id)).toEqual(['employee', 'manager', 'finance', 'auditor']);
    expect(plan.permissions.teams.auditor).toEqual({ list: 'all', create: false, update: 'none', delete: false });
    expect(plan.permissions.categories.employee).toMatchObject({ list: 'all', update: 'all' });
    expect(plan.lists[0].fields.length).toBe(10);
    expect(plan.lists[0].fields.map((f) => f.name)).toEqual(expect.arrayContaining(['what_for', 'employee', 'status']));
    expect(plan.lists[1].fields.find((f) => f.name === 'parent')).toEqual({ name: 'parent', label: 'Parent', type: 'text' });
    expect(plan.lists[1].fields.find((f) => f.name === 'kind')?.type).toBe('text');
    expect(plan.lists[2].fields[1].role).toBeUndefined();
    expect(plan.lists[3].title).toBe('reference');
    expect(plan.stages?.moves.map((m) => m.label)).not.toContain('Audit');
    expect(plan.stories.some((s) => s.role === 'intern')).toBe(false);
  });

  it('repairs a plan that kept stages the owner said no to', () => {
    const answers = COMPANY_EXPENSES.answers.map((a) => (a.slot === 'approval' ? { ...a, answer: 'No approval', value: 'none' } : a));
    const plan = normPlan(structuredClone(COMPANY_EXPENSES), { answers, repair: true });
    expect(plan.stages).toBeNull();
    expect(plan.lists[0].fields.some((f) => f.name === 'status')).toBe(false);
    expect(failed(plan)).toEqual([]);
  });

  it('repairs a one-person plan to full rights and one kind of person', () => {
    const raw = structuredClone(PERSONAL_EXPENSES) as PlanSpec;
    raw.people.push({ id: 'partner', name: 'Partner', can: 'Also adds' });
    raw.permissions = {};
    const plan = normPlan(raw, { answers: raw.answers, repair: true });
    expect(failed(plan)).toEqual([]);
    expect(plan.permissions.expenses).toEqual({ owner: { list: 'all', create: true, update: 'all', delete: true } });
  });
});

const CARDS = [
  {
    id: 'audience',
    title: 'Who is this for?',
    why: 'It decides sign-ins.',
    kind: 'one',
    options: [
      { id: 'just_me', label: 'Just me', desc: 'One person.', people: [{ id: 'owner', name: 'You', can: 'Everything' }], stages: [] },
      { id: 'company', label: 'A company', desc: 'Several kinds of people.' },
      { id: 'everyone', label: 'The public', desc: 'Not an option of this question.' },
    ],
    usual: ['company'],
  },
  {
    id: 'people',
    title: 'Who uses it?',
    why: 'Each kind of person gets their own rights.',
    options: [
      { id: 'employee', label: 'Employee', desc: 'Adds claims' },
      { id: 'manager', label: 'Manager', desc: 'Approves' },
      { id: 'finance', label: 'Finance', desc: 'Pays' },
      { id: 'auditor', label: 'Auditor', desc: 'Reads everything' },
    ],
    usual: ['employee', 'manager', 'finance'],
    onlyIf: { card: 'audience', anyOf: ['company', 'school'] },
  },
  {
    id: 'approval',
    title: 'What happens after a claim is added?',
    why: 'It decides the stages.',
    kind: 'one',
    options: [
      { id: 'none', label: 'Nothing', desc: 'It is just recorded.' },
      { id: 'one', label: 'A manager approves', desc: 'One step.', stages: ['Draft', 'Submitted', 'Approved', 'Rejected'] },
      { id: 'two', label: 'Manager, then Finance', desc: 'Two steps.' },
    ],
    usual: 'two',
    onlyIf: { card: 'audience', anyOf: ['company'] },
  },
  { id: 'visibility', title: 'Who sees a claim?', options: [{ id: 'own', label: 'Its owner' }, 'All'], usual: ['own'] },
  { id: 'currency', title: 'Which currencies?', options: ['One currency', 'Several'], usual: [] },
  { id: 'sixth', title: 'One too many?', options: ['Yes', 'No'] },
];

describe('normCards', () => {
  const cards = normCards(CARDS, COMPANY_EXPENSES);

  it('keeps at most five cards and ends with Turnkey’s own demo data card', () => {
    expect(cards.map((c) => c.id)).toEqual(['audience', 'people', 'approval', 'visibility', 'currency', 'demo_data']);
    expect(cards.at(-1)).toEqual(demoDataCard());
    expect(normCards(null, COMPANY_EXPENSES).map((c) => c.id)).toEqual(['demo_data']);
    expect(normCards([{ id: 'demo_data', title: 'Demo?', options: ['a', 'b'] }], COMPANY_EXPENSES)).toEqual([demoDataCard()]);
  });

  it('keeps only the fixed options of a fixed question, and only conditions that can be met', () => {
    expect(cards[0].options.map((o) => o.id)).toEqual(['just_me', 'company']);
    expect(cards[1]).toMatchObject({
      kind: 'many',
      usual: ['employee', 'manager', 'finance'],
      onlyIf: { card: 'audience', anyOf: ['company'] },
    });
    expect(cards[2].usual).toEqual(['two']);
    expect(cards[3].options).toEqual([
      expect.objectContaining({ id: 'own', label: 'Its owner' }),
      expect.objectContaining({ id: 'all', label: 'All' }),
    ]);
    expect(cards[4]).toMatchObject({ kind: 'one', usual: ['one_currency'] });
    // nobody who answered "Just me" is asked who else sees what; a card of the Planner's own is asked of everyone
    expect(cards[3].onlyIf).toEqual({ card: 'audience', anyOf: ['company'] });
    expect(cards[4].onlyIf).toBeUndefined();
  });

  it('drops a card with fewer than two usable options, no question, or a condition on a card that is not there', () => {
    const odd = normCards(
      [
        { id: 'audience', title: 'Who?', options: ['just_me', 'nobody'] },
        { id: 'approval', options: ['none', 'one'] },
        { id: 'pets', title: 'Which pets?', options: ['Cats', 'Dogs'], onlyIf: { card: 'audience', anyOf: ['company'] } },
        { id: 'pets', title: 'Which pets?', options: ['Cats', 'Dogs'] },
      ],
      COMPANY_EXPENSES,
    );
    expect(odd.map((c) => c.id)).toEqual(['pets', 'demo_data']);
  });

  it('works out what each option leads to', () => {
    const lead = (card: number, option: string) => cards[card].options.find((o) => o.id === option)?.leads;
    const solo = lead(0, 'just_me');
    expect(solo).toMatchObject({ audience: 'just_me', people: [{ id: 'owner' }], stages: null });
    expect(solo?.lists?.[0].fields.some((f) => f.name === 'status')).toBe(false);
    expect(Object.keys(solo?.permissions?.claims || {})).toEqual(['owner']);
    expect(lead(0, 'company')).toEqual({ audience: 'company' });

    const one = lead(2, 'one');
    expect(one?.stages?.stages.map((s) => s.id)).toEqual(['draft', 'submitted', 'approved', 'rejected']);
    // a move the draft already has keeps its words and who does it
    expect(one?.stages?.moves[0]).toEqual({ label: 'Submit', from: ['draft'], to: 'submitted', by: ['employee'] });
    expect(one?.lists?.[0].fields.find((f) => f.name === 'status')?.options).toEqual(['draft', 'submitted', 'approved', 'rejected']);
    expect(lead(2, 'none')).toMatchObject({ stages: null });
    expect(lead(2, 'two')).toBeUndefined();

    expect(lead(3, 'all')?.permissions?.claims.employee).toMatchObject({ list: 'all' });
    expect(lead(3, 'own')?.permissions?.claims.employee).toMatchObject({ list: 'own', update: 'own' });
    expect(lead(3, 'own')?.permissions?.claims.manager.list).toBe('all');
    // leads never change the draft they were worked out from
    expect(COMPANY_EXPENSES.lists[0].fields.some((f) => f.name === 'status')).toBe(true);
  });

  it('gives every preview a plan the team can be picked from', () => {
    for (const card of cards)
      for (const option of card.options) {
        const preview = { ...COMPANY_EXPENSES, ...option.leads };
        expect(teamFor(preview).steps.length, card.id + '/' + option.id).toBe(7);
        for (const l of preview.lists)
          for (const p of preview.people) expect(preview.permissions[l.name][p.id], l.name + '/' + p.id).toBeTruthy();
      }
  });
});

describe('leadsForPeople', () => {
  it('gives the ticked kinds of people rights on every list and a place on every move', () => {
    const patch = leadsForPeople(COMPANY_EXPENSES, [
      { id: 'employee', name: 'Employee', can: '' },
      { id: 'finance', name: 'Finance', can: '' },
      { id: 'auditor', name: 'Auditor', can: 'Reads everything' },
    ]);
    expect(patch.people?.map((p) => p.id)).toEqual(['employee', 'finance', 'auditor']);
    // the draft's own words for a person it already has
    expect(patch.people?.[0].can).toBe('Adds claims and sees only their own');
    expect(patch.permissions?.claims.employee).toEqual(COMPANY_EXPENSES.permissions.claims.employee);
    expect(Object.keys(patch.permissions?.payments || {})).toEqual(['employee', 'finance', 'auditor']);
    // the manager is gone, so the moves only they could make are open to everyone who is left
    expect(patch.stages?.moves.find((m) => m.label === 'Approve')?.by).toEqual(['employee', 'finance', 'auditor']);
    expect(patch.stages?.moves.find((m) => m.label === 'Mark as paid')?.by).toEqual(['finance']);
    expect(leadsForPeople(COMPANY_EXPENSES, [])).toEqual({});
    expect(
      leadsForPeople(
        COMPANY_EXPENSES,
        Array.from({ length: 6 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, can: '' })),
      ).people?.length,
    ).toBe(4);
  });
});

describe('usualAnswers', () => {
  const cards = normCards(CARDS, COMPANY_EXPENSES);

  it('answers every card with its usual choice', () => {
    expect(usualAnswers(cards).map((a) => a.slot + '=' + (a.value ?? a.answer))).toEqual([
      'audience=company',
      'people=Employee, Manager, Finance',
      'approval=two',
      'visibility=own',
      'currency=one_currency',
      'demo_data=yes',
    ]);
    expect(usualAnswers(cards).every((a) => a.by === 'assumed')).toBe(true);
  });

  it('keeps the owner’s answers and leaves out the cards they do not lead to', () => {
    const got = usualAnswers(cards, [you('audience', 'just_me'), you('demo_data', 'no'), you('approval', 'one')]);
    expect(got.map((a) => a.slot + '=' + (a.value ?? a.answer) + ' ' + a.by)).toEqual([
      'audience=just_me you',
      'currency=one_currency assumed',
      'demo_data=no you',
    ]);
  });
});

describe('normAsk', () => {
  it('reads the sentence, the cards and a draft that carries the usual answers', () => {
    const ask = normAsk({ reflect: ' Got it: expenses. ', cards: CARDS, draft: { ...COMPANY_EXPENSES, answers: undefined } });
    expect(ask.reflect).toBe('Got it: expenses.');
    expect(ask.cards.length).toBe(6);
    expect(ask.draft.answers.map((a) => a.slot)).toEqual(['audience', 'people', 'approval', 'visibility', 'currency', 'demo_data']);
    expect(failed(ask.draft)).toEqual([]);
  });

  it('shows where a draft disagrees with its own cards', () => {
    const ask = normAsk({ cards: CARDS, draft: { ...PERSONAL_EXPENSES, answers: undefined } });
    expect(failed(ask.draft).map((c) => c.label)).toEqual(['The plan agrees with the answers']);
    expect(normAsk(null).cards).toEqual([demoDataCard()]);
  });
});

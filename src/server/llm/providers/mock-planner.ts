/**
 * Saved answers for the Planner's two prompts (src/workspace/planner.ts), so the guided start of a build runs with no
 * key: `LLM_PROVIDER=mock`. Like the other stand-in answers they are worked out from what the prompt itself says:
 * the request, and for the final plan the owner's answers. A request about expenses gets the two worked plans of
 * src/shared/plan/examples.ts; anything else gets a plain plan with the same shape.
 */
import { COMPANY_EXPENSES, PERSONAL_EXPENSES } from '@/shared/plan/examples';
import type { PlanAnswer, PlanList, PlanSpec, PlanStages } from '@/shared/plan/types';
import type { Permission } from '@/shared/types/app';

type Answers = { audience: string; approval: string; visibility: string; demo: boolean };

const ALL: Permission = { list: 'all', create: true, update: 'all', delete: true };
const LOOK: Permission = { list: 'all', create: false, update: 'none', delete: false };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const snake = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
const SKIP = new Set(
  'a an the and or for to of in on with that this my our their i we want need wants needs app application system tool build make create track manage management tracker small simple new keep'.split(
    ' ',
  ),
);

export const requestOf = (prompt: string) => /REQUEST: "(.*?)"\n\n/.exec(prompt)?.[1] || 'A small record-keeping app';

function answersIn(prompt: string): PlanAnswer[] {
  const line = /\n\nANSWERS: (.*)/.exec(prompt)?.[1];
  if (!line) return [];
  try {
    const list: unknown = JSON.parse(line);
    return Array.isArray(list) ? (list as PlanAnswer[]) : [];
  } catch {
    return [];
  }
}

const isExpenses = (request: string) => /expense|spend|claim|reimburs/i.test(request);

/** The choices a plan is written for: the owner's, and the usual ones for whatever was not asked or answered. */
function choices(answers: PlanAnswer[], request: string): Answers {
  const expenses = isExpenses(request);
  const value = (slot: string) => answers.find((a) => a && a.slot === slot)?.value;
  const audience = value('audience') || (/\b(my own|myself|personal|just me)\b/i.test(request) ? 'just_me' : 'company');
  const solo = audience === 'just_me';
  return {
    audience,
    approval: value('approval') || (solo ? 'none' : expenses ? 'two' : 'one'),
    visibility: value('visibility') || (expenses && !solo ? 'own' : 'all'),
    demo: value('demo_data') !== 'no',
  };
}

/* ---------- a request about expenses: the two worked plans, bent to the answers ---------- */
function expensePlan(a: Answers): PlanSpec {
  const solo = a.audience === 'just_me';
  const plan = structuredClone(solo ? PERSONAL_EXPENSES : COMPANY_EXPENSES);
  if (solo && a.approval !== 'none') {
    const expenses = plan.lists[0];
    expenses.fields.push({ name: 'status', label: 'Stage', type: 'select', options: ['to_pay', 'paid', 'claimed_back'] });
    plan.stages = {
      list: expenses.name,
      field: 'status',
      stages: [
        { id: 'to_pay', label: 'To pay' },
        { id: 'paid', label: 'Paid' },
        { id: 'claimed_back', label: 'Claimed back' },
      ],
      moves: [
        { label: 'Mark as paid', from: ['to_pay'], to: 'paid', by: ['owner'] },
        { label: 'Mark as claimed back', from: ['paid'], to: 'claimed_back', by: ['owner'] },
      ],
      note: 'You pay it, then mark it once you have claimed it back.',
    };
  }
  if (!solo && a.approval === 'none' && plan.stages) {
    const { list, field } = plan.stages;
    for (const l of plan.lists) if (l.name === list) l.fields = l.fields.filter((f) => f.name !== field && f.name !== 'sent_back_reason');
    plan.stages = null;
    plan.rules = plan.rules.map((r) => r.replace(' and are the only ones who approve', ''));
    plan.stories = plan.stories.filter((s) => !/approve|sent back/.test(s.want));
  }
  if (!solo && a.approval === 'one' && plan.stages) {
    // one approval: Finance still records the payment, but a claim ends at Approved
    plan.stages.stages = plan.stages.stages.filter((s) => s.id !== 'paid');
    plan.stages.moves = plan.stages.moves.filter((m) => m.to !== 'paid');
    plan.stages.note = 'The Employee submits. The Manager approves, sends it back to Draft with a reason, or rejects it.';
    for (const l of plan.lists) for (const f of l.fields) if (f.name === 'status') f.options = plan.stages.stages.map((s) => s.id);
  }
  if (!solo && a.visibility === 'all') {
    plan.permissions.claims.employee = { list: 'all', create: true, update: 'own', delete: false };
    plan.rules[0] = 'Employees see every claim and change only their own.';
  }
  if (!solo) plan.audience = a.audience === 'group' ? 'group' : 'company';
  plan.demoData = a.demo;
  return plan;
}

/* ---------- any other request: a plain plan ---------- */
function plainPlan(request: string, a: Answers): PlanSpec {
  const words = [
    ...new Set(
      request
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !SKIP.has(w)),
    ),
  ];
  const noun = snake(words[1] || words[0] || 'record');
  const main = /s$/.test(noun) ? noun : noun + 's';
  const mainName = main === 'contacts' ? 'items' : main;
  const one = mainName.replace(/s$/, '');
  const solo = a.audience === 'just_me';
  const people = solo
    ? [{ id: 'owner', name: 'You', can: 'Add and change everything' }]
    : [
        { id: 'manager', name: 'Manager', can: 'Sees everything and assigns the work' },
        { id: 'staff', name: 'Staff', can: 'Does the work and moves it forward' },
      ];
  const everyone = people.map((p) => p.id);
  const stageIds =
    a.approval === 'none' ? [] : a.approval === 'two' ? ['new', 'in_progress', 'checked', 'done'] : ['new', 'in_progress', 'done'];
  const stages: PlanStages | null = stageIds.length
    ? {
        list: mainName,
        field: 'status',
        stages: stageIds.map((id) => ({ id, label: cap(id.replace(/_/g, ' ')) })),
        moves: stageIds.slice(1).map((id, i) => ({
          label: 'Move to ' + id.replace(/_/g, ' '),
          from: [stageIds[i]],
          to: id,
          by: id === 'checked' && !solo ? ['manager'] : everyone,
        })),
        note: solo ? 'You move a record forward as the work gets done.' : 'Staff move records forward. The Manager can move any.',
      }
    : null;
  const lists: PlanList[] = [
    {
      name: mainName,
      label: cap(mainName.replace(/_/g, ' ')),
      one: one.replace(/_/g, ' '),
      what: 'The work being tracked',
      title: 'name',
      owner: solo ? null : 'assignee',
      settings: false,
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'contact', label: 'Contact', type: 'ref', ref: 'contacts' },
        ...(solo ? [] : [{ name: 'assignee', label: 'Assigned to', type: 'user' as const, role: 'staff' }]),
        ...(stages ? [{ name: 'status', label: 'Stage', type: 'select' as const, options: stageIds }] : []),
        { name: 'due_on', label: 'Due on', type: 'date' },
        { name: 'notes', label: 'Notes', type: 'longtext' },
      ],
    },
    {
      name: 'contacts',
      label: 'Contacts',
      one: 'contact',
      what: 'People and organisations involved',
      title: 'name',
      owner: null,
      settings: false,
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'email', label: 'Email', type: 'text' },
        { name: 'phone', label: 'Phone', type: 'text' },
      ],
    },
  ];
  const own = a.visibility === 'own' && !solo;
  return {
    v: 1,
    name: (cap(words[0] || 'Records') + ' ' + (words[1] ? cap(words[1]) : 'Tracker')).slice(0, 40),
    summary: request.replace(/\s+/g, ' ').slice(0, 140).replace(/\.?$/, '.'),
    audience: solo ? 'just_me' : a.audience === 'group' ? 'group' : 'company',
    people,
    lists,
    stages,
    permissions: solo
      ? { [mainName]: { owner: ALL }, contacts: { owner: ALL } }
      : {
          [mainName]: { manager: ALL, staff: { list: own ? 'own' : 'all', create: true, update: own ? 'own' : 'all', delete: false } },
          contacts: { manager: ALL, staff: LOOK },
        },
    rules: solo
      ? ['Only you use the app. You add, change and delete everything.']
      : [
          own ? 'Staff see and change only the records given to them.' : 'Staff see every record and cannot delete one.',
          'Only the Manager changes contacts.',
        ],
    stories: solo
      ? [
          { role: 'owner', want: 'add a record in a few seconds', so: 'nothing is forgotten' },
          { role: 'owner', want: 'see what is due soon', so: 'I can plan the week' },
          { role: 'owner', want: 'find a contact quickly', so: 'I do not have to search my messages' },
        ]
      : [
          { role: 'manager', want: 'add a record and give it to someone', so: 'nothing is forgotten' },
          { role: 'staff', want: 'see my records and move them forward', so: 'the manager sees progress' },
          { role: 'manager', want: 'see how many records are at each stage', so: 'I can plan the week' },
        ],
    demoData: a.demo,
    overview: true,
    helpers: null,
    answers: [],
    notInThisVersion: [],
  };
}

const planFor = (request: string, a: Answers) => (isExpenses(request) ? expensePlan(a) : plainPlan(request, a));
/** A plan as the Planner is asked to write it: no version, no answers. */
const written = (plan: PlanSpec) => ({ ...plan, v: undefined, answers: undefined, assumed: [] });

/** The Planner's second answer: the plan for the answers the prompt lists. */
export function plannerPlan(prompt: string) {
  const request = requestOf(prompt);
  return written(planFor(request, choices(answersIn(prompt), request)));
}

/** The Planner's first answer: the cards, and the plan for their usual choices. */
export function plannerQuestions(prompt: string) {
  const request = requestOf(prompt);
  const usual = choices([], request);
  const draft = planFor(request, usual);
  const solo = planFor(request, choices([{ slot: 'audience', question: '', answer: '', value: 'just_me', by: 'you' }], request));
  const stagesFor = (approval: string) => planFor(request, { ...usual, approval }).stages?.stages.map((s) => s.label) || [];
  const several = { card: 'audience', anyOf: ['group', 'company'] };
  const thing = draft.lists[0].one;
  return {
    reflect: 'Got it: ' + draft.summary.charAt(0).toLowerCase() + draft.summary.slice(1),
    cards: [
      {
        id: 'audience',
        title: 'Who is this for?',
        why: 'It decides whether the app needs sign-ins and rules about who sees what.',
        kind: 'one',
        options: [
          { id: 'just_me', label: 'Just me', desc: 'One person, no sign-ins and no approvals.', people: solo.people, stages: [] },
          { id: 'group', label: 'A household or small group', desc: 'A few people who trust each other.', people: draft.people },
          { id: 'company', label: 'A company or team', desc: 'Different kinds of people with different rights.', people: draft.people },
        ],
        usual: [usual.audience],
      },
      {
        id: 'approval',
        title: 'What happens after someone adds a ' + thing + '?',
        why: 'It decides the stages a ' + thing + ' goes through and who moves it on.',
        kind: 'one',
        options: [
          { id: 'none', label: 'Nothing, it is just recorded', desc: 'No stages and no approval.', stages: [] },
          { id: 'one', label: 'One person approves it', desc: 'A ' + thing + ' waits until it is approved.', stages: stagesFor('one') },
          {
            id: 'two',
            label: 'It is approved, then finished by someone else',
            desc: 'Two steps by two kinds of people.',
            stages: stagesFor('two'),
          },
        ],
        usual: [usual.approval],
        onlyIf: several,
      },
      {
        id: 'visibility',
        title: 'Who can see a ' + thing + '?',
        why: 'It decides whether people see only their own records.',
        kind: 'one',
        options: [
          { id: 'own', label: 'Only the person it belongs to', desc: 'And the people who manage them.' },
          { id: 'all', label: 'Everyone who signs in', desc: 'All records are open to the whole team.' },
        ],
        usual: [usual.visibility],
        onlyIf: several,
      },
    ],
    draft: written(draft),
  };
}

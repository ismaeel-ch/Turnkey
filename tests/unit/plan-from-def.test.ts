import { describe, expect, it } from 'vitest';
import { checkPlan, planFromDef, teamFor } from '@/shared/plan';
import type { AppDef } from '@/shared/types/app';

/** A small finished app as the build line leaves it. Made-up data. */
const DEF = {
  brief: {
    name: 'Bike Repairs',
    summary: 'Take in bikes, repair them and hand them back.',
    roles: [
      { id: 'mechanic', name: 'Mechanic', can: 'Repairs bikes' },
      { id: 'front_desk', name: 'Front desk', can: 'Takes bikes in and hands them back' },
    ],
    entities: [
      { name: 'customers', what: 'People who bring a bike' },
      { name: 'repairs', what: 'One repair job' },
    ],
    process: { entity: 'repairs', states: ['booked', 'in_repair', 'ready'], note: 'The mechanic moves a repair forward.' },
    stories: [{ role: 'mechanic', want: 'see my repairs', so: 'I know what to do next' }],
    rules: ['Mechanics see only their own repairs.'],
    question: null,
    decision: { text: 'Take deposits?', answer: 'No' },
    sources: [],
  },
  tables: [
    {
      name: 'customers',
      label: 'Customers',
      one: 'Customer',
      title: 'name',
      owner: null,
      columns: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'phone', type: 'text' },
      ],
    },
    {
      name: 'repairs',
      label: 'Repairs',
      one: 'Repair',
      title: 'bike',
      owner: 'mechanic',
      columns: [
        { name: 'id', type: 'number' },
        { name: 'bike', label: 'Bike', type: 'text', required: true },
        { name: 'customer_id', label: 'Customer', type: 'ref', ref: 'customers', required: true },
        { name: 'mechanic', label: 'Mechanic', type: 'user', role: 'mechanic' },
        { name: 'price', label: 'Price', type: 'money' },
        {
          name: 'status',
          label: 'Status',
          type: 'select',
          options: ['booked', 'in_repair', 'ready'],
          required: true,
          by: 'backend',
          run: 2,
        },
      ],
    },
  ],
  users: [],
  process: {
    table: 'repairs',
    column: 'status',
    states: [
      { id: 'booked', label: 'Booked', tone: 'info' },
      { id: 'in_repair', label: 'In repair', tone: 'warning' },
      { id: 'ready', label: 'Ready', tone: 'success' },
    ],
    initial: 'booked',
    transitions: [
      { id: 'start', label: 'Start repair', from: ['booked'], to: 'in_repair', roles: ['mechanic'], set: {} },
      { id: 'finish', label: 'Mark as ready', from: ['in_repair'], to: 'ready', roles: ['mechanic', 'owner_gone'], set: {} },
    ],
  },
  access: {
    customers: {
      mechanic: { list: 'all', create: false, update: 'none', delete: false },
      front_desk: { list: 'all', create: true, update: 'all', delete: true },
    },
    repairs: { mechanic: { list: 'own', create: false, update: 'own', delete: false } },
  },
  team: null,
  views: {},
  dash: { title: 'Overview', date: null, widgets: [] },
  screens: [],
  theme: { accent: '#0f6cbd', nav: 'side', icon: 'wrench' },
  tour: [],
  actions: [],
  migrations: [],
} satisfies AppDef;

describe('planFromDef', () => {
  it('reads the plan of a finished app off its definition, and that plan passes every check', () => {
    const plan = planFromDef(DEF);
    expect(plan).not.toBeNull();
    expect(checkPlan(plan!).filter((c) => !c.ok)).toEqual([]);
    expect(plan).toMatchObject({ v: 1, name: 'Bike Repairs', audience: 'company', demoData: true, overview: true, helpers: null });
    expect(plan!.people.map((p) => p.id)).toEqual(['mechanic', 'front_desk']);
    expect(plan!.lists.map((l) => l.name + ':' + l.one + ':' + l.fields.length)).toEqual(['customers:customer:2', 'repairs:repair:5']);
    expect(plan!.lists[0]).toMatchObject({ what: 'People who bring a bike', settings: false });
    expect(plan!.lists[0].fields[1]).toEqual({ name: 'phone', label: 'Phone', type: 'text' });
    // a field carries nothing about which change run added it
    expect(plan!.lists[1].fields.at(-1)).toEqual({
      name: 'status',
      label: 'Status',
      type: 'select',
      required: true,
      options: ['booked', 'in_repair', 'ready'],
    });
    expect(plan!.stages).toMatchObject({ list: 'repairs', field: 'status', note: 'The mechanic moves a repair forward.' });
    expect(plan!.stages!.moves[1]).toEqual({ label: 'Mark as ready', from: ['in_repair'], to: 'ready', by: ['mechanic'] });
    expect(plan!.answers).toEqual([{ slot: 'decision', question: 'Take deposits?', answer: 'No', by: 'you' }]);
  });

  it('gives a person with no rule on a list no rights there', () => {
    expect(planFromDef(DEF)!.permissions.repairs.front_desk).toEqual({ list: 'none', create: false, update: 'none', delete: false });
  });

  it('lets the team be picked for an app that was built without a plan', () => {
    const team = teamFor(planFromDef(DEF)!);
    expect(team.steps.map((s) => s.by)).toEqual(['agent', 'agent', 'agent', 'agent', 'agent', 'code', 'agent']);
    expect(team.reviews.map((r) => r.id)).toEqual(['security']);
  });

  it('reads an app with no stages and one kind of person', () => {
    const solo = planFromDef({ ...DEF, process: null, brief: { ...DEF.brief, roles: [DEF.brief.roles[0]] }, dash: null });
    expect(solo).toMatchObject({ audience: 'just_me', stages: null, overview: false });
    expect(Object.keys(solo!.permissions.customers)).toEqual(['mechanic']);
  });

  it('is null until the app has a brief and lists', () => {
    expect(planFromDef(null)).toBeNull();
    expect(planFromDef(undefined)).toBeNull();
    expect(planFromDef({ ...DEF, brief: null })).toBeNull();
    expect(planFromDef({ ...DEF, tables: [] })).toBeNull();
  });
});

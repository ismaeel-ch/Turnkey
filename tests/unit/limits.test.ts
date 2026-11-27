import { describe, expect, it } from 'vitest';
import { limitsOf, planLimit, swapNumber } from '@/workspace/limits';
import type { AppDef } from '@/shared/types/app';
import type { PlanSpec } from '@/shared/plan/types';

/* A made-up order desk: small orders are approved by the manager, large ones go to the director. */
const def = (): AppDef =>
  ({
    brief: null,
    tables: [
      {
        name: 'orders',
        label: 'Orders',
        one: 'Order',
        title: 'title',
        owner: null,
        columns: [
          { name: 'title', label: 'Title', type: 'text' },
          { name: 'total', label: 'Total', type: 'money' },
          { name: 'hours', label: 'Hours', type: 'number' },
          { name: 'budget', label: 'Budget', type: 'money' },
          { name: 'spent', label: 'Spent', type: 'money' },
          { name: 'health', label: 'Health', type: 'text', formula: "if(spent >= budget * 0.8, 'nearly_spent', 'on_track')" },
          { name: 'status', label: 'Status', type: 'select', options: ['draft', 'approved'] },
        ],
      },
    ],
    users: [],
    process: {
      table: 'orders',
      column: 'status',
      initial: 'draft',
      states: [
        { id: 'draft', label: 'Draft', tone: 'neutral' },
        { id: 'approved', label: 'Approved', tone: 'success' },
      ],
      transitions: [
        {
          id: 'approve',
          label: 'Approve',
          from: ['draft'],
          to: 'approved',
          roles: ['manager'],
          set: {},
          when: 'total <= 5000',
          unless: 'Orders over 5,000 need the director.',
        },
        {
          id: 'approve_large',
          label: 'Approve large order',
          from: ['draft'],
          to: 'approved',
          roles: ['director'],
          set: {},
          when: 'total > 5000',
          unless: 'Orders up to 5,000 are approved by the manager.',
        },
      ],
    },
    logic: {
      rules: [
        { id: 'qty', table: 'orders', when: 'total > 0', message: 'An order must be more than zero.' },
        { id: 'hours', table: 'orders', when: 'hours > 0 and hours <= 12', message: 'One entry is more than zero and at most 12 hours.' },
      ],
    },
    access: {},
    team: null,
    views: {},
    dash: null,
    screens: [],
    theme: { accent: 'blue', nav: 'side', icon: 'cart' },
    tour: [],
    actions: [],
    migrations: [],
  }) as AppDef;

describe("the limits in an app's rules", () => {
  it('finds each number a field is compared with, and each share, but never a comparison with zero', () => {
    const L = limitsOf(def());
    expect(L.map((x) => [x.label, x.value, x.percent, x.money, x.uses.map((u) => u.kind + ':' + u.id).join()])).toEqual([
      ['Total', 5000, false, true, 'move:approve,move:approve_large'],
      ['Hours', 12, false, false, 'rule:hours'],
      ['Budget', 80, true, false, 'calc:health'],
    ]);
    expect(L[0].uses[0].says).toBe('"Approve" is offered when total is at most 5,000');
    expect(L[1].uses[0].says).toBe('One entry is more than zero and at most 12 hours.');
  });

  it('a new number goes into every formula that shares the limit, the sentences beside them and the plan', () => {
    const d = def(),
      plan = {
        lists: [{ name: 'orders', fields: [{ name: 'health', formula: "if(spent >= budget * 0.8, 'nearly_spent', 'on_track')" }] }],
        stages: {
          moves: [
            { label: 'Approve', when: 'total <= 5000', unless: 'Orders over 5,000 need the director.' },
            { label: 'Send', when: undefined },
          ],
        },
        checks: [{ list: 'orders', when: 'hours > 0 and hours <= 12', message: 'One entry is more than zero and at most 12 hours.' }],
      } as unknown as PlanSpec,
      app = { def: d, plan };
    const c = planLimit(app, limitsOf(d)[0].key, 7500);
    expect([c.why, c.recalc]).toEqual(['', false]);
    c.apply();
    const [a, b] = d.process!.transitions;
    expect([a.when, a.unless, b.when, b.unless]).toEqual([
      'total <= 7500',
      'Orders over 7,500 need the director.',
      'total > 7500',
      'Orders up to 7,500 are approved by the manager.',
    ]);
    expect(plan.stages!.moves[0]).toMatchObject({ when: 'total <= 7500', unless: 'Orders over 7,500 need the director.' });
    expect(limitsOf(d)[0]).toMatchObject({ value: 7500, label: 'Total' });

    // only the 12 changes: the zero in the same rule is not a limit
    planLimit(app, limitsOf(d)[1].key, 10).apply();
    expect(d.logic!.rules[1]).toMatchObject({
      when: 'hours > 0 and hours <= 10',
      message: 'One entry is more than zero and at most 10 hours.',
    });
    expect(plan.checks![0]).toMatchObject({
      when: 'hours > 0 and hours <= 10',
      message: 'One entry is more than zero and at most 10 hours.',
    });

    // a share is typed as a percentage and written as a fraction; the records must be worked out again
    const s = planLimit(app, limitsOf(d)[2].key, 75);
    expect(s.recalc).toBe(true);
    s.apply();
    expect(d.tables[0].columns[5].formula).toBe("if(spent >= budget * 0.75, 'nearly_spent', 'on_track')");
    expect(plan.lists[0].fields[0].formula).toBe("if(spent >= budget * 0.75, 'nearly_spent', 'on_track')");
  });

  it('refuses a number that is not a limit, and changes nothing', () => {
    const d = def(),
      app = { def: d, plan: null },
      [total, , share] = limitsOf(d);
    expect(planLimit(app, total.key, 0).why).toBe('A limit is a number above zero.');
    expect(planLimit(app, total.key, NaN).why).toBe('A limit is a number above zero.');
    expect(planLimit(app, share.key, 100).why).toBe('A share is between 1 and 99 percent.');
    expect(planLimit(app, 'gone', 5).why).toBe('That limit is no longer in the app.');
    expect(planLimit(app, total.key, 5000)).toMatchObject({ why: '', recalc: false });
    expect(d.process!.transitions[0].when).toBe('total <= 5000');
  });

  it('rewrites the number in a sentence however it was written, and leaves other numbers alone', () => {
    expect(swapNumber('Orders over 5,000 need the director.', 5000, 12000, false)).toBe('Orders over 12,000 need the director.');
    expect(swapNumber('Over 5000? Not 15000, not 5000.50.', 5000, 6000, false)).toBe('Over 6,000? Not 15000, not 5000.50.');
    expect(swapNumber('Warn at 80% of the 80 seats.', 80, 75, true)).toBe('Warn at 75% of the 80 seats.');
    expect(swapNumber('', 1, 2, false)).toBe('');
  });
});

import { describe, expect, it } from 'vitest';
import {
  AGENT_NAMES,
  COMPANY_EXPENSES,
  PERSONAL_EXPENSES,
  PLAN_STEPS,
  planFacts,
  teamFor,
  wantsDemoData,
  type PlanSpec,
} from '@/shared/plan';

const copy = (plan: PlanSpec): PlanSpec => structuredClone(plan);
const who = (plan: PlanSpec) => teamFor(plan).steps.map((s) => s.id + ':' + (s.agent ?? 'code'));

describe('teamFor', () => {
  it('always lists every step of the build line, in order', () => {
    for (const plan of [PERSONAL_EXPENSES, COMPANY_EXPENSES]) expect(teamFor(plan).steps.map((s) => s.id)).toEqual([...PLAN_STEPS]);
  });

  it('gives a personal tracker five agents: no rules builder, no access check, no pause', () => {
    const team = teamFor(PERSONAL_EXPENSES);
    expect(who(PERSONAL_EXPENSES)).toEqual([
      'research:researcher',
      'database:database',
      'backend:code',
      'views:views',
      'screens:ui',
      'walkthrough:code',
      'tests:tester',
    ]);
    expect(team.reviews).toEqual([]);
    expect(team.pauses).toEqual([]);
    expect(team.agents).toBe(5);
    expect(team.notNeeded.map((n) => n.who)).toEqual(['Rules builder', 'Access checker', 'List checker']);
  });

  it('gives a company app seven agents and a pause after the rules', () => {
    const team = teamFor(COMPANY_EXPENSES);
    expect(who(COMPANY_EXPENSES)).toEqual([
      'research:researcher',
      'database:database',
      'backend:backend',
      'views:views',
      'screens:ui',
      'walkthrough:code',
      'tests:tester',
    ]);
    expect(team.reviews.map((r) => r.id + '>' + r.after)).toEqual(['security>backend']);
    expect(team.pauses.map((p) => p.after)).toEqual(['backend']);
    expect(team.agents).toBe(7);
    expect(team.notNeeded.map((n) => n.agent)).toEqual(['data']);
  });

  it('never picks more than eight agents', () => {
    const big = copy(COMPANY_EXPENSES);
    for (const name of ['projects', 'vendors']) {
      big.lists.push({
        name,
        label: name,
        one: name,
        what: name,
        title: 'name',
        owner: null,
        settings: false,
        fields: [
          { name: 'name', label: 'Name', type: 'text' },
          { name: 'note', label: 'Note', type: 'longtext' },
        ],
      });
    }
    const team = teamFor(big);
    expect(team.reviews.map((r) => r.id)).toEqual(['security', 'data']);
    expect(team.agents).toBe(8);
    expect(team.notNeeded).toEqual([]);
  });

  it('lets code choose the views when there is nothing to chart and no overview', () => {
    const plain = copy(PERSONAL_EXPENSES);
    plain.overview = false;
    plain.lists = [
      {
        ...plain.lists[1],
        fields: [
          { name: 'name', label: 'Name', type: 'text' },
          { name: 'note', label: 'Note', type: 'longtext' },
        ],
      },
    ];
    plain.permissions = { categories: plain.permissions.categories };
    const team = teamFor(plain);
    expect(team.steps.find((s) => s.id === 'views')?.by).toBe('code');
    expect(team.agents).toBe(4);
  });

  it('adds the rules builder for stages even with one kind of person', () => {
    const plan = copy(PERSONAL_EXPENSES);
    plan.lists[0].fields.push({ name: 'status', label: 'Stage', type: 'select', options: ['to_pay', 'paid', 'claimed_back'] });
    plan.stages = {
      list: 'expenses',
      field: 'status',
      stages: [
        { id: 'to_pay', label: 'To pay' },
        { id: 'paid', label: 'Paid' },
        { id: 'claimed_back', label: 'Claimed back' },
      ],
      moves: [
        { label: 'Pay', from: ['to_pay'], to: 'paid', by: ['owner'] },
        { label: 'Claim back', from: ['paid'], to: 'claimed_back', by: ['owner'] },
      ],
      note: 'You pay it, then claim it back.',
    };
    const team = teamFor(plan);
    expect(team.steps.find((s) => s.id === 'backend')?.agent).toBe('backend');
    expect(team.reviews).toEqual([]);
  });

  it('says in plain words whether demo data is added', () => {
    const empty = copy(COMPANY_EXPENSES);
    empty.demoData = false;
    expect(teamFor(COMPANY_EXPENSES).steps[1].why).toContain('adds the demo data');
    expect(teamFor(empty).steps[1].why).toContain('starts empty');
  });

  it('names every agent it uses', () => {
    const team = teamFor(COMPANY_EXPENSES);
    for (const s of team.steps) expect(s.who).toBe(s.agent ? AGENT_NAMES[s.agent] : 'Turnkey');
    for (const r of team.reviews) expect(r.who).toBe(AGENT_NAMES[r.id]);
  });
});

describe('planFacts and wantsDemoData', () => {
  it('reads the facts the team depends on', () => {
    expect(planFacts(PERSONAL_EXPENSES)).toMatchObject({ people: 1, stages: false, money: true, numbers: true, own: false, lists: 2 });
    expect(planFacts(COMPANY_EXPENSES)).toMatchObject({
      people: 3,
      stages: true,
      money: true,
      numbers: true,
      own: true,
      lists: 4,
      fields: 20,
    });
  });

  it('treats an app with no plan as wanting demo data', () => {
    expect(wantsDemoData(null)).toBe(true);
    expect(wantsDemoData(undefined)).toBe(true);
    expect(wantsDemoData({ demoData: false })).toBe(false);
    expect(wantsDemoData({ demoData: true })).toBe(true);
  });
});

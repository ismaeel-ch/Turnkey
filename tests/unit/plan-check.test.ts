import { describe, expect, it } from 'vitest';
import { COMPANY_EXPENSES, PERSONAL_EXPENSES, PLAN_LIMITS, checkPlan, planOk, slotValue, type PlanSpec } from '@/shared/plan';

/** A deep copy of an example that a test may break in one place. */
const copy = (plan: PlanSpec): PlanSpec => structuredClone(plan);
const failed = (plan: PlanSpec) =>
  checkPlan(plan)
    .filter((c) => !c.ok)
    .map((c) => c.label);
const detail = (plan: PlanSpec, label: string) => checkPlan(plan).find((c) => c.label === label)?.detail ?? '';

describe('the worked plans', () => {
  it('pass every check', () => {
    expect(failed(PERSONAL_EXPENSES)).toEqual([]);
    expect(failed(COMPANY_EXPENSES)).toEqual([]);
    expect(planOk(PERSONAL_EXPENSES)).toBe(true);
    expect(planOk(COMPANY_EXPENSES)).toBe(true);
  });

  it('differ where the answers differ', () => {
    expect(PERSONAL_EXPENSES.people).toHaveLength(1);
    expect(PERSONAL_EXPENSES.stages).toBeNull();
    expect(COMPANY_EXPENSES.people).toHaveLength(3);
    expect(COMPANY_EXPENSES.stages?.stages).toHaveLength(5);
  });

  it('stay inside the plan limits', () => {
    for (const plan of [PERSONAL_EXPENSES, COMPANY_EXPENSES]) {
      expect(plan.lists.length).toBeLessThanOrEqual(PLAN_LIMITS.lists.max);
      for (const list of plan.lists) expect(list.fields.length).toBeLessThanOrEqual(PLAN_LIMITS.fields.max);
    }
  });

  it('read back the option picked for a slot', () => {
    expect(slotValue(COMPANY_EXPENSES, 'approval')).toBe('two');
    expect(slotValue(COMPANY_EXPENSES, 'people')).toBeNull();
    expect(slotValue(COMPANY_EXPENSES, 'missing')).toBeNull();
  });
});

describe('checkPlan refuses', () => {
  it('a plan with no name or an unknown audience', () => {
    const plan = copy(PERSONAL_EXPENSES);
    plan.name = ' ';
    (plan as { audience: string }).audience = 'everyone';
    expect(failed(plan)).toContain('The plan says what the app is and who it is for');
  });

  it('five kinds of people', () => {
    const plan = copy(COMPANY_EXPENSES);
    for (const id of ['admin', 'auditor']) {
      plan.people.push({ id, name: id, can: 'Looks at everything' });
      for (const list of plan.lists) plan.permissions[list.name][id] = { list: 'all', create: false, update: 'none', delete: false };
    }
    expect(failed(plan)).toEqual(['Kinds of people']);
    expect(detail(plan, 'Kinds of people')).toContain('5 kinds of people');
  });

  it('a list with one field, a missing title or a reserved name', () => {
    const one = copy(PERSONAL_EXPENSES);
    one.lists[1].fields = one.lists[1].fields.slice(0, 1);
    expect(detail(one, 'Lists and fields')).toContain('has 1 fields');

    const title = copy(PERSONAL_EXPENSES);
    title.lists[0].title = 'headline';
    expect(detail(title, 'Lists and fields')).toContain('its title "headline"');

    const users = copy(PERSONAL_EXPENSES);
    users.lists[1].name = 'users';
    expect(detail(users, 'Lists and fields')).toContain('Turnkey keeps itself');
  });

  it('a link to a list that is not planned and a choice with no options', () => {
    const plan = copy(PERSONAL_EXPENSES);
    plan.lists[0].fields[3].ref = 'shops';
    plan.lists[0].fields[4].options = ['cash'];
    const text = detail(plan, 'Lists and fields');
    expect(text).toContain('points to "shops"');
    expect(text).toContain('needs at least 2 options');
  });

  it('a field of an unknown type or with a name Turnkey adds itself', () => {
    const plan = copy(PERSONAL_EXPENSES);
    (plan.lists[0].fields[5] as { type: string }).type = 'photo';
    plan.lists[0].fields.push({ name: 'created_at', label: 'Created', type: 'date' });
    const text = detail(plan, 'Lists and fields');
    expect(text).toContain('unknown type "photo"');
    expect(text).toContain('"created_at" is added to every list');
  });

  it('stages nobody can reach, moves by strangers and a stage field that does not match', () => {
    const plan = copy(COMPANY_EXPENSES);
    const stages = plan.stages!;
    stages.moves = stages.moves.filter((m) => m.to !== 'rejected');
    stages.moves[0].by = ['intern'];
    expect(detail(plan, 'Stages')).toContain('no move leads to "rejected"');
    expect(detail(plan, 'Stages')).toContain('"intern"');

    const field = copy(COMPANY_EXPENSES);
    field.lists[0].fields[7].options = ['draft', 'done'];
    expect(detail(field, 'Stages')).toContain('must be exactly the stages');
  });

  it('two stages only', () => {
    const plan = copy(COMPANY_EXPENSES);
    const stages = plan.stages!;
    stages.stages = stages.stages.slice(0, 2);
    stages.moves = [{ label: 'Submit', from: ['draft'], to: 'submitted', by: ['employee'] }];
    plan.lists[0].fields[7].options = ['draft', 'submitted'];
    expect(detail(plan, 'Stages')).toContain('2 stages');
  });

  it('a kind of person who can see nothing, and "own" with no owner field', () => {
    const blind = copy(COMPANY_EXPENSES);
    for (const list of blind.lists) blind.permissions[list.name].employee = { list: 'none', create: false, update: 'none', delete: false };
    expect(detail(blind, 'Who can see and do what')).toContain('Employee cannot see any list');

    const own = copy(COMPANY_EXPENSES);
    own.lists[0].owner = null;
    expect(detail(own, 'Who can see and do what')).toContain('needs a person field');

    const gap = copy(COMPANY_EXPENSES);
    delete gap.permissions.payments.manager;
    expect(detail(gap, 'Who can see and do what')).toContain('nothing says what Manager can see and do');
  });

  it('a plan that ignores the answers', () => {
    const two = copy(PERSONAL_EXPENSES);
    two.people.push({ id: 'partner', name: 'Partner', can: 'Looks at the spending' });
    for (const list of two.lists) two.permissions[list.name].partner = { list: 'all', create: false, update: 'none', delete: false };
    expect(detail(two, 'The plan agrees with the answers')).toContain('"Just me" means one kind of person');

    const demo = copy(PERSONAL_EXPENSES);
    demo.answers.find((a) => a.slot === 'demo_data')!.value = 'no';
    expect(detail(demo, 'The plan agrees with the answers')).toContain('no demo data');

    const flat = copy(COMPANY_EXPENSES);
    flat.answers.find((a) => a.slot === 'approval')!.value = 'none';
    expect(detail(flat, 'The plan agrees with the answers')).toContain('no approval');

    const wrong = copy(COMPANY_EXPENSES);
    wrong.audience = 'group';
    expect(detail(wrong, 'The plan agrees with the answers')).toContain('"company"');
  });
});

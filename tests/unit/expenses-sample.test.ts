import { describe, expect, it } from 'vitest';
import { COMPANY_EXPENSES, PERSONAL_EXPENSES, checkPlan, previewPlan, teamFor, type PlanSpec } from '@/shared/plan';
import '@/workspace/saved';
import { matchTemplate } from '@/workspace/catalog';
import { planFromSaved, savedInterview } from '@/workspace/interview';

/* The expense manager is the example the guided build was designed around: "who is this for?" decides which app it is. */
const outline = (p: PlanSpec) => ({
  audience: p.audience,
  people: p.people.map((x) => x.id),
  lists: p.lists.map((l) => [l.name, l.settings, l.fields.map((f) => f.name)]),
  stages: p.stages ? p.stages.stages.map((s) => s.id) : null,
  permissions: p.permissions,
});

describe('the expense manager saved build', () => {
  it('is what a sentence about expenses picks, not purchase requests', () => {
    expect(matchTemplate('I want to build an expense management app')).toBe('expenses');
    expect(matchTemplate('track my spending')).toBe('expenses');
    expect(matchTemplate('Staff raise purchase requests and a buyer orders them')).toBe('purchasing');
  });

  it('asks who it is for, with two answers that lead to two different plans', () => {
    const { reflect, cards, draft } = savedInterview('expenses');
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe('Who is this for?');
    expect(cards[0].options.map((o) => o.label)).toEqual(['Just me', 'A company or team']);
    expect(cards[0].usual).toEqual(['1']);
    expect(draft.name).toBe('Expense Desk');
    expect(reflect).toMatch(/keep track of expenses/);
  });

  it('"Just me" is the personal plan: one person, two lists, no stages, categories kept as settings', () => {
    const p = planFromSaved('expenses', 0);
    expect(outline(p)).toEqual(outline(PERSONAL_EXPENSES));
    expect(p.name).toBe('My Expenses');
    expect(p.notInThisVersion).toHaveLength(1);
    expect(checkPlan(p).filter((c) => !c.ok)).toEqual([]);
  });

  it('"A company or team" is the company plan: three kinds of people, four lists, five stages', () => {
    const p = planFromSaved('expenses', 1);
    expect(outline(p)).toEqual(outline(COMPANY_EXPENSES));
    expect(p.name).toBe('Expense Desk');
    expect(checkPlan(p).filter((c) => !c.ok)).toEqual([]);
    // money moves, so the team pauses for the owner after the rules, and people see only their own claims
    expect(teamFor(p).pauses.map((x) => x.after)).toContain('backend');
    expect(teamFor(planFromSaved('expenses', 0)).pauses).toEqual([]);
  });

  it('the plan beside the question follows the answer, name and all, with nothing left over from the other answer', () => {
    const { cards, draft } = savedInterview('expenses');
    for (const [id, want] of [
      ['0', planFromSaved('expenses', 0)],
      ['1', planFromSaved('expenses', 1)],
    ] as const) {
      const p = previewPlan(draft, cards, { q: { picked: [id], by: 'you' } });
      expect(outline(p)).toEqual(outline(want));
      expect([p.name, p.summary]).toEqual([want.name, want.summary]);
      expect(p.stories).toEqual(want.stories);
    }
  });
});

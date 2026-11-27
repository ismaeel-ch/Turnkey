import { describe, expect, it } from 'vitest';
import { backendFromPlan, checkPlan, formulasFromPlan, logicLines, normPlan, type PlanSpec } from '@/shared/plan';
import type { ColumnDef } from '@/shared/sql/types';
import '@/workspace/saved';
import { planFromSaved } from '@/workspace/interview';

/* What a plan says the app works out and checks: read from a model's answer, repaired, shown and built from. */

const orders = () => structuredClone(planFromSaved('orders', 0)) as PlanSpec;
const field = (p: PlanSpec, list: string, name: string) => p.lists.find((l) => l.name === list)!.fields.find((f) => f.name === name)!;

describe('calculated fields and rules in a plan', () => {
  it('survive being read again, as a model would send them', () => {
    const p = normPlan(JSON.parse(JSON.stringify(orders())), { repair: true });
    expect(field(p, 'order_lines', 'line_total').formula).toBe('quantity * unit_price');
    expect(field(p, 'purchase_orders', 'total').formula).toBe('sum(order_lines.line_total)');
    expect(p.stages?.stages.filter((x) => x.locked).map((x) => x.id)).toEqual(['approved', 'ordered', 'received']);
    expect(p.stages?.moves.find((m) => m.label === 'Submit')?.when).toBe('line_count > 0 and total <= department.remaining');
    expect((p.checks || []).map((c) => c.list)).toContain('order_lines');
    expect(checkPlan(p).filter((c) => !c.ok)).toEqual([]);
  });

  it('a repair drops what cannot be worked out instead of failing the plan', () => {
    const raw = orders();
    field(raw, 'order_lines', 'line_total').formula = 'quantity * no_such_field';
    raw.stages!.moves.find((m) => m.label === 'Submit')!.when = 'this is not ( a formula';
    raw.checks = [...(raw.checks || []), { list: 'order_lines', when: 'missing > 0', message: 'Never shown.' }];
    const p = normPlan(JSON.parse(JSON.stringify(raw)), { repair: true });
    expect(field(p, 'order_lines', 'line_total').formula).toBeUndefined();
    expect(p.stages?.moves.find((m) => m.label === 'Submit')?.when).toBeUndefined();
    expect((p.checks || []).some((c) => c.message === 'Never shown.')).toBe(false);
  });

  it('without a repair, the plan check names the problem', () => {
    const raw = orders();
    raw.checks = [{ list: 'order_lines', when: 'missing > 0', message: 'Never shown.' }];
    const bad = checkPlan(raw).filter((c) => !c.ok);
    expect(bad.map((c) => c.label)).toEqual(['Calculated fields and rules']);
  });

  it('are put into plain words for the plan screen', () => {
    const lines = logicLines(orders());
    expect(lines.filter((l) => l.kind === 'calc').map((l) => l.sub)).toContain('On order lines: quantity × unit price');
    expect(lines.some((l) => l.kind === 'lock')).toBe(true);
    expect(lines.some((l) => l.kind === 'move')).toBe(true);
    expect(lines.some((l) => l.kind === 'check' && /quantity/i.test(l.text + l.sub))).toBe(true);
    for (const l of lines) expect(l.text + l.sub).not.toMatch(/[{}_]|sum\(|count\(|=>/);
  });

  it('always reach the built app, whatever the agents wrote', () => {
    const plan = orders();
    const be = backendFromPlan(plan);
    expect(be.logic?.rules.length).toBe((plan.checks || []).length);
    expect(be.status?.locked).toEqual(['approved', 'ordered', 'received']);
    // the Database agent forgot the formula: the plan puts it back
    const bare: { name: string; columns: ColumnDef[] }[] = [
      { name: 'order_lines', columns: [{ name: 'line_total', label: 'Line total', type: 'money' }] },
    ];
    const tables = formulasFromPlan(plan, bare);
    expect(tables[0].columns[0].formula).toBe('quantity * unit_price');
  });
});

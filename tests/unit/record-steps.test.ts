import { describe, expect, it } from 'vitest';
import type { Migration, RecordStep } from '@/shared/types/app';
import { choiceValue, columnPlan, inverseSteps, normHistory, normStep, stepsBetween, stepsFromTo, verCmp } from '@/workspace/record-steps';

const rename = (from: string, to: string, table = 'claims'): RecordStep => ({ op: 'rename_field', table, from, to });
const SYS = ['id', 'created_by', 'created_at'];

describe('record steps: reading them from a link', () => {
  it('keeps well-formed steps and drops anything else', () => {
    expect(normStep({ op: 'rename_field', table: 'claims', from: 'client', to: 'customer' })).toEqual(rename('client', 'customer'));
    expect(normStep({ op: 'to_choice', table: 'claims', column: 'sector', extra: 1 })).toEqual({
      op: 'to_choice',
      table: 'claims',
      column: 'sector',
    });
    expect(normStep({ op: 'rename_field', table: 'claims', from: 'a', to: 'a' })).toBeNull();
    expect(normStep({ op: 'rename_field', table: 'claims"; DROP TABLE users; --', from: 'a', to: 'b' })).toBeNull();
    expect(normStep({ op: 'drop_everything', table: 'claims' })).toBeNull();
    expect(normStep('rename')).toBeNull();
    expect(normStep(null)).toBeNull();
  });

  it('orders versions, drops repeats and versions that are not numbers', () => {
    const h = normHistory([
      { v: '1.1', steps: [rename('client', 'customer')] },
      { v: '1.0', steps: [] },
      { v: '1.1', steps: [rename('x', 'y')] },
      { v: 'latest', steps: [rename('x', 'y')] },
      null,
    ]);
    expect(h.map((x) => x.v)).toEqual(['1.0', '1.1']);
    expect(h[1].steps).toEqual([rename('client', 'customer')]);
    expect(normHistory('nonsense')).toEqual([]);
  });

  it('compares versions by number, not as text', () => {
    expect(verCmp('1.10', '1.9')).toBeGreaterThan(0);
    expect(verCmp('1.0.1', '1.0')).toBeGreaterThan(0);
    expect(verCmp('2.0', '2')).toBe(0);
  });
});

describe('record steps: which ones a device replays', () => {
  const history = normHistory([
    { v: '1.0', steps: [] },
    { v: '1.1', steps: [rename('client', 'customer')] },
    { v: '1.2', steps: [rename('customer', 'buyer')] },
    { v: '1.2.1', steps: [{ op: 'to_choice', table: 'claims', column: 'sector' }] },
  ]);

  it('takes every version after the one the device has, up to the one it receives', () => {
    expect(stepsBetween(history, '1.0', '1.2')).toEqual([rename('client', 'customer'), rename('customer', 'buyer')]);
    expect(stepsBetween(history, '1.1', '1.2.1')).toHaveLength(2);
    expect(stepsBetween(history, '1.2.1', '1.2.1')).toEqual([]);
    expect(stepsBetween([], '1.0', '1.2')).toEqual([]);
  });

  it('a field renamed twice across two versions keeps its values under the last name', () => {
    const plan = columnPlan(stepsBetween(history, '1.0', '1.2'), 'claims', [...SYS, 'client', 'value'], [...SYS, 'buyer', 'value']);
    expect(plan.pairs.find((p) => p.from === 'client')).toEqual({ from: 'client', to: 'buyer', choice: false });
    expect(plan.away).toEqual([]);
    expect(plan.back).toEqual([]);
  });

  it('with no steps a renamed field would be lost, which is why the link carries them', () => {
    const plan = columnPlan([], 'claims', [...SYS, 'client'], [...SYS, 'buyer']);
    expect(plan.pairs.map((p) => p.from)).toEqual(SYS);
    expect(plan.away).toEqual(['client']);
    expect(plan.back).toEqual(['buyer']);
  });

  it('steps of another table are ignored', () => {
    const plan = columnPlan([rename('client', 'customer', 'suppliers')], 'claims', ['id', 'client'], ['id', 'client']);
    expect(plan.pairs.map((p) => p.to)).toEqual(['id', 'client']);
  });

  it('marks text that became a choice, so its values are rewritten the way the draft rewrote them', () => {
    const plan = columnPlan(stepsBetween(history, '1.2', '1.2.1'), 'claims', ['id', 'sector'], ['id', 'sector']);
    expect(plan.pairs.find((p) => p.to === 'sector')?.choice).toBe(true);
    expect(choiceValue('Public Health ')).toBe('public_health');
    expect(choiceValue('')).toBe('');
    expect(choiceValue(null)).toBeNull();
    expect(choiceValue(7)).toBe(7);
  });

  it('a field that was removed is put away, and one that returns is asked back', () => {
    const gone = columnPlan([{ op: 'remove_field', table: 'claims', column: 'notes' }], 'claims', ['id', 'notes'], ['id']);
    expect(gone.away).toEqual(['notes']);
    const again = columnPlan([{ op: 'add_field', table: 'claims', column: 'notes' }], 'claims', ['id'], ['id', 'notes']);
    expect(again.back).toEqual(['notes']);
  });

  it('a field removed and added again is put away and asked back, the same as on a device that updated one version at a time', () => {
    const steps: RecordStep[] = [
      { op: 'remove_field', table: 'claims', column: 'notes' },
      { op: 'add_field', table: 'claims', column: 'notes' },
    ];
    const plan = columnPlan(steps, 'claims', ['id', 'notes'], ['id', 'notes']);
    expect(plan.pairs.map((p) => p.from)).toEqual(['id']);
    expect(plan.away).toEqual(['notes']);
    expect(plan.back).toEqual(['notes']);
  });
});

describe('record steps: going back', () => {
  it('undoes the steps in reverse order', () => {
    const steps: RecordStep[] = [
      rename('client', 'customer'),
      { op: 'add_field', table: 'claims', column: 'notes' },
      { op: 'to_choice', table: 'claims', column: 'sector' },
      { op: 'remove_field', table: 'claims', column: 'fax' },
    ];
    expect(inverseSteps(steps)).toEqual([
      { op: 'add_field', table: 'claims', column: 'fax' },
      { op: 'remove_field', table: 'claims', column: 'notes' },
      rename('customer', 'client'),
    ]);
  });

  it('a device that never had the undone version ends where it started', () => {
    const forward = [rename('client', 'customer'), { op: 'add_field', table: 'claims', column: 'notes' } as RecordStep];
    const plan = columnPlan(forward.concat(inverseSteps(forward)), 'claims', ['id', 'client'], ['id', 'client']);
    expect(plan).toEqual({
      pairs: [
        { from: 'id', to: 'id', choice: false },
        { from: 'client', to: 'client', choice: false },
      ],
      away: [],
      back: [],
    });
  });

  it('reads the steps between two states of a draft from their migration logs', () => {
    const m = (n: number, step?: RecordStep): Migration => ({
      n,
      at: 1000 + n,
      by: 'database',
      sql: 'sql ' + n,
      note: '',
      ...(step ? { step } : {}),
    });
    const early = [m(1, { op: 'add_field', table: 'claims', column: 'notes' })],
      late = early.concat([m(2, rename('client', 'customer')), m(3)]);
    expect(stepsFromTo(early, late)).toEqual([rename('client', 'customer')]); // redo
    expect(stepsFromTo(late, early)).toEqual([rename('customer', 'client')]); // undo
    expect(stepsFromTo(late, late)).toEqual([]);
    expect(stepsFromTo(late, [m(9, rename('a', 'b'))])).toEqual([]); // not the same draft
    expect(stepsFromTo(undefined, undefined)).toEqual([]);
  });
});

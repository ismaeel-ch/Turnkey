import { describe, expect, it } from 'vitest';
import { STEPS_FROM, formSteps, missingIn, stepWithError } from '@/workspace/form-steps';
import type { ColumnDef } from '@/shared/types/app';

const col = (name: string, type: ColumnDef['type'] = 'text', required = false) => ({ name, label: name, type, required }) as ColumnDef;

describe('a long form is split into steps', () => {
  const t = { title: 'name', one: 'Order' };

  it('a form under seven fields stays one page', () => {
    expect(STEPS_FROM).toBe(7);
    expect(formSteps(t, [col('name'), col('a'), col('b'), col('c'), col('d'), col('e')])).toBeNull();
  });

  it('what a record needs comes first, then links, then dates and amounts, then the rest, then a check', () => {
    const cols = [
      col('name'),
      col('notes'),
      col('customer', 'ref', true),
      col('due', 'date'),
      col('budget', 'money'),
      col('owner', 'user'),
      col('site', 'ref'),
      col('colour'),
    ];
    const steps = formSteps(t, cols)!;
    expect(steps.map((s) => s.id)).toEqual(['basics', 'links', 'numbers', 'more', 'review']);
    expect(steps[0].cols.map((c) => c.name)).toEqual(['name', 'customer']);
    expect(steps[1].cols.map((c) => c.name)).toEqual(['owner', 'site']);
    expect(steps[2].title).toBe('Dates and amounts');
    expect(steps[3].cols.map((c) => c.name)).toEqual(['notes', 'colour']);
    expect(steps[4].title).toBe('Check and create');
    expect(formSteps(t, cols, false)!.at(-1)!.title).toBe('Check and save');
  });

  it('every field is on exactly one step, and no step after the first holds a single field', () => {
    const cols = [
      col('name'),
      col('a'),
      col('b'),
      col('c'),
      col('who', 'user'),
      col('when', 'date'),
      col('n', 'number'),
      col('m', 'number'),
    ];
    const steps = formSteps(t, cols)!;
    const all = steps.flatMap((s) => s.cols.map((c) => c.name));
    expect(all.slice().sort()).toEqual(cols.map((c) => c.name).sort());
    for (const s of steps.slice(1, -1)) expect(s.cols.length).toBeGreaterThan(1);
  });

  it('a form where everything is required is cut in two halves', () => {
    const cols = 'abcdefg'.split('').map((n) => col(n, 'text', true));
    const steps = formSteps({ title: 'a', one: 'Thing' }, cols)!;
    expect(steps.map((s) => s.cols.length)).toEqual([4, 3, 0]);
  });

  it('says which required fields of a step are empty and which step holds an error', () => {
    const steps = formSteps(t, [
      col('name', 'text', true),
      col('customer', 'ref', true),
      col('a'),
      col('b'),
      col('c'),
      col('x', 'date'),
      col('y', 'date'),
    ])!;
    expect(missingIn(steps[0], { name: 'Desk' }).map((c) => c.name)).toEqual(['customer']);
    expect(missingIn(steps[0], { name: 'Desk', customer: 3 })).toEqual([]);
    expect(stepWithError(steps, { y: 'Not a date' })).toBe(1);
    expect(stepWithError(steps, {})).toBe(-1);
  });
});

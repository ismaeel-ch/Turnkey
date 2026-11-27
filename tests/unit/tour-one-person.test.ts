import { describe, expect, it } from 'vitest';
import { normUI } from '@/workspace/viewspec';

/* A one-person app (the expense manager's "Just me") has nobody else who could be refused, so a tour step that expects
   a refusal can never pass. A real-model build wrote one and needed a round with the Screen designer to remove it. */
type Def = Parameters<typeof normUI>[1];
const defWith = (roles: string[]) =>
  ({
    tables: [{ name: 'expenses', label: 'Expenses', one: 'Expense', columns: [{ name: 'amount', type: 'number' }] }],
    brief: { roles: roles.map((id) => ({ id, name: id })), process: { entity: 'expenses' } },
    process: { table: '', states: [] },
  }) as unknown as Def;
const tour = [
  { role: 'owner', do: 'create', table: 'expenses', say: 'Amina adds an expense.' },
  { role: 'owner', do: 'denied', table: 'expenses', action: 'delete', say: 'Amina is refused.' },
  { role: 'employee', do: 'denied', table: 'payments', action: 'create', say: 'Ayesha is refused.' },
];

describe('the tour of a one-person app', () => {
  it('drops steps that expect a refusal', () => {
    expect(normUI({ tour }, defWith(['owner'])).tour.map((s) => s.do)).toEqual(['create']);
  });
  it('keeps them when there are several kinds of people', () => {
    expect(normUI({ tour }, defWith(['owner', 'employee'])).tour.map((s) => s.do)).toEqual(['create', 'denied', 'denied']);
  });
});

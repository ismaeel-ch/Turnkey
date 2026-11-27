import { describe, expect, it } from 'vitest';
import { calc, calcOrder, formulaProblems, logicProblems, parse, FormulaError, type Rec, type Scope } from '@/shared/logic';
import type { TableDef } from '@/shared/sql/types';

const scope = (row: Rec, more: Partial<Scope> = {}): Scope => ({
  row,
  parent: () => null,
  isList: () => false,
  children: () => [],
  others: () => [],
  today: '2026-11-27',
  ...more,
});

describe('formulas', () => {
  it('does arithmetic with the usual precedence', () => {
    expect(calc('quantity * unit_price', scope({ quantity: 3, unit_price: 12.5 }))).toBe(37.5);
    expect(calc('1 + 2 * 3 - (4 - 1) / 2', scope({}))).toBe(5.5);
    expect(calc('0.1 + 0.2', scope({}))).toBe(0.3);
    expect(calc('-amount', scope({ amount: 4 }))).toBe(-4);
  });
  it('treats an empty number as zero in sums and gives nothing for a division by zero', () => {
    expect(calc('budget - spent', scope({ budget: 100, spent: null }))).toBe(100);
    expect(calc('spent / budget', scope({ spent: 5, budget: 0 }))).toBeNull();
  });
  it('compares numbers, text and dates', () => {
    expect(calc("priority = 'high'", scope({ priority: 'high' }))).toBe(true);
    expect(calc('ends_on >= starts_on', scope({ starts_on: '2026-03-01', ends_on: '2026-02-01' }))).toBe(false);
    expect(calc('amount <= 5000 and not urgent', scope({ amount: 100, urgent: 0 }))).toBe(true);
    expect(calc('due_on < today()', scope({ due_on: '2026-11-01' }))).toBe(true);
  });
  it('has no answer when a compared value is empty, so a rule does not refuse an unfinished record', () => {
    expect(calc('ends_on >= starts_on', scope({ starts_on: '2026-03-01', ends_on: null }))).toBeNull();
    expect(calc('amount > 10 or true', scope({ amount: null }))).toBe(true);
    expect(calc('amount = empty', scope({ amount: null }))).toBe(true);
  });
  it('reads a field of a linked record', () => {
    const s = scope({ project: 2 }, { parent: (f) => (f === 'project' ? { budget: 900 } : null) });
    expect(calc('project.budget / 3', s)).toBe(300);
    expect(calc('client.name', s)).toBeNull();
  });
  it('totals, counts and averages the records that point to it', () => {
    const lines = [
      { line_total: 10, status: 'done' },
      { line_total: 15.5, status: 'open' },
      { line_total: null, status: 'done' },
    ];
    const s = scope({}, { isList: (n) => n === 'lines', children: (l) => (l === 'lines' ? lines : []) });
    expect(calc('sum(lines.line_total)', s)).toBe(25.5);
    expect(calc('count(lines)', s)).toBe(3);
    expect(calc("count(lines, status = 'done')", s)).toBe(2);
    expect(calc("sum(lines.line_total, status = 'open')", s)).toBe(15.5);
    expect(calc('avg(lines.line_total)', s)).toBe(12.75);
    expect(calc('max(lines.line_total)', s)).toBe(15.5);
    expect(calc('max(3, 9, 4)', s)).toBe(9);
  });
  it('picks a value with if() and counts days and hours', () => {
    expect(calc("if(spent > budget, 'over', 'on_track')", scope({ spent: 12, budget: 10 }))).toBe('over');
    expect(calc('days(starts_on, ends_on) + 1', scope({ starts_on: '2026-02-27', ends_on: '2026-03-02' }))).toBe(4);
    expect(calc('hours(starts_at, ends_at)', scope({ starts_at: '2026-02-27T09:00', ends_at: '2026-02-27T10:30' }))).toBe(1.5);
    expect(calc('round(10 / 3, 2)', scope({}))).toBe(3.33);
  });
  it('counts the other records at the same time for the same person', () => {
    const others = [
      { id: 1, starts_at: '2026-03-01T09:00', ends_at: '2026-03-01T10:00', doctor: 4 },
      { id: 2, starts_at: '2026-03-01T10:00', ends_at: '2026-03-01T11:00', doctor: 4 },
      { id: 3, starts_at: '2026-03-01T09:30', ends_at: '2026-03-01T10:30', doctor: 5 },
    ];
    const row = { id: 9, starts_at: '2026-03-01T09:30', ends_at: '2026-03-01T10:00', doctor: 4 };
    expect(calc('overlaps(starts_at, ends_at, doctor)', scope(row, { others: () => others }))).toBe(1);
    expect(calc('overlaps(starts_at, ends_at)', scope(row, { others: () => others }))).toBe(2);
    expect(
      calc(
        'overlaps(starts_at, ends_at, doctor) = 0',
        scope({ ...row, starts_at: '2026-03-01T11:00', ends_at: '2026-03-01T12:00' }, { others: () => others }),
      ),
    ).toBe(true);
  });
  it('refuses what is not a formula, in plain words', () => {
    expect(() => parse('amount >')).toThrow(FormulaError);
    expect(() => parse('alert(1)')).toThrow(/no function "alert"/);
    expect(() => parse('a; b')).toThrow(FormulaError);
    expect(() => parse('"open')).toThrow(/quote/);
    expect(() => parse('('.repeat(40) + '1' + ')'.repeat(40))).toThrow(/nested/);
    expect(() => parse('constructor.constructor')).not.toThrow();
    expect(calc('constructor.constructor', scope({}))).toBeNull();
    expect(calc('this is not one', scope({}))).toBeNull();
  });
});

const TABLES: TableDef[] = [
  {
    name: 'orders',
    title: 'title',
    columns: [
      { name: 'title', type: 'text' },
      { name: 'budget', type: 'money' },
      { name: 'total', type: 'money', formula: 'sum(order_lines.line_total)' },
      { name: 'left', type: 'money', formula: 'budget - total' },
      { name: 'status', type: 'select', options: ['draft', 'sent'] },
    ],
  },
  {
    name: 'order_lines',
    title: 'item',
    columns: [
      { name: 'item', type: 'text' },
      { name: 'order', type: 'ref', ref: 'orders' },
      { name: 'quantity', type: 'number' },
      { name: 'unit_price', type: 'money' },
      { name: 'line_total', type: 'money', formula: 'quantity * unit_price' },
    ],
  },
];

describe('formulas against the lists', () => {
  it('accepts formulas that read real fields, links and lists', () => {
    expect(formulaProblems(TABLES, 'orders', 'sum(order_lines.line_total)')).toEqual([]);
    expect(formulaProblems(TABLES, 'order_lines', 'order.budget >= line_total')).toEqual([]);
    expect(formulaProblems(TABLES, 'orders', "count(order_lines, quantity > 1) > 0 or status = 'draft'")).toEqual([]);
    expect(logicProblems(TABLES, [{ id: 'r', table: 'orders', when: 'total <= budget', message: 'Over budget.' }])).toEqual([]);
  });
  it('says what is wrong with the others', () => {
    expect(formulaProblems(TABLES, 'orders', 'amount * 2')[0]).toMatch(/"amount" is not a field of orders/);
    expect(formulaProblems(TABLES, 'orders', 'sum(invoices.amount)')[0]).toMatch(/no list "invoices"/);
    expect(formulaProblems(TABLES, 'orders', 'sum(order_lines.price)')[0]).toMatch(/no field "price"/);
    expect(formulaProblems(TABLES, 'order_lines', 'order.owner')[0]).toMatch(/orders has no field "owner"/);
    expect(formulaProblems(TABLES, 'orders', 'order_lines.line_total')[0]).toMatch(/not a link field/);
    expect(formulaProblems(TABLES, 'orders', 'order_lines > 2')[0]).toMatch(/is a list/);
  });
  it('orders calculated fields so each comes after what it reads, and finds circles', () => {
    expect(calcOrder(TABLES).order.map((c) => c.table + '.' + c.column)).toEqual(['order_lines.line_total', 'orders.total', 'orders.left']);
    const loop: TableDef[] = [
      {
        name: 'a',
        title: 'x',
        columns: [
          { name: 'x', type: 'number', formula: 'y + 1' },
          { name: 'y', type: 'number', formula: 'x + 1' },
        ],
      },
    ];
    expect(calcOrder(loop).circular).toHaveLength(2);
    expect(logicProblems(loop, []).join(' ')).toMatch(/depends on itself/);
  });
});

import { formulaWords } from '@/shared/logic';

describe('formulas in plain words', () => {
  const T = [
    {
      ...TABLES[0],
      label: 'Orders',
      columns: TABLES[0].columns.map((c) => ({
        ...c,
        label: c.name === 'left' ? 'Left to spend' : c.name.charAt(0).toUpperCase() + c.name.slice(1),
      })),
    },
    {
      ...TABLES[1],
      label: 'Order lines',
      columns: TABLES[1].columns.map((c) => ({
        ...c,
        label: c.name === 'unit_price' ? 'Unit price' : c.name === 'line_total' ? 'Line total' : c.name,
      })),
    },
  ];
  it('names fields and lists by their labels', () => {
    expect(formulaWords(T, 'order_lines', 'quantity * unit_price')).toBe('quantity × unit price');
    expect(formulaWords(T, 'orders', 'sum(order_lines.line_total)')).toBe('total of line total over its order lines');
    expect(formulaWords(T, 'orders', 'count(order_lines, quantity > 1)')).toBe('number of its order lines where quantity is over 1');
    expect(formulaWords(T, 'orders', 'total <= 5000')).toBe('total is at most 5,000');
    expect(formulaWords(T, 'order_lines', 'order.budget')).toBe('the budget of its order');
    expect(formulaWords(T, 'orders', "if(total > budget, 'over_budget', 'on_track')")).toBe(
      'over budget when total is over budget, otherwise on track',
    );
    expect(formulaWords(T, 'orders', 'overlaps(title, title, status) = 0')).toBe('no other orders at the same time with the same status');
    expect(formulaWords(T, 'orders', 'not a formula (')).toBe('not a formula (');
  });
});

/**
 * Checks formulas against the lists of an app before anything relies on them: every name must be a field, every
 * `link.field` a real link, every sum() a list that points here, and calculated fields must not depend on each other
 * in a circle. The problems come back as plain sentences, which go to the Planner as feedback.
 */
import type { ColumnDef, TableDef } from '@/shared/sql/types';
import { FormulaError, parsed, readsOf, type Node, type Reads } from './expr';
import type { AppRule } from './types';

type Tables = readonly Pick<TableDef, 'name' | 'columns'>[];
const tableOf = (tables: Tables, name: string) => tables.find((t) => t.name === name);
const colOf = (t: Pick<TableDef, 'columns'> | undefined, name: string): ColumnDef | undefined => t?.columns.find((c) => c.name === name);
/** The fields every record has without the plan listing them. */
const SYSTEM = ['id', 'created_at', 'created_by'];

/** The lists whose records point to `table`, with the link field of each. */
export const listsInto = (tables: Tables, table: string) =>
  tables.flatMap((t) => t.columns.filter((c) => c.type === 'ref' && c.ref === table).map((c) => ({ list: t.name, via: c.name })));

/** A formula's tree and what it reads, with names resolved against the lists. Throws `FormulaError`. */
export function readFormula(tables: Tables, table: string, text: string): { node: Node; reads: Reads } {
  const node = parsed(text);
  const t = tableOf(tables, table);
  // inside sum() and the like, a name that is not a field of this list names another list
  return { node, reads: readsOf(node, (name) => !colOf(t, name)) };
}

/** What is wrong with a formula of `table`, in plain sentences. Empty when it can be used. */
export function formulaProblems(tables: Tables, table: string, text: string): string[] {
  const t = tableOf(tables, table);
  if (!t) return ['there is no list "' + table + '"'];
  let reads: Reads;
  try {
    reads = readFormula(tables, table, text).reads;
  } catch (e) {
    return [e instanceof FormulaError ? e.message : String(e)];
  }
  const out: string[] = [];
  const fields = t.columns.map((c) => c.name).join(', ');
  for (const f of reads.fields)
    if (!colOf(t, f) && !SYSTEM.includes(f))
      out.push(
        tableOf(tables, f)
          ? '"' + f + '" is a list, not a field: use count(' + f + ') or sum(' + f + '.field)'
          : '"' + f + '" is not a field of ' + table + ' (its fields: ' + fields + '). Write text values in quotes',
      );
  for (const p of reads.paths) {
    const link = colOf(t, p.head);
    if (!link || link.type !== 'ref' || !link.ref)
      out.push(
        '"' +
          p.head +
          '.' +
          p.field +
          '": "' +
          p.head +
          '" is not a link field of ' +
          table +
          (tableOf(tables, p.head) ? '. To total another list use sum(' + p.head + '.' + p.field + ')' : ''),
      );
    else if (!colOf(tableOf(tables, link.ref), p.field) && !SYSTEM.includes(p.field))
      out.push('"' + p.head + '.' + p.field + '": ' + link.ref + ' has no field "' + p.field + '"');
  }
  const into = listsInto(tables, table);
  for (const l of reads.lists) {
    const k = tableOf(tables, l.list);
    if (!k || !into.some((x) => x.list === l.list)) {
      out.push(l.fn + '(' + l.list + '…): no list "' + l.list + '" has a link field pointing to ' + table);
      continue;
    }
    if (l.field && !colOf(k, l.field)) out.push(l.fn + '(' + l.list + '.' + l.field + '): ' + l.list + ' has no field "' + l.field + '"');
    for (const f of l.cond)
      if (!colOf(k, f) && !SYSTEM.includes(f))
        out.push('the condition in ' + l.fn + '(' + l.list + '…) reads "' + f + '", which is not a field of ' + l.list);
  }
  return out;
}

/** A calculated field, by list and field name. */
export interface CalcRef {
  table: string;
  column: string;
  formula: string;
}
export const calcsOf = (tables: Tables): CalcRef[] =>
  tables.flatMap((t) => t.columns.filter((c) => c.formula).map((c) => ({ table: t.name, column: c.name, formula: c.formula as string })));

/** The calculated fields a calculated field reads, as "list.field" keys. */
function calcDeps(tables: Tables, c: CalcRef): string[] {
  let reads: Reads;
  try {
    reads = readFormula(tables, c.table, c.formula).reads;
  } catch {
    return [];
  }
  const t = tableOf(tables, c.table);
  const out = reads.fields.map((f) => c.table + '.' + f);
  for (const p of reads.paths) {
    const link = colOf(t, p.head);
    if (link?.ref) out.push(link.ref + '.' + p.field);
  }
  for (const l of reads.lists) {
    if (l.field) out.push(l.list + '.' + l.field);
    for (const f of l.cond) out.push(l.list + '.' + f);
  }
  return out;
}

/**
 * The calculated fields in the order they must be worked out: a field after everything it reads. Fields caught in a
 * circle are returned in `circular` and left out of `order`.
 */
export function calcOrder(tables: Tables): { order: CalcRef[]; circular: CalcRef[] } {
  const all = calcsOf(tables);
  const key = (c: CalcRef) => c.table + '.' + c.column;
  const byKey = new Map(all.map((c) => [key(c), c]));
  const deps = new Map(all.map((c) => [key(c), calcDeps(tables, c).filter((d) => byKey.has(d))]));
  const order: CalcRef[] = [];
  const done = new Set<string>();
  let left = all.slice();
  while (left.length) {
    const ready = left.filter((c) => (deps.get(key(c)) || []).every((d) => done.has(d)));
    if (!ready.length) break;
    for (const c of ready) {
      order.push(c);
      done.add(key(c));
    }
    left = left.filter((c) => !done.has(key(c)));
  }
  return { order, circular: left };
}

/** The types a calculated field may have. A link, a person or long text cannot be worked out. */
export const CALC_TYPES: readonly string[] = ['number', 'money', 'text', 'select', 'date', 'datetime', 'bool'];

/** A stage move as the checks read it. */
export interface MoveLike {
  label: string;
  when?: string | null;
  needs?: string[] | null;
}

/** Everything wrong with an app's logic, as plain sentences. Empty when all of it can be enforced. */
export function logicProblems(
  tables: Tables,
  rules: readonly AppRule[],
  stages?: { table: string; column: string; moves: readonly MoveLike[] } | null,
): string[] {
  const out: string[] = [];
  for (const t of tables)
    for (const c of t.columns) {
      if (!c.formula) continue;
      const at = 'the calculated field ' + t.name + '.' + c.name;
      if (!CALC_TYPES.includes(c.type)) out.push(at + ' has type ' + c.type + ', which cannot be calculated');
      if (stages && stages.table === t.name && stages.column === c.name) out.push(at + ' is the stage field, which only moves change');
      for (const p of formulaProblems(tables, t.name, c.formula)) out.push(at + ' ("' + c.formula + '"): ' + p);
    }
  for (const c of calcOrder(tables).circular)
    out.push('the calculated field ' + c.table + '.' + c.column + ' depends on itself through other calculated fields');
  for (const r of rules) {
    if (!r.message) out.push('the rule "' + r.when + '" on ' + r.table + ' needs a message');
    for (const p of formulaProblems(tables, r.table, r.when)) out.push('the rule "' + r.when + '" on ' + r.table + ': ' + p);
  }
  if (stages) {
    const t = tableOf(tables, stages.table);
    for (const m of stages.moves) {
      if (m.when)
        for (const p of formulaProblems(tables, stages.table, m.when))
          out.push('the condition "' + m.when + '" of the move "' + m.label + '": ' + p);
      for (const f of m.needs || [])
        if (!colOf(t, f)) out.push('the move "' + m.label + '" needs "' + f + '", which is not a field of ' + stages.table);
    }
  }
  return out;
}

import type { AppDef } from '@/shared/types/app';
import type { AppRecord } from '@/shared/types/workspace';
import { formulaProblems, formulaWords, parsed, type Node } from '@/shared/logic';
import { colOf, tableOf } from './engine';

/* ===== Turnkey · the limits in an app's rules, for its Settings page =====
   A built app's rules hold numbers the people who run it will want to change: "orders over 5,000 go to the director",
   "one time entry is at most 12 hours", "warn when 80% of the budget is spent". The formulas stay as the agents wrote
   them (src/shared/logic); this file finds the numbers in them, says in plain words what each one decides, and writes
   a new number back into the formula text, the sentence shown beside it, and the approved plan.

   A limit is a number that a field is compared with (`total <= 5000`), or a share of a field (`yearly_budget * 0.8`).
   A comparison with zero is not a limit: "the quantity must be more than zero" is not something to tune. */

/** One place a limit is used: a move's condition, a rule, or a calculated field. */
export interface LimitUse {
  kind: 'move' | 'rule' | 'calc';
  table: string;
  /** the move's id, the rule's id, or the calculated field's name */
  id: string;
  /** what this use decides, in plain words */
  says: string;
  /** which numbers of the formula text, counted from 0, are this limit */
  at: number[];
}
export interface Limit {
  /** stable while the value stays: list, field, kind and value */
  key: string;
  table: string;
  /** the field the number is compared with or taken a share of */
  field: string;
  /** "Total" */
  label: string;
  /** the number as people read it: 5000, or 80 for a share of 0.8 */
  value: number;
  /** a share of the field, shown as a percentage */
  percent: boolean;
  /** the field holds money, so the number is an amount */
  money: boolean;
  uses: LimitUse[];
}

type LogicDef = Pick<AppDef, 'tables' | 'process' | 'logic'>;
const CMP = ['<', '<=', '>', '>='];
/** Every number in a formula's text with where it starts, in the order the parser reads them. */
function numbersIn(text: string): { i: number; len: number }[] {
  const out: { i: number; len: number }[] = [],
    re = /'[^']*'|"[^"]*"|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?/g;
  for (let m = re.exec(text); m; m = re.exec(text)) if (/^\d/.test(m[0])) out.push({ i: m.index, len: m[0].length });
  return out;
}
/** The numbers of a formula that are limits: which field each belongs to, and whether it is a share. */
function limitsIn(text: string): { n: number; field: string; value: number; percent: boolean }[] {
  let tree: Node;
  try {
    tree = parsed(text);
  } catch {
    return [];
  }
  const out: { n: number; field: string; value: number; percent: boolean }[] = [];
  let seen = 0;
  const fieldOf = (x: Node) => (x.k === 'name' ? x.name : x.k === 'path' ? x.head + '.' + x.field : '');
  const walk = (x: Node) => {
    switch (x.k) {
      case 'num':
        seen++;
        return;
      case 'neg':
      case 'not':
        return walk(x.x);
      case 'call':
        return x.args.forEach(walk);
      case 'bin': {
        const [num, other] = x.a.k === 'num' ? [x.a, x.b] : x.b.k === 'num' ? [x.b, x.a] : [null, null];
        const field = other ? fieldOf(other) : '';
        if (num && field) {
          // the number's place among the formula's numbers: the other side is a field, so it holds none
          const n = seen;
          if (CMP.includes(x.op) && num.v > 0) out.push({ n, field, value: num.v, percent: false });
          else if (x.op === '*' && num.v > 0 && num.v < 1) out.push({ n, field, value: Math.round(num.v * 10000) / 100, percent: true });
        }
        walk(x.a);
        walk(x.b);
        return;
      }
      default:
        return;
    }
  };
  walk(tree);
  // a formula the two readers count differently is left alone
  return numbersIn(text).length === seen ? out : [];
}

/** Every formula of the app that can hold a limit, with how to read it and how to write it back. */
interface Spot {
  kind: LimitUse['kind'];
  table: string;
  id: string;
  get: () => string;
  set: (text: string) => void;
  /** the sentence a person is shown with it, if any */
  note?: { get: () => string; set: (text: string) => void };
  says: (text: string) => string;
}
function spots(def: LogicDef): Spot[] {
  const out: Spot[] = [],
    P = def.process;
  if (P && P.table)
    P.transitions.forEach((tr) => {
      if (!tr.when) return;
      out.push({
        kind: 'move',
        table: P.table,
        id: tr.id,
        get: () => tr.when || '',
        set: (v) => (tr.when = v),
        note: { get: () => tr.unless || '', set: (v) => (tr.unless = v) },
        says: (text) => '"' + tr.label + '" is offered when ' + formulaWords(def.tables, P.table, text),
      });
    });
  (def.logic?.rules || []).forEach((r) =>
    out.push({
      kind: 'rule',
      table: r.table,
      id: r.id,
      get: () => r.when,
      set: (v) => (r.when = v),
      note: { get: () => r.message, set: (v) => (r.message = v) },
      says: (text) => r.message || 'A save is refused unless ' + formulaWords(def.tables, r.table, text),
    }),
  );
  def.tables.forEach((t) =>
    t.columns.forEach((c) => {
      if (!c.formula) return;
      out.push({
        kind: 'calc',
        table: t.name,
        id: c.name,
        get: () => c.formula || '',
        set: (v) => (c.formula = v),
        says: (text) => (c.label || c.name) + ' is ' + formulaWords(def.tables, t.name, text),
      });
    }),
  );
  return out;
}

/** The limits of an app, each with every place it is used. Two moves that split at the same number share one limit. */
export function limitsOf(def: LogicDef): Limit[] {
  const by = new Map<string, Limit>();
  spots(def).forEach((s) => {
    const text = s.get(),
      t = tableOf(def, s.table);
    const mine = new Map<string, LimitUse>();
    limitsIn(text).forEach((x) => {
      const key = [s.table, x.field, x.percent ? 'share' : 'limit', x.value].join('|');
      let L = by.get(key);
      if (!L) {
        const c = t && !x.field.includes('.') ? colOf(t, x.field) : null,
          lab = c ? c.label || c.name : formulaWords(def.tables, s.table, x.field);
        by.set(
          key,
          (L = {
            key,
            table: s.table,
            field: x.field,
            label: lab.charAt(0).toUpperCase() + lab.slice(1),
            value: x.value,
            percent: x.percent,
            money: !x.percent && !!c && c.type === 'money',
            uses: [],
          }),
        );
      }
      let use = mine.get(key);
      if (!use) {
        mine.set(key, (use = { kind: s.kind, table: s.table, id: s.id, says: s.says(text), at: [] }));
        L.uses.push(use);
      }
      use.at.push(x.n);
    });
  });
  return [...by.values()];
}

const group = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 4 });
/** A sentence with the old number replaced by the new one, however it was written: 5000, 5,000 or 80%. */
export function swapNumber(text: string, from: number, to: number, percent: boolean): string {
  if (!text) return text;
  const forms = [...new Set([String(from), group(from)])].map((f) => f.replace(/[.,]/g, '\\$&')).join('|');
  return text.replace(new RegExp('(?<![\\d.,])(' + forms + ')(?![\\d]|[.,]\\d)' + (percent ? '(?=\\s?%)' : ''), 'g'), group(to));
}

/** A formula text with some of its numbers replaced. */
function swapAt(text: string, at: number[], value: string): string {
  const nums = numbersIn(text);
  let out = text;
  [...at]
    .sort((a, b) => b - a)
    .forEach((n) => {
      const x = nums[n];
      if (x) out = out.slice(0, x.i) + value + out.slice(x.i + x.len);
    });
  return out;
}

/** What a new value does to the app: each formula and sentence before and after. Nothing is changed. */
export interface LimitChange {
  /** why the value cannot be used, or '' */
  why: string;
  /** a calculated field changes, so every record has to be worked out again */
  recalc: boolean;
  apply: () => void;
}
export function planLimit(app: Pick<AppRecord, 'def' | 'plan'>, key: string, given: number): LimitChange {
  const def = app.def,
    L = limitsOf(def).find((x) => x.key === key),
    none = { recalc: false, apply: () => {} };
  if (!L) return { why: 'That limit is no longer in the app.', ...none };
  if (!isFinite(given) || given <= 0) return { why: 'A limit is a number above zero.', ...none };
  if (L.percent && given >= 100) return { why: 'A share is between 1 and 99 percent.', ...none };
  if (given > 1e12) return { why: 'That number is too large.', ...none };
  const value = Math.round(given * 100) / 100,
    written = L.percent ? String(Math.round(value * 100) / 10000) : String(value);
  if (value === L.value) return { why: '', ...none };
  const all = spots(def),
    todo: (() => void)[] = [],
    texts = new Map<string, string>();
  for (const use of L.uses) {
    const s = all.find((x) => x.kind === use.kind && x.table === use.table && x.id === use.id);
    if (!s) continue;
    const old = s.get(),
      next = swapAt(old, use.at, written),
      bad = formulaProblems(def.tables, s.table, next);
    if (bad.length) return { why: 'That number does not work here: ' + bad[0], ...none };
    texts.set(old, next);
    todo.push(() => s.set(next));
    const note = s.note;
    if (note) {
      const was = note.get(),
        now = swapNumber(was, L.value, value, L.percent);
      if (now !== was) {
        texts.set(was, now);
        todo.push(() => note.set(now));
      }
    }
  }
  return {
    why: '',
    recalc: L.uses.some((u) => u.kind === 'calc'),
    apply: () => {
      todo.forEach((f) => f());
      // the approved plan says the same, or a later change run would bring the old number back
      const p = app.plan,
        swap = (v: string | undefined) => (v != null && texts.has(v) ? texts.get(v) : v);
      if (!p) return;
      p.stages?.moves.forEach((m) => {
        m.when = swap(m.when);
        m.unless = swap(m.unless);
      });
      (p.checks || []).forEach((c) => {
        c.when = swap(c.when) || c.when;
        c.message = swap(c.message) || c.message;
      });
      p.lists.forEach((l) => l.fields.forEach((f) => (f.formula = swap(f.formula))));
    },
  };
}

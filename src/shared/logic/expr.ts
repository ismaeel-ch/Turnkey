/**
 * The small formula language of built apps. A calculated field, a rule that refuses a save and a condition on a
 * stage move are all one expression in it:
 *
 *   quantity * unit_price                      a field worked out from other fields of the same record
 *   sum(order_lines.line_total)                a total over the records that point to this one
 *   count(tasks, status = 'done')              the same, counting only the records a condition holds for
 *   budget - spent                             may use other calculated fields
 *   project.budget                             a field of the record a link points to
 *   if(spent > budget, 'over', 'on_track')     a choice worked out from numbers
 *   ends_on >= starts_on                       a rule
 *   overlaps(starts_at, ends_at, room) = 0     a rule: nothing else books the same room at that time
 *
 * Nothing here is executed as code. The text is parsed into a tree and the tree is walked; a name can only read a
 * field, and the functions are the fixed list in `FUNCTIONS`. Pure: the caller supplies the records through `Scope`.
 */

export type Value = number | string | boolean | null;

export type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'lit'; v: boolean | null }
  | { k: 'name'; name: string }
  /** `a.b`: a field of a linked record, or inside sum() and the like, a field of the records pointing here */
  | { k: 'path'; head: string; field: string }
  | { k: 'neg'; x: Node }
  | { k: 'not'; x: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] };

/** The functions a formula may call, with how many arguments each takes. */
export const FUNCTIONS: Readonly<Record<string, { min: number; max: number; what: string }>> = {
  sum: { min: 1, max: 2, what: 'sum(list.field) adds a field over the records that point to this one' },
  count: { min: 1, max: 2, what: 'count(list) counts the records that point to this one' },
  avg: { min: 1, max: 2, what: 'avg(list.field) averages a field over the records that point to this one' },
  min: { min: 1, max: 8, what: 'min(a, b) or min(list.field)' },
  max: { min: 1, max: 8, what: 'max(a, b) or max(list.field)' },
  if: { min: 3, max: 3, what: 'if(condition, then, otherwise)' },
  days: { min: 2, max: 2, what: 'days(from, to) counts the days from one date to another' },
  hours: { min: 2, max: 2, what: 'hours(from, to) counts the hours from one date and time to another' },
  today: { min: 0, max: 0, what: 'today() is the date today' },
  round: { min: 1, max: 2, what: 'round(number, places)' },
  abs: { min: 1, max: 1, what: 'abs(number)' },
  filled: { min: 1, max: 1, what: 'filled(field) is true when the field has a value' },
  overlaps: { min: 2, max: 4, what: 'overlaps(start, end, same) counts other records of this list at the same time' },
};
/** The functions that read the records pointing to this one. Their first argument names that list. */
export const ROLLUPS: readonly string[] = ['sum', 'count', 'avg', 'min', 'max'];

export class FormulaError extends Error {}

/* ---------- reading the text ---------- */

type Tok = { t: 'num' | 'str' | 'id' | 'op'; v: string };
const OPS = ['<=', '>=', '!=', '<>', '==', '=', '<', '>', '+', '-', '*', '/', '(', ')', ',', '.'];

function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(text.slice(i));
    if (num) {
      out.push({ t: 'num', v: num[0] });
      i += num[0].length;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = text.indexOf(ch, i + 1);
      if (end < 0) throw new FormulaError('a quote is not closed');
      out.push({ t: 'str', v: text.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));
    if (id) {
      out.push({ t: 'id', v: id[0] });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => text.startsWith(o, i));
    if (!op) throw new FormulaError('"' + ch + '" is not something a formula can hold');
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

/** How long a formula may be, and how deeply it may nest. Model output and share links reach this parser. */
const MAX_LENGTH = 400;
const MAX_DEPTH = 24;

/** Reads a formula. Throws a `FormulaError` that says what is wrong in plain words. */
export function parse(text: string): Node {
  const src = String(text ?? '').trim();
  if (!src) throw new FormulaError('the formula is empty');
  if (src.length > MAX_LENGTH) throw new FormulaError('the formula is longer than ' + MAX_LENGTH + ' characters');
  const toks = tokens(src);
  let p = 0,
    depth = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === 'op' && peek().v === v;
  const isWord = (v: string) => peek()?.t === 'id' && peek().v.toLowerCase() === v;
  const need = (v: string) => {
    if (!isOp(v)) throw new FormulaError('expected "' + v + '"' + (peek() ? ' before "' + peek().v + '"' : ' at the end'));
    p++;
  };
  const deeper = <T>(f: () => T): T => {
    if (++depth > MAX_DEPTH) throw new FormulaError('the formula is nested too deeply');
    try {
      return f();
    } finally {
      depth--;
    }
  };
  const or = (): Node =>
    deeper(() => {
      let a = and();
      while (isWord('or')) {
        p++;
        a = { k: 'bin', op: 'or', a, b: and() };
      }
      return a;
    });
  const and = (): Node => {
    let a = not();
    while (isWord('and')) {
      p++;
      a = { k: 'bin', op: 'and', a, b: not() };
    }
    return a;
  };
  const not = (): Node => {
    if (isWord('not')) {
      p++;
      return { k: 'not', x: deeper(not) };
    }
    return cmp();
  };
  const cmp = (): Node => {
    const a = add();
    const t = peek();
    if (t?.t === 'op' && ['=', '==', '!=', '<>', '<', '<=', '>', '>='].includes(t.v)) {
      p++;
      const op = t.v === '==' ? '=' : t.v === '<>' ? '!=' : t.v;
      return { k: 'bin', op, a, b: add() };
    }
    return a;
  };
  const add = (): Node => {
    let a = mul();
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v;
      a = { k: 'bin', op, a, b: mul() };
    }
    return a;
  };
  const mul = (): Node => {
    let a = unary();
    while (isOp('*') || isOp('/')) {
      const op = toks[p++].v;
      a = { k: 'bin', op, a, b: unary() };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp('-')) {
      p++;
      return { k: 'neg', x: deeper(unary) };
    }
    return primary();
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new FormulaError('the formula stops too early');
    if (t.t === 'num') return { k: 'num', v: Number(t.v) };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'op' && t.v === '(') {
      const x = or();
      need(')');
      return x;
    }
    if (t.t !== 'id') throw new FormulaError('"' + t.v + '" is not expected here');
    const word = t.v.toLowerCase();
    if (isOp('(')) {
      p++;
      const spec = FUNCTIONS[word];
      if (!spec) throw new FormulaError('there is no function "' + t.v + '". Use one of: ' + Object.keys(FUNCTIONS).join(', '));
      const args: Node[] = [];
      if (!isOp(')')) {
        args.push(or());
        while (isOp(',')) {
          p++;
          args.push(or());
        }
      }
      need(')');
      if (args.length < spec.min || args.length > spec.max) throw new FormulaError(spec.what);
      return { k: 'call', fn: word, args };
    }
    if (word === 'true' || word === 'false') return { k: 'lit', v: word === 'true' };
    if (word === 'null' || word === 'empty') return { k: 'lit', v: null };
    if (isOp('.')) {
      p++;
      const f = toks[p++];
      if (!f || f.t !== 'id') throw new FormulaError('a field name must follow "' + t.v + '."');
      return { k: 'path', head: t.v, field: f.v };
    }
    return { k: 'name', name: t.v };
  };
  const tree = or();
  if (p < toks.length) throw new FormulaError('"' + toks[p].v + '" is not expected here');
  return tree;
}

const CACHE = new Map<string, Node | FormulaError>();
/** `parse`, remembered: the same few formulas are read on every save. */
export function parsed(text: string): Node {
  let hit = CACHE.get(text);
  if (!hit) {
    try {
      hit = parse(text);
    } catch (e) {
      hit = e instanceof FormulaError ? e : new FormulaError(String(e));
    }
    if (CACHE.size > 500) CACHE.clear();
    CACHE.set(text, hit);
  }
  if (hit instanceof FormulaError) throw hit;
  return hit;
}

/* ---------- working it out ---------- */

export type Rec = Record<string, unknown>;
/** Where a formula reads its records from. The built app answers from SQLite; a test answers from plain objects. */
export interface Scope {
  /** the record the formula is worked out for */
  row: Rec;
  /** the record a link field of this record points to */
  parent(field: string): Rec | null;
  /** true when the name is another list whose records point to this one */
  isList(name: string): boolean;
  /** the records of another list that point to this one */
  children(list: string): Rec[];
  /** the other records of this record's own list */
  others(): Rec[];
  /** YYYY-MM-DD */
  today: string;
}

const num = (v: Value): number =>
  typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : v == null || v === '' ? 0 : Number(v) || 0;
const val = (v: unknown): Value =>
  v == null || v === '' ? null : typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' ? v : String(v);
const truthy = (v: Value) => v === true || (typeof v === 'number' && v !== 0) || (typeof v === 'string' && v !== '');
const dayMs = (v: Value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(v ?? ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
};
/** Rounds away the noise of binary fractions (0.1 + 0.2) without changing a real amount. */
const tidy = (n: number) => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null);

function compare(op: string, a: Value, b: Value): boolean | null {
  if (op === '=' || op === '!=') {
    const same =
      a == null || b == null
        ? a == null && b == null
        : typeof a === 'number' || typeof b === 'number'
          ? num(a) === num(b)
          : String(a) === String(b);
    return op === '=' ? same : !same;
  }
  // an empty value is neither more nor less than anything: the comparison has no answer yet
  if (a == null || b == null) return null;
  const both = typeof a === 'string' && typeof b === 'string';
  const x = both ? a : num(a),
    y = both ? b : num(b);
  return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
}

/** Works a formula out for one record. Never throws for a formula that parsed: a part that cannot be worked out is empty. */
export function evaluate(node: Node, scope: Scope): Value {
  const ev = (n: Node, s: Scope): Value => {
    switch (n.k) {
      case 'num':
      case 'str':
      case 'lit':
        return n.v;
      case 'name':
        return val(s.row[n.name]);
      case 'path': {
        const parent = s.parent(n.head);
        return parent ? val(parent[n.field]) : null;
      }
      case 'neg':
        return tidy(-num(ev(n.x, s)));
      case 'not': {
        const v = ev(n.x, s);
        return v == null ? null : !truthy(v);
      }
      case 'bin': {
        if (n.op === 'and' || n.op === 'or') {
          const a = ev(n.a, s),
            b = ev(n.b, s);
          const ta = a == null ? null : truthy(a),
            tb = b == null ? null : truthy(b);
          if (n.op === 'and') return ta === false || tb === false ? false : ta == null || tb == null ? null : true;
          return ta === true || tb === true ? true : ta == null || tb == null ? null : false;
        }
        const a = ev(n.a, s),
          b = ev(n.b, s);
        switch (n.op) {
          case '+':
            return typeof a === 'string' && typeof b === 'string' && dayMs(a) == null ? a + b : tidy(num(a) + num(b));
          case '-':
            return tidy(num(a) - num(b));
          case '*':
            return tidy(num(a) * num(b));
          case '/':
            return num(b) === 0 ? null : tidy(num(a) / num(b));
          default:
            return compare(n.op, a, b);
        }
      }
      case 'call':
        return call(n, s);
    }
  };
  const call = (n: Extract<Node, { k: 'call' }>, s: Scope): Value => {
    const a = n.args;
    const first = a[0];
    // sum(list.field), count(list), avg(list.field, condition): over the records that point to this one
    const rollup =
      ROLLUPS.includes(n.fn) &&
      first &&
      a.length <= 2 &&
      ((first.k === 'path' && s.isList(first.head)) || (n.fn === 'count' && first.k === 'name' && s.isList(first.name)));
    if (rollup) {
      const list = first.k === 'path' ? first.head : (first as { name: string }).name;
      const field = first.k === 'path' ? first.field : null;
      const kids = s.children(list);
      const cond = a[1];
      const rows = cond
        ? kids.filter((r) =>
            truthy(ev(cond, { ...s, row: r, parent: () => null, children: () => [], others: () => [], isList: () => false })),
          )
        : kids;
      if (n.fn === 'count') return rows.length;
      const vals = rows.map((r) => val(r[field as string])).filter((v) => v != null);
      if (n.fn === 'sum') return tidy(vals.reduce<number>((t, v) => t + num(v), 0));
      if (!vals.length) return null;
      if (n.fn === 'avg') return tidy(vals.reduce<number>((t, v) => t + num(v), 0) / vals.length);
      const texts = vals.every((v) => typeof v === 'string');
      const sorted = texts ? [...vals].sort() : vals.map(num).sort((x, y) => x - y);
      return n.fn === 'min' ? sorted[0] : sorted[sorted.length - 1];
    }
    return scalar(n, s);
  };
  const scalar = (n: Extract<Node, { k: 'call' }>, s: Scope): Value => {
    const a = n.args;
    switch (n.fn) {
      case 'if':
        return truthy(ev(a[0], s)) ? ev(a[1], s) : ev(a[2], s);
      case 'today':
        return s.today;
      case 'days':
      case 'hours': {
        const from = dayMs(ev(a[0], s)),
          to = dayMs(ev(a[1], s));
        if (from == null || to == null) return null;
        return n.fn === 'days' ? Math.round((to - from) / 86400000) : tidy((to - from) / 3600000);
      }
      case 'round': {
        const v = ev(a[0], s);
        if (v == null) return null;
        const places = Math.max(0, Math.min(6, a[1] ? num(ev(a[1], s)) : 0)),
          f = Math.pow(10, places);
        return Math.round(num(v) * f) / f;
      }
      case 'abs': {
        const v = ev(a[0], s);
        return v == null ? null : Math.abs(num(v));
      }
      case 'filled':
        return ev(a[0], s) != null;
      case 'min':
      case 'max': {
        const vals = a.map((x) => ev(x, s)).filter((v) => v != null);
        if (!vals.length) return null;
        const texts = vals.every((v) => typeof v === 'string');
        const sorted = texts ? [...vals].sort() : vals.map(num).sort((x, y) => x - y);
        return n.fn === 'min' ? sorted[0] : sorted[sorted.length - 1];
      }
      case 'sum':
        return tidy(a.reduce<number>((t, x) => t + num(ev(x, s)), 0));
      case 'avg': {
        const vals = a.map((x) => ev(x, s)).filter((v) => v != null);
        return vals.length ? tidy(vals.reduce<number>((t, v) => t + num(v), 0) / vals.length) : null;
      }
      case 'count':
        return a.map((x) => ev(x, s)).filter((v) => v != null).length;
      case 'overlaps': {
        // other records of the same list whose time crosses this one's, and that share every "same" field
        const [startF, endF, ...same] = a.map((x) => (x.k === 'name' ? x.name : null));
        if (!startF || !endF || same.some((f) => !f)) return null;
        const start = val(s.row[startF]),
          end = val(s.row[endF]) ?? start;
        if (start == null || same.some((f) => val(s.row[f as string]) == null)) return 0;
        const me = s.row.id;
        return s.others().filter((r) => {
          if (r.id === me) return false;
          const rs = val(r[startF]),
            re = val(r[endF]) ?? rs;
          if (rs == null) return false;
          if (same.some((f) => String(r[f as string]) !== String(s.row[f as string]))) return false;
          // touching ends do not clash: one visit may end when the next begins
          return String(rs) < String(end) && String(start) < String(re);
        }).length;
      }
      default:
        return null;
    }
  };
  try {
    return ev(node, scope);
  } catch {
    return null;
  }
}

/** Works a formula out from its text. A formula that cannot be read gives an empty value. */
export function calc(text: string, scope: Scope): Value {
  try {
    return evaluate(parsed(text), scope);
  } catch {
    return null;
  }
}

/* ---------- what a formula reads ---------- */

/** What a formula reads: its own fields, fields of linked records, and other lists. */
export interface Reads {
  fields: string[];
  /** `link.field` */
  paths: { head: string; field: string }[];
  /** rollups: the list, the field (null for count) and the fields its condition reads on that list */
  lists: { list: string; field: string | null; fn: string; cond: string[] }[];
  /** true when it calls overlaps(), which reads the other records of its own list */
  others: boolean;
  /** true when it calls today(), so its answer changes with the calendar */
  today: boolean;
}

/**
 * Lists what a formula reads. `isList` says whether a name is another list that points to this one; without it a
 * path inside sum() and the like is taken as a list.
 */
export function readsOf(node: Node, isList: (name: string) => boolean = () => true): Reads {
  const out: Reads = { fields: [], paths: [], lists: [], others: false, today: false };
  const add = (list: string[], v: string) => {
    if (!list.includes(v)) list.push(v);
  };
  const walk = (n: Node, into: string[] | null) => {
    switch (n.k) {
      case 'name':
        add(into || out.fields, n.name);
        return;
      case 'path':
        if (!into) out.paths.push({ head: n.head, field: n.field });
        return;
      case 'neg':
      case 'not':
        walk(n.x, into);
        return;
      case 'bin':
        walk(n.a, into);
        walk(n.b, into);
        return;
      case 'call': {
        const first = n.args[0];
        if (n.fn === 'today') out.today = true;
        if (n.fn === 'overlaps') out.others = true;
        const rollup =
          !into &&
          ROLLUPS.includes(n.fn) &&
          first &&
          n.args.length <= 2 &&
          ((first.k === 'path' && isList(first.head)) || (n.fn === 'count' && first.k === 'name' && isList(first.name)));
        if (rollup) {
          const cond: string[] = [];
          if (n.args[1]) walk(n.args[1], cond);
          out.lists.push({
            list: first.k === 'path' ? first.head : (first as { name: string }).name,
            field: first.k === 'path' ? first.field : null,
            fn: n.fn,
            cond,
          });
          return;
        }
        n.args.forEach((x) => walk(x, into));
        return;
      }
      default:
        return;
    }
  };
  walk(node, null);
  return out;
}

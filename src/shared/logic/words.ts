/**
 * A formula in plain words, for the plan the owner approves and for the hint beside a calculated field:
 * `sum(order_lines.line_total)` reads "total of line total over its order lines", `total <= 5000` reads
 * "total is at most 5,000". Field and list names are replaced by their labels.
 */
import type { ColumnDef, TableDef } from '@/shared/sql/types';
import { parsed, type Node } from './expr';

type Tables = readonly (Pick<TableDef, 'name' | 'columns'> & { label?: string })[];
const plain = (s: string) => s.replace(/_/g, ' ').trim();
const low = (s: string | undefined, fallback: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : plain(fallback));
const CMP: Record<string, string> = { '=': 'is', '!=': 'is not', '<': 'is under', '<=': 'is at most', '>': 'is over', '>=': 'is at least' };
const SIGN: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };
const AGG: Record<string, string> = { sum: 'total of', avg: 'average', min: 'lowest', max: 'highest' };

/** The words for a formula of `table`, or the formula itself when it cannot be read. */
export function formulaWords(tables: Tables, table: string, text: string): string {
  let tree: Node;
  try {
    tree = parsed(text);
  } catch {
    return text;
  }
  const t = tables.find((x) => x.name === table);
  const col = (tb: (typeof tables)[number] | undefined, name: string): ColumnDef | undefined => tb?.columns.find((c) => c.name === name);
  const fieldOf = (tb: (typeof tables)[number] | undefined, name: string) => low(col(tb, name)?.label, name);
  const listOf = (name: string) => low(tables.find((x) => x.name === name)?.label, name);
  const say = (n: Node, tb: (typeof tables)[number] | undefined, inner = false): string => {
    switch (n.k) {
      case 'num':
        return n.v.toLocaleString('en-US');
      case 'str':
        return plain(n.v);
      case 'lit':
        return n.v == null ? 'empty' : n.v ? 'yes' : 'no';
      case 'name':
        return fieldOf(tb, n.name);
      case 'path': {
        const link = col(tb, n.head);
        const target = tables.find((x) => x.name === link?.ref);
        return 'the ' + fieldOf(target, n.field) + ' of its ' + fieldOf(tb, n.head);
      }
      case 'neg':
        return '−' + say(n.x, tb, true);
      case 'not':
        return 'not ' + say(n.x, tb, true);
      case 'bin': {
        if (n.op === 'and' || n.op === 'or') return say(n.a, tb, true) + ' ' + n.op + ' ' + say(n.b, tb, true);
        if (CMP[n.op]) {
          // "status is done" reads better than "status is 'done'"; an empty comparison reads as filled or not
          if (n.b.k === 'lit' && n.b.v == null) return say(n.a, tb, true) + (n.op === '=' ? ' is empty' : ' is filled in');
          return say(n.a, tb, true) + ' ' + CMP[n.op] + ' ' + say(n.b, tb, true);
        }
        const s = say(n.a, tb, true) + ' ' + SIGN[n.op] + ' ' + say(n.b, tb, true);
        return inner ? '(' + s + ')' : s;
      }
      case 'call': {
        const a = n.args,
          first = a[0];
        const isList = (name: string) => !col(tb, name);
        if (['sum', 'count', 'avg', 'min', 'max'].includes(n.fn) && first && a.length <= 2) {
          const list =
            first.k === 'path' && isList(first.head)
              ? first.head
              : n.fn === 'count' && first.k === 'name' && isList(first.name)
                ? first.name
                : null;
          if (list) {
            const kid = tables.find((x) => x.name === list);
            const where = a[1] ? ' where ' + say(a[1], kid, true) : '';
            if (n.fn === 'count') return 'number of its ' + listOf(list) + where;
            return AGG[n.fn] + ' ' + fieldOf(kid, (first as { field: string }).field) + ' over its ' + listOf(list) + where;
          }
        }
        const args = a.map((x) => say(x, tb, true));
        switch (n.fn) {
          case 'if':
            return args[1] + ' when ' + args[0] + ', otherwise ' + args[2];
          case 'days':
            return 'days from ' + args[0] + ' to ' + args[1];
          case 'hours':
            return 'hours from ' + args[0] + ' to ' + args[1];
          case 'today':
            return 'today';
          case 'round':
            return args[0];
          case 'abs':
            return 'size of ' + args[0];
          case 'filled':
            return args[0] + ' is filled in';
          case 'overlaps':
            return (
              'other ' +
              low(t?.label, table) +
              ' at the same time' +
              (args.length > 2 ? ' with the same ' + args.slice(2).join(' and ') : '')
            );
          case 'min':
            return 'the lower of ' + args.join(' and ');
          case 'max':
            return 'the higher of ' + args.join(' and ');
          default:
            return n.fn + ' of ' + args.join(', ');
        }
      }
    }
  };
  const out = say(tree, t);
  // a rule about clashes reads better as what it means
  return out.replace(/^other (.+?) (is|=) 0$/, 'no other $1');
}

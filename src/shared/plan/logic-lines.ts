/**
 * What a plan works out and enforces, as the lines the owner reads on the plan: each calculated field with its
 * formula in words, each rule by its message, each move that has a condition, and each stage that locks a record.
 */
import { formulaWords } from '@/shared/logic/words';
import type { PlanSpec } from './types';

export interface LogicLine {
  kind: 'calc' | 'check' | 'move' | 'lock';
  /** the line itself: "Line total" or "A visit cannot end before it starts." */
  text: string;
  /** the small print: where it is and how it is worked out */
  sub: string;
}

const aOrAn = (s: string) => (/^[aeiou]/i.test(s) ? 'An ' : 'A ') + s;

export function logicLines(plan: PlanSpec): LogicLine[] {
  const tables = plan.lists.map((l) => ({ name: l.name, label: l.label, columns: l.fields }));
  const out: LogicLine[] = [];
  for (const l of plan.lists)
    for (const f of l.fields)
      if (f.formula)
        out.push({ kind: 'calc', text: f.label, sub: 'On ' + l.label.toLowerCase() + ': ' + formulaWords(tables, l.name, f.formula) });
  for (const c of plan.checks || []) {
    const l = plan.lists.find((x) => x.name === c.list);
    out.push({ kind: 'check', text: c.message, sub: 'Checked whenever ' + aOrAn(l ? l.one : 'record').toLowerCase() + ' is saved' });
  }
  const st = plan.stages;
  if (st) {
    const fields = plan.lists.find((l) => l.name === st.list)?.fields || [];
    const name = (f: string) => (fields.find((x) => x.name === f)?.label || f.replace(/_/g, ' ')).toLowerCase();
    for (const m of st.moves) {
      const parts: string[] = [];
      if (m.when) parts.push('only when ' + formulaWords(tables, st.list, m.when));
      if (m.needs?.length) parts.push('needs ' + m.needs.map(name).join(' and ') + ' filled in');
      if (parts.length) out.push({ kind: 'move', text: m.label, sub: parts.join(', ') + (m.unless ? '. Otherwise: ' + m.unless : '') });
    }
    const one = plan.lists.find((l) => l.name === st.list)?.one || 'record';
    for (const s of st.stages)
      if (s.locked)
        out.push({
          kind: 'lock',
          text: aOrAn(s.label.toLowerCase()) + ' ' + one + ' is locked',
          sub: 'It can no longer be changed or deleted',
        });
  }
  return out;
}

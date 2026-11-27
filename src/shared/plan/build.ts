/**
 * What the build line takes from an approved plan. The plan is the owner's decision, so the build does not ask a
 * model for it again: code writes the brief from it, tells the Database agent which lists and fields are fixed and
 * checks that it kept to them, and can write the rules step from it outright.
 */
import type { AppTable, Brief, ColumnDef } from '@/shared/types/app';
import type { PlanField, PlanList, PlanSpec } from './types';

/** How many fields the Database agent may add to a list of the plan (an owner field, a date it needs for the demo data). */
export const EXTRA_FIELDS = 2;

/** The brief of a planned app: what the Researcher used to write, read off the plan. */
export function briefFromPlan(plan: PlanSpec): Brief {
  const asked = plan.answers.filter((a) => a.by === 'you');
  return {
    name: plan.name,
    summary: plan.summary,
    roles: plan.people.map((p) => ({ id: p.id, name: p.name, can: p.can })),
    entities: plan.lists.map((l) => ({ name: l.name, what: l.what })),
    // with no stages there are no states, and the entity names the list the app is mainly about
    process: plan.stages
      ? { entity: plan.stages.list, states: plan.stages.stages.map((s) => s.id), note: plan.stages.note }
      : { entity: (plan.lists.find((l) => !l.settings) || plan.lists[0])?.name || '', states: [], note: '' },
    stories: plan.stories.map((s) => ({ ...s })),
    rules: [...plan.rules],
    question: null,
    decision: asked.length ? { text: asked.map((a) => a.question).join(' '), answer: asked.map((a) => a.answer).join('. ') } : null,
    sources: [],
    planned: true,
  };
}

const fieldText = (f: PlanField) =>
  f.name +
  ':' +
  f.type +
  (f.type === 'select' ? '[' + (f.options || []).join('|') + ']' : '') +
  (f.type === 'ref' ? '->' + f.ref : '') +
  (f.type === 'user' && f.role ? '(' + f.role + ')' : '') +
  (f.required ? '*' : '') +
  (f.formula ? ' = ' + f.formula : '');

/**
 * The plan's lists as the Database prompt carries them, one line per list, in the notation the other prompts use for
 * tables: `name (title: field, owner: field or none): field:type[option|option]->list(role)*, …`.
 */
export const outlineOf = (plan: PlanSpec) =>
  plan.lists
    .map((l) => l.name + ' (title: ' + l.title + ', owner: ' + (l.owner || 'none') + '): ' + l.fields.map(fieldText).join(', '))
    .join('\n');

type Table = Pick<AppTable, 'name' | 'title' | 'owner'> & { columns: ColumnDef[] };

/** Where the tables the Database agent returned leave the plan. Empty when it kept to it. */
export function outlineProblems(plan: PlanSpec, tables: Table[]): string[] {
  const out: string[] = [];
  const planned = plan.lists.map((l) => l.name);
  const extra = tables.filter((t) => !planned.includes(t.name)).map((t) => t.name);
  if (extra.length) out.push('not in the plan: ' + extra.join(', ') + '. Use only the lists of the plan');
  for (const l of plan.lists) {
    const t = tables.find((x) => x.name === l.name);
    if (!t) {
      out.push('the plan has a list "' + l.name + '" and there is no table for it');
      continue;
    }
    const names = l.fields.map((f) => f.name);
    for (const f of l.fields) {
      const c = t.columns.find((x) => x.name === f.name);
      if (!c) out.push(l.name + ' needs the column "' + f.name + '" (' + f.type + ')');
      else if (c.type !== f.type) out.push(l.name + '.' + f.name + ' must be of type ' + f.type + ', not ' + c.type);
      else if (f.type === 'ref' && c.ref !== f.ref) out.push(l.name + '.' + f.name + ' must point to ' + f.ref);
    }
    const added = t.columns.filter((c) => !names.includes(c.name)).map((c) => c.name);
    if (added.length > EXTRA_FIELDS)
      out.push(l.name + ' has ' + added.length + ' columns the plan does not have (' + added.join(', ') + '). At most ' + EXTRA_FIELDS);
    if (t.title !== l.title) out.push('the title of ' + l.name + ' must be "' + l.title + '"');
    if (l.owner && t.owner !== l.owner) out.push('the owner of ' + l.name + ' must be "' + l.owner + '"');
  }
  return out;
}

const columnOf = (f: PlanField): ColumnDef => {
  const c: ColumnDef = { name: f.name, label: f.label, type: f.type, required: !!f.required };
  if (f.type === 'select') c.options = [...(f.options || [])];
  if (f.type === 'ref') c.ref = f.ref;
  if (f.type === 'user' && f.role) c.role = f.role;
  if (f.formula) {
    c.formula = f.formula;
    c.required = false;
  }
  return c;
};

/**
 * Puts the plan's formulas on the tables the Database agent returned. Which fields are calculated, and how, is the
 * owner's approved plan: the agent's own word on it is not taken.
 */
export function formulasFromPlan<T extends { name: string; columns: ColumnDef[] }>(plan: PlanSpec, tables: T[]): T[] {
  for (const t of tables) {
    const l = plan.lists.find((x) => x.name === t.name);
    for (const c of t.columns) {
      const f = l?.fields.find((x) => x.name === c.name);
      if (f?.formula && f.type === c.type) {
        c.formula = f.formula;
        c.required = false;
      } else delete c.formula;
    }
  }
  return tables;
}

/**
 * Brings tables back to the plan, for the Database agent's last attempt: tables the plan does not have are dropped,
 * a missing list is added empty, a missing or mistyped field is put right, added columns beyond the allowance are
 * dropped, and the title and owner are the plan's. Rows keep the values of the columns that stay.
 */
export function mendToPlan<T extends Table & { rows?: Record<string, unknown>[]; label?: string; one?: string }>(
  plan: PlanSpec,
  tables: T[],
): T[] {
  return plan.lists.map((l: PlanList) => {
    const t = tables.find((x) => x.name === l.name);
    const names = l.fields.map((f) => f.name);
    const planned = l.fields.map((f) => {
      const c = t?.columns.find((x) => x.name === f.name);
      // the agent's own column where it agrees with the plan (it may have better labels for the choices)
      return c && c.type === f.type && (f.type !== 'ref' || c.ref === f.ref) && (f.type !== 'select' || (c.options || []).length >= 2)
        ? c
        : columnOf(f);
    });
    const added = (t?.columns || []).filter((c) => !names.includes(c.name)).slice(0, EXTRA_FIELDS);
    const changed = new Set(planned.filter((c) => !t?.columns.includes(c)).map((c) => c.name));
    // the rows were written without the columns code had to add, so those cannot be required
    const columns = [...planned.map((c) => (changed.has(c.name) && t?.rows?.length ? { ...c, required: false } : c)), ...added];
    const keep = new Set(columns.map((c) => c.name));
    const rows = (t?.rows || []).map((r) => {
      const row: Record<string, unknown> = {};
      // a value written for a column of another type is not carried over; marks on the row itself (`_by`, `_demo`) stay
      for (const k of Object.keys(r || {})) if (k.startsWith('_') || (keep.has(k) && !changed.has(k))) row[k] = r[k];
      return row;
    });
    return {
      ...(t || {}),
      name: l.name,
      label: t?.label || l.label,
      one: t?.one || l.one.charAt(0).toUpperCase() + l.one.slice(1),
      title: l.title,
      owner: l.owner || t?.owner || null,
      columns,
      rows,
    } as T;
  });
}

/**
 * The rules step written from the plan, in the shape the Backend agent answers in: the stages with their moves, and
 * who can see and do what. Used when the plan gives that step to code, and as the safe answer when the agent's own
 * does not pass.
 */
export function backendFromPlan(plan: PlanSpec) {
  const st = plan.stages;
  const tone = (id: string, i: number, n: number) =>
    /cancel|reject|declin|fail|lost|denied/.test(id)
      ? 'danger'
      : i === 0
        ? 'neutral'
        : i === n - 1
          ? 'success'
          : i === 1
            ? 'info'
            : 'warning';
  const used = new Set<string>();
  const moveId = (text: string) => {
    const base =
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'move';
    let id = base;
    for (let n = 2; used.has(id); n++) id = base + '_' + n;
    used.add(id);
    return id;
  };
  return {
    status: st
      ? {
          table: st.list,
          column: st.field,
          states: st.stages.map((s, i) => ({ id: s.id, label: s.label, tone: tone(s.id, i, st.stages.length) })),
          initial: st.stages[0].id,
          transitions: st.moves.map((m) => ({
            id: moveId(m.label),
            label: m.label,
            from: [...m.from],
            to: m.to,
            roles: [...m.by],
            ...(m.when ? { when: m.when, ...(m.unless ? { unless: m.unless } : {}) } : {}),
            ...(m.needs?.length ? { needs: [...m.needs] } : {}),
          })),
          ...(st.stages.some((s) => s.locked) ? { locked: st.stages.filter((s) => s.locked).map((s) => s.id) } : {}),
        }
      : null,
    logic: { rules: (plan.checks || []).map((c) => ({ table: c.list, when: c.when, message: c.message })) },
    access: plan.lists.flatMap((l) =>
      plan.people.map((p) => {
        const a = plan.permissions[l.name]?.[p.id] || { list: 'none', create: false, update: 'none', delete: false };
        return { table: l.name, role: p.id, list: a.list, create: a.create, update: a.update, delete: a.delete };
      }),
    ),
  };
}

/** A move as the plan and the built app both describe it. */
interface MoveShape {
  id: string;
  label: string;
  from: string[];
  to: string;
  roles: string[];
}
/**
 * Pairs each move the Rules agent wrote with the move of the plan it stands for, so the plan's condition lands on the
 * right one: first by name, then by the same stages and the same people, then by the same stages and one shared kind
 * of person. A planned move is used once. Two moves between the same stages ("Finish" when within budget, "Sign off"
 * by the director) must never end up with one condition, or nothing could make the move when it is not met.
 */
export function matchMoves<P extends MoveShape, B extends MoveShape>(planned: readonly P[], built: readonly B[]): Map<B, P> {
  const left = planned.slice();
  const fits = (p: P, b: B) => p.to === b.to && p.from.length === b.from.length && p.from.every((f) => b.from.includes(f));
  const score = (p: P, b: B) =>
    p.id === b.id || p.label.toLowerCase() === b.label.toLowerCase()
      ? 3
      : !fits(p, b)
        ? 0
        : p.roles.length === b.roles.length && p.roles.every((r) => b.roles.includes(r))
          ? 2
          : p.roles.some((r) => b.roles.includes(r))
            ? 1
            : 0;
  const match = new Map<B, P>();
  for (const want of [3, 2, 1])
    for (const b of built) {
      if (match.has(b)) continue;
      const at = left.findIndex((p) => score(p, b) === want);
      if (at >= 0) match.set(b, left.splice(at, 1)[0]);
    }
  return match;
}

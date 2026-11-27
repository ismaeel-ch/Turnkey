/**
 * The plan of an app that was built without one: a saved build, a share link, an app made before plans existed. Code
 * reads it off the finished definition, so every app has a plan card and a team with no model call.
 */
import { SYSTEM_COLUMNS } from '@/shared/sql/types';
import type { AccessMap, AppDef } from '@/shared/types/app';
import type { PlanField, PlanList, PlanSpec, PlanStages } from './types';

const label = (s: string) => {
  const words = s.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const singular = (s: string) => (/(ss|us|is)$/i.test(s) ? s : s.replace(/ies$/i, 'y').replace(/s$/i, ''));

/** Null when the definition has no brief or no lists yet, which is an app whose build has not reached its lists. */
export function planFromDef(def: AppDef | null | undefined): PlanSpec | null {
  const brief = def?.brief;
  if (!def || !brief || !def.tables.length) return null;
  const people = brief.roles.map((r) => ({ id: r.id, name: r.name, can: r.can }));
  const ids = people.map((p) => p.id);

  const lists: PlanList[] = def.tables.map((t) => ({
    name: t.name,
    label: t.label || label(t.name),
    one: (t.one || label(singular(t.name))).toLowerCase(),
    what: brief.entities.find((e) => e.name === t.name)?.what || '',
    title: t.title,
    owner: t.owner || null,
    // which lists are starter settings was never written down for these apps
    settings: false,
    fields: t.columns
      .filter((c) => !(SYSTEM_COLUMNS as readonly string[]).includes(c.name))
      .map((c) => {
        const f: PlanField = { name: c.name, label: c.label || label(c.name), type: c.type };
        if (c.required) f.required = true;
        if (c.type === 'select') f.options = [...(c.options || [])];
        if (c.type === 'ref' && c.ref) f.ref = c.ref;
        if (c.type === 'user' && c.role) f.role = c.role;
        if (c.formula) f.formula = c.formula;
        return f;
      }),
  }));

  const p = def.process;
  const stages: PlanStages | null =
    p && p.states.length
      ? {
          list: p.table,
          field: p.column,
          stages: p.states.map((s) =>
            (p.locked || []).includes(s.id) ? { id: s.id, label: s.label, locked: true } : { id: s.id, label: s.label },
          ),
          moves: p.transitions.map((t) => ({
            label: t.label,
            from: [...t.from],
            to: t.to,
            by: t.roles.filter((r) => ids.includes(r)),
            ...(t.when ? { when: t.when, ...(t.unless ? { unless: t.unless } : {}) } : {}),
            ...(t.needs?.length ? { needs: [...t.needs] } : {}),
          })),
          note: brief.process?.note || '',
        }
      : null;

  const permissions: AccessMap = {};
  for (const l of lists) {
    permissions[l.name] = {};
    for (const id of ids) {
      const a = def.access[l.name]?.[id];
      permissions[l.name][id] = a
        ? { list: a.list, create: a.create, update: a.update, delete: a.delete }
        : { list: 'none', create: false, update: 'none', delete: false };
    }
  }

  return {
    v: 1,
    name: brief.name,
    summary: brief.summary,
    audience: people.length === 1 ? 'just_me' : 'company',
    people,
    lists,
    stages,
    permissions,
    rules: [...brief.rules],
    stories: brief.stories.map((s) => ({ ...s })),
    demoData: true,
    overview: !!def.dash,
    helpers: def.team ? def.team.about || def.team.title : null,
    answers: brief.decision ? [{ slot: 'decision', question: brief.decision.text, answer: brief.decision.answer, by: 'you' }] : [],
    notInThisVersion: [],
    ...(def.logic?.rules.length ? { checks: def.logic.rules.map((r) => ({ list: r.table, when: r.when, message: r.message })) } : {}),
  };
}

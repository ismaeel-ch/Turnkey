/**
 * Reads a plan, and the question cards, out of what the Planner (a model) answered. Every value is read field by
 * field and coerced, so nothing unchecked reaches the rest of the app. Names are made snake_case, types the model
 * spelled another way are mapped to the ten field types, and the stage field is kept in step with the stages. What
 * the normaliser cannot settle is left for `checkPlan`, which sends the plan back to the Planner with the reasons.
 *
 * With `repair` (the Planner's last attempt) it also mends what it safely can instead of failing: counts are cut to
 * the limits, permissions nobody wrote are filled in as "can look, cannot change", and names that point at nothing
 * are dropped.
 */
import { COLUMN_TYPES, SYSTEM_COLUMNS, SYSTEM_TABLES, TYPE_ALIAS, type ColumnType } from '@/shared/sql/types';
import type { AccessMap, Permission, Scope, Story, Untrusted } from '@/shared/types/app';
import {
  AUDIENCES,
  PLAN_LIMITS,
  SLOT_VALUES,
  type Audience,
  type PlanAnswer,
  type PlanField,
  type PlanGap,
  type PlanList,
  type PlanMove,
  type PlanPatch,
  type PlanPerson,
  type PlanSpec,
  type PlanStages,
  type QuestionCard,
  type QuestionOption,
} from './types';

const str = (x: unknown) => (x == null ? '' : String(x).trim());
const arr = (x: unknown): Untrusted[] => (Array.isArray(x) ? x : []);
const rec = (x: unknown): Record<string, Untrusted> =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, Untrusted>) : {};
const snake = (s: unknown) =>
  str(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'n$1');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const label = (s: unknown) => cap(str(s).replace(/_/g, ' ').replace(/\s+/g, ' ').trim());
const singular = (s: string) => (/(ss|us|is)$/i.test(s) ? s : s.replace(/ies$/i, 'y').replace(/s$/i, ''));
const uniq = <T>(items: T[], key: (item: T) => string) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
const SCOPES: readonly Scope[] = ['all', 'own', 'none'];
const scope = (x: unknown, fallback: Scope): Scope => {
  const s = str(x).toLowerCase();
  if ((SCOPES as readonly string[]).includes(s)) return s as Scope;
  return x === true ? 'all' : x === false ? 'none' : fallback;
};
const yes = (x: unknown) => x === true || /^(true|yes|all|own)$/i.test(str(x));

/** Can do everything; can look but not change. The two rights a repair hands out. */
export const CAN_ALL: Permission = { list: 'all', create: true, update: 'all', delete: true };
export const CAN_LOOK: Permission = { list: 'all', create: false, update: 'none', delete: false };

function normPerson(o: Untrusted): PlanPerson {
  const p = typeof o === 'string' ? { name: o } : rec(o);
  const id = snake(p.id || p.name);
  return { id, name: str(p.name) || label(id), can: str(p.can || p.description) };
}

function normField(o: Untrusted): PlanField {
  const c = typeof o === 'string' ? { name: o } : rec(o);
  const asked = str(c.type || 'text').toLowerCase();
  let type: ColumnType = (COLUMN_TYPES as readonly string[]).includes(asked) ? (asked as ColumnType) : TYPE_ALIAS[asked] || 'text';
  const field: PlanField = { name: snake(c.name || c.label), label: str(c.label) || label(c.name), type };
  if (c.required === true) field.required = true;
  if (type === 'ref') {
    const ref = snake(c.ref || c.list || c.to);
    // a link to the people who sign in is a person field
    if (ref === 'users' || ref === 'people') type = field.type = 'user';
    else field.ref = ref;
  }
  if (type === 'select') field.options = uniq(arr(c.options).map(snake), (x) => x);
  if (type === 'user' && snake(c.role)) field.role = snake(c.role);
  return field;
}

function normList(o: Untrusted): PlanList {
  const l = rec(o);
  const name = snake(l.name || l.label);
  const fields = uniq(arr(l.fields || l.columns).map(normField), (f) => f.name).filter(
    (f) => !(SYSTEM_COLUMNS as readonly string[]).includes(f.name),
  );
  return {
    name,
    label: str(l.label) || label(name),
    one: str(l.one) || label(singular(name)).toLowerCase(),
    what: str(l.what || l.description),
    title: snake(l.title) || (fields[0] ? fields[0].name : ''),
    owner: snake(l.owner) && snake(l.owner) !== 'null' && snake(l.owner) !== 'none' ? snake(l.owner) : null,
    settings: l.settings === true,
    fields,
  };
}

function normMove(o: Untrusted): PlanMove {
  const m = rec(o);
  const many = (x: Untrusted): Untrusted[] => (Array.isArray(x) ? x : x == null ? [] : [x]);
  return {
    label: str(m.label) || label(m.id || m.to),
    from: uniq(many(m.from).map(snake), (x) => x),
    to: snake(m.to),
    by: uniq(many(m.by ?? m.roles).map(snake), (x) => x),
  };
}

function normStages(o: Untrusted): PlanStages | null {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const s = rec(o);
  const stages = uniq(
    arr(s.stages || s.states).map((x) => {
      const st = typeof x === 'string' ? { label: x } : rec(x);
      const id = snake(st.id || st.label);
      return { id, label: str(st.label) || label(id) };
    }),
    (x) => x.id,
  );
  if (!stages.length) return null;
  return {
    list: snake(s.list || s.entity || s.table),
    field: snake(s.field || s.column) || 'stage',
    stages,
    moves: arr(s.moves || s.transitions)
      .map(normMove)
      .filter((m) => m.to),
    note: str(s.note),
  };
}

/**
 * Permissions written as the plan's map (list, then person), or as entries: `{ list, person, see, add, change, remove }`
 * or, as the Backend agent writes access rules, `{ table, role, list, create, update, delete }`.
 */
function normPermissions(o: Untrusted): AccessMap {
  const out: AccessMap = {};
  const put = (list: string, person: string, see: unknown, p: Record<string, Untrusted>) => {
    if (!list || !person) return;
    (out[list] ??= {})[person] = {
      list: scope(see, 'none'),
      create: yes(p.create ?? p.add),
      update: scope(p.update ?? p.change, 'none'),
      delete: yes(p.delete ?? p.remove),
    };
  };
  if (Array.isArray(o))
    for (const raw of o) {
      const e = rec(raw);
      const who = snake(e.person || e.role);
      if (e.table) put(snake(e.table), who, e.list ?? e.see, e);
      else put(snake(e.list), who, e.see, e);
    }
  else
    for (const [list, byPerson] of Object.entries(rec(o)))
      for (const [person, p] of Object.entries(rec(byPerson))) put(snake(list), snake(person), rec(p).list ?? rec(p).see, rec(p));
  return out;
}

const normStory = (o: Untrusted): Story => ({ role: snake(rec(o).role || rec(o).as), want: str(rec(o).want), so: str(rec(o).so) });
const normGap = (o: Untrusted): PlanGap => ({ ask: str(rec(o).ask), instead: str(rec(o).instead) });

/** An answer as the question cards hand it over, or as the Planner reports something it assumed. */
export function normAnswer(o: Untrusted, by?: PlanAnswer['by']): PlanAnswer | null {
  const a = rec(o);
  const slot = snake(a.slot || a.id);
  const answer = str(a.answer);
  if (!slot || !answer) return null;
  const out: PlanAnswer = { slot, question: str(a.question), answer, by: by || (a.by === 'assumed' ? 'assumed' : 'you') };
  const value = snake(a.value);
  const fixed: readonly string[] | undefined = (SLOT_VALUES as Record<string, readonly string[]>)[slot];
  if (value && (!fixed || fixed.includes(value))) out.value = value;
  return out;
}

/** Keeps the stage field of the stage list in step with the stages: it exists, it is a choice, its options are the stage ids. */
function syncStageField(lists: PlanList[], stages: PlanStages | null) {
  if (!stages) return;
  const list = lists.find((l) => l.name === stages.list);
  if (!list) return;
  const ids = stages.stages.map((s) => s.id);
  const field = list.fields.find((f) => f.name === stages.field);
  if (!field) list.fields.push({ name: stages.field, label: label(stages.field), type: 'select', options: ids });
  else if (field.type === 'select') field.options = ids;
}

/** Mends what can be mended without guessing what the owner wants. Used on the Planner's last attempt. */
function repairPlan(plan: PlanSpec) {
  plan.people = plan.people.slice(0, PLAN_LIMITS.people.max);
  if (plan.audience === 'just_me') plan.people = plan.people.slice(0, 1);
  const people = plan.people.map((p) => p.id);
  plan.lists = plan.lists.filter((l) => !(SYSTEM_TABLES as readonly string[]).includes(l.name)).slice(0, PLAN_LIMITS.lists.max);
  const lists = plan.lists.map((l) => l.name);
  if (plan.stages && !lists.includes(plan.stages.list)) plan.stages = null;
  if (plan.stages && plan.answers.some((a) => a.slot === 'approval' && a.value === 'none')) {
    // the owner said no approval steps: the stages go, and the field that held them
    const { list, field } = plan.stages;
    for (const l of plan.lists) if (l.name === list && l.title !== field) l.fields = l.fields.filter((f) => f.name !== field);
    plan.stages = null;
  }
  if (plan.stages) {
    const st = plan.stages;
    st.stages = st.stages.slice(0, PLAN_LIMITS.stages.max);
    const ids = st.stages.map((s) => s.id);
    st.moves = st.moves
      .map((m) => ({ ...m, from: m.from.filter((id) => ids.includes(id)), by: m.by.filter((id) => people.includes(id)) }))
      .filter((m) => ids.includes(m.to) && m.from.length && m.by.length);
    if (ids.length < PLAN_LIMITS.stages.min) plan.stages = null;
  }
  for (const l of plan.lists) {
    const keep = [l.title, l.owner, plan.stages && plan.stages.list === l.name ? plan.stages.field : null];
    const must = l.fields.filter((f) => keep.includes(f.name));
    const rest = l.fields.filter((f) => !keep.includes(f.name));
    l.fields = l.fields.length > PLAN_LIMITS.fields.max ? [...must, ...rest].slice(0, PLAN_LIMITS.fields.max) : l.fields;
    for (const f of l.fields) {
      if (f.type === 'ref' && !lists.includes(String(f.ref))) {
        f.type = 'text';
        delete f.ref;
      }
      if (f.type === 'user' && f.role && !people.includes(f.role)) delete f.role;
      if (f.type === 'select' && (!f.options || f.options.length < 2)) {
        f.type = 'text';
        delete f.options;
      }
    }
    if (!l.fields.some((f) => f.name === l.title) && l.fields[0]) l.title = l.fields[0].name;
    if (l.owner && l.fields.find((f) => f.name === l.owner)?.type !== 'user') l.owner = null;
  }
  syncStageField(plan.lists, plan.stages);
  const access: AccessMap = {};
  for (const l of plan.lists) {
    access[l.name] = {};
    for (const id of people) {
      const p = plan.permissions[l.name]?.[id] || (people.length === 1 ? CAN_ALL : CAN_LOOK);
      access[l.name][id] = {
        ...p,
        list: p.list === 'own' && !l.owner ? 'all' : p.list,
        update: p.update === 'own' && !l.owner ? 'all' : p.update,
      };
    }
  }
  // nobody may be left with nothing to look at
  for (const id of people)
    if (plan.lists.length && !plan.lists.some((l) => access[l.name][id].list !== 'none')) access[plan.lists[0].name][id].list = 'all';
  plan.permissions = access;
  plan.stories = plan.stories.filter((s) => people.includes(s.role));
}

/**
 * The plan in a Planner answer. `answers` are the owner's own, as the question cards recorded them: they always win
 * over what the model wrote back, and what the model says it assumed is added after them.
 */
export function normPlan(o: Untrusted, opts: { answers?: PlanAnswer[]; repair?: boolean } = {}): PlanSpec {
  const p = rec(o);
  const given = (opts.answers || []).map((a) => normAnswer(a)).filter((a): a is PlanAnswer => !!a);
  const taken = new Set(given.map((a) => a.slot));
  const assumed = arr(p.assumed || p.answers)
    .map((a) => normAnswer(a, 'assumed'))
    .filter((a): a is PlanAnswer => !!a && !taken.has(a.slot));
  const answers = uniq([...given, ...assumed], (a) => a.slot);
  const value = (slot: string) => answers.find((a) => a.slot === slot)?.value;

  const people = uniq(arr(p.people || p.roles).map(normPerson), (x) => x.id);
  const lists = uniq(arr(p.lists || p.tables).map(normList), (l) => l.name);
  const stages = normStages(p.stages || p.process);
  syncStageField(lists, stages);
  const said = snake(p.audience);
  const audience: Audience =
    (value('audience') as Audience | undefined) ||
    ((AUDIENCES as readonly string[]).includes(said) ? (said as Audience) : people.length === 1 ? 'just_me' : 'company');
  const demo = value('demo_data');

  const plan: PlanSpec = {
    v: 1,
    name: str(p.name).slice(0, 40),
    summary: str(p.summary),
    audience,
    people,
    lists,
    stages,
    permissions: normPermissions(p.permissions || p.access),
    rules: arr(p.rules).map(str).filter(Boolean).slice(0, 8),
    stories: arr(p.stories)
      .map(normStory)
      .filter((s) => s.want)
      .slice(0, 8),
    demoData: demo ? demo === 'yes' : p.demoData !== false,
    overview: p.overview !== false,
    helpers: str(p.helpers) && !/^(null|none|no)$/i.test(str(p.helpers)) ? str(p.helpers) : null,
    answers,
    notInThisVersion: arr(p.notInThisVersion || p.notNow)
      .map(normGap)
      .filter((g) => g.ask)
      .slice(0, 8),
  };
  if (opts.repair) repairPlan(plan);
  return plan;
}

/* ---------- the question cards ---------- */

/** The card Turnkey always asks last. The Planner does not write it. */
export function demoDataCard(): QuestionCard {
  return {
    id: 'demo_data',
    title: 'Would you like demo data to try the app?',
    why: 'With demo data you can click through a working app at once. It is marked as demo data and you remove it in one step when you are done.',
    kind: 'one',
    options: [
      {
        id: 'yes',
        label: 'Yes, add demo data',
        desc: 'Made-up records and people, so every screen has something to show.',
        leads: { demoData: true },
      },
      {
        id: 'no',
        label: 'No, start empty',
        desc: 'Only starter settings, such as categories. You add the first records.',
        leads: { demoData: false },
      },
    ],
    usual: ['yes'],
  };
}

/** Everyone in `people` gets the draft's rights where the draft knows them, otherwise the rights of the nearest case. */
function permissionsFor(draft: PlanSpec, people: PlanPerson[], lists: PlanList[]): AccessMap {
  const out: AccessMap = {};
  for (const l of lists) {
    out[l.name] = {};
    people.forEach((person, i) => {
      const known = draft.permissions[l.name]?.[person.id];
      const p = known || (people.length === 1 || i === people.length - 1 ? CAN_ALL : l.settings ? CAN_LOOK : { ...CAN_ALL, delete: false });
      out[l.name][person.id] = {
        ...p,
        list: p.list === 'own' && !l.owner ? 'all' : p.list,
        update: p.update === 'own' && !l.owner ? 'all' : p.update,
      };
    });
  }
  return out;
}

/** The stages an option leads to, from the labels the Planner gave: one straight path that every kind of person may walk. */
function stagesFor(draft: PlanSpec, labels: string[], people: PlanPerson[], lists: PlanList[]): PlanStages | null {
  const stages = uniq(
    labels.map((l) => ({ id: snake(l), label: str(l) })),
    (s) => s.id,
  ).slice(0, PLAN_LIMITS.stages.max);
  const list = (draft.stages && lists.find((l) => l.name === draft.stages?.list)) || lists.find((l) => !l.settings) || lists[0];
  if (stages.length < PLAN_LIMITS.stages.min || !list) return null;
  // where the draft has the same move, keep who does it and what the button says
  const old = (from: string, to: string) => draft.stages?.moves.find((m) => m.to === to && m.from.includes(from));
  const ids = people.map((p) => p.id);
  return {
    list: list.name,
    field: draft.stages?.field || 'stage',
    stages,
    moves: stages.slice(1).map((s, i) => {
      const was = old(stages[i].id, s.id);
      const by = was ? was.by.filter((id) => ids.includes(id)) : [];
      return { label: was ? was.label : 'Move to ' + s.label, from: [stages[i].id], to: s.id, by: by.length ? by : ids };
    }),
    note: '',
  };
}

/** The kinds of people an answer names, at most four, with the draft's own words for the ones it already has. */
const peopleFor = (draft: PlanSpec, asked: Untrusted[]): PlanPerson[] =>
  uniq(asked.map(normPerson), (p) => p.id)
    .slice(0, PLAN_LIMITS.people.max)
    .map((p) => draft.people.find((d) => d.id === p.id) || p);

/** With other people than the draft has: nobody who is gone is still named on a move, and everyone has rights on every list. */
function withPeople(draft: PlanSpec, people: PlanPerson[], lists: PlanList[], stages: PlanStages | null): PlanPatch {
  const ids = people.map((p) => p.id);
  const patch: PlanPatch = { people, permissions: permissionsFor(draft, people, lists) };
  if (stages)
    patch.stages = {
      ...stages,
      moves: stages.moves.map((m) => {
        const by = m.by.filter((x) => ids.includes(x));
        return { ...m, by: by.length ? by : ids };
      }),
    };
  return patch;
}

/**
 * What the plan becomes for a set of kinds of people, for the "people" card, where the owner ticks several options
 * and each option is one kind of person (its id, its label as the name, its line as what they do).
 */
export function leadsForPeople(draft: PlanSpec, people: Pick<PlanPerson, 'id' | 'name' | 'can'>[]): PlanPatch {
  const asked = peopleFor(draft, people);
  return asked.length ? withPeople(draft, asked, draft.lists, draft.stages) : {};
}

/**
 * What the plan becomes when an option is picked, worked out by code from the few words the Planner gave for the
 * option: the kinds of people, or the stage labels. It is what the plan beside the cards is redrawn from. The final
 * plan is still written by the Planner from all the answers.
 */
function leadsOf(card: string, id: string, o: Record<string, Untrusted>, draft: PlanSpec): PlanPatch | undefined {
  const patch: PlanPatch = {};
  if (card === 'demo_data') return { demoData: id === 'yes' };
  if (card === 'audience' && (AUDIENCES as readonly string[]).includes(id)) patch.audience = id as Audience;

  let people = draft.people;
  if (Array.isArray(o.people)) {
    const asked = peopleFor(draft, o.people);
    if (asked.length) people = patch.people = asked;
  }
  if (patch.audience === 'just_me' && people.length !== 1) people = patch.people = people.slice(0, 1);

  let lists = draft.lists;
  let stages = draft.stages;
  const none = card === 'approval' && id === 'none';
  if (Array.isArray(o.stages) || none) {
    stages = none ? null : stagesFor(draft, arr(o.stages).map(str).filter(Boolean), people, lists);
    patch.stages = stages;
    // the stage field follows the stages: gone with them, or holding the new ones
    lists = lists.map((l) => {
      if (!draft.stages || l.name !== draft.stages.list) return l;
      return { ...l, fields: l.fields.filter((f) => f.name !== draft.stages?.field).map((f) => ({ ...f })) };
    });
    lists = lists.map((l) => (stages && l.name === stages.list ? { ...l, fields: l.fields.map((f) => ({ ...f })) } : l));
    syncStageField(lists, stages);
    patch.lists = lists;
  }
  if (patch.people) Object.assign(patch, withPeople(draft, people, lists, stages));
  else if (patch.lists) patch.permissions = permissionsFor(draft, people, lists);
  if (card === 'visibility' && (id === 'own' || id === 'all')) {
    const access = permissionsFor(draft, people, lists);
    for (const l of lists) {
      const owner = l.fields.find((f) => f.name === l.owner);
      if (!owner) continue;
      for (const person of people) {
        const p = access[l.name][person.id];
        const theirs = !owner.role || owner.role === person.id;
        if (id === 'all' && p.list === 'own') p.list = 'all';
        if (id === 'own' && theirs && p.list === 'all' && p.create && people.length > 1) p.list = p.update = 'own';
      }
    }
    patch.permissions = access;
  }
  return Object.keys(patch).length ? patch : undefined;
}

function normOption(card: string, o: Untrusted, draft: PlanSpec): QuestionOption {
  const x = typeof o === 'string' ? { label: o } : rec(o);
  const id = snake(x.id || x.label);
  const option: QuestionOption = { id, label: str(x.label) || label(id), desc: str(x.desc || x.description) };
  const leads = leadsOf(card, id, x, draft);
  if (leads) option.leads = leads;
  return option;
}

/**
 * The question cards in a Planner answer, at most five, then Turnkey's own demo data card. A card for a slot with
 * fixed options keeps only those options; a card left with fewer than two options is dropped, and so is a card that
 * depends on one that is not there. "Who else uses it", "who approves" and "who sees what" are never asked of someone who
 * answered "Just me".
 */
const ALONE = ['people', 'approval', 'visibility'];
export function normCards(o: Untrusted, draft: PlanSpec): QuestionCard[] {
  const cards: QuestionCard[] = [];
  for (const raw of arr(o)) {
    const c = rec(raw);
    const id = snake(c.id || c.slot);
    if (!id || id === 'demo_data' || cards.some((x) => x.id === id)) continue;
    const fixed: readonly string[] | undefined = (SLOT_VALUES as Record<string, readonly string[]>)[id];
    const options = uniq(
      arr(c.options).map((x) => normOption(id, x, draft)),
      (x) => x.id,
    )
      .filter((x) => !fixed || fixed.includes(x.id))
      .slice(0, id === 'people' ? 6 : 4);
    if (options.length < 2 || !str(c.title || c.question)) continue;
    const kind = c.kind === 'many' || id === 'people' ? 'many' : 'one';
    const ids = options.map((x) => x.id);
    let usual = uniq((Array.isArray(c.usual) ? c.usual : [c.usual]).map(snake), (x) => x).filter((x) => ids.includes(x));
    if (kind === 'one') usual = usual.slice(0, 1);
    if (!usual.length) usual = [ids[0]];
    const card: QuestionCard = { id, title: str(c.title || c.question), why: str(c.why), kind, options, usual };
    const cond = rec(c.onlyIf);
    const on = snake(cond.card);
    if (on) {
      const earlier = cards.find((x) => x.id === on);
      const anyOf = arr(cond.anyOf)
        .map(snake)
        .filter((x) => earlier?.options.some((opt) => opt.id === x));
      if (!earlier || !anyOf.length) continue;
      card.onlyIf = { card: on, anyOf };
    }
    // one person has nobody to share with or to approve for them: these are asked only when there are others
    const audience = cards.find((x) => x.id === 'audience');
    const others = audience ? audience.options.map((x) => x.id).filter((x) => x !== 'just_me') : [];
    if (ALONE.includes(id) && !card.onlyIf && audience && others.length && others.length < audience.options.length)
      card.onlyIf = { card: 'audience', anyOf: others };
    cards.push(card);
    if (cards.length >= PLAN_LIMITS.questions) break;
  }
  return [...cards, demoDataCard()];
}

/** What the Planner's first answer holds: one sentence that says the request back, the cards, and the plan for the usual answers. */
export interface PlannerAsk {
  reflect: string;
  cards: QuestionCard[];
  draft: PlanSpec;
}

/**
 * Every card answered: with the owner's answer where they gave one (`given`), otherwise with the card's usual choice,
 * recorded as assumed. A card that depends on an earlier answer is left out when that answer did not lead to it.
 * With no `given`, these are the answers a draft stands for.
 */
export function usualAnswers(cards: QuestionCard[], given: PlanAnswer[] = []): PlanAnswer[] {
  const out: PlanAnswer[] = [];
  for (const c of cards) {
    if (c.onlyIf) {
      const on = out.find((a) => a.slot === c.onlyIf?.card);
      // an answer with no option id (several ticked, or typed) cannot rule a card out
      if (!on || (on.value && !c.onlyIf.anyOf.includes(on.value))) continue;
    }
    const mine = given.find((a) => a.slot === c.id && a.by === 'you');
    if (mine) {
      out.push(mine);
      continue;
    }
    const chosen = c.options.filter((x) => c.usual.includes(x.id));
    if (!chosen.length) continue;
    const a: PlanAnswer = { slot: c.id, question: c.title, answer: chosen.map((x) => x.label).join(', '), by: 'assumed' };
    if (c.kind === 'one') a.value = chosen[0].id;
    out.push(a);
  }
  return out;
}

export function normAsk(o: Untrusted, opts: { repair?: boolean } = {}): PlannerAsk {
  const a = rec(o);
  const plan = normPlan(a.draft || a.plan, { repair: opts.repair });
  const cards = normCards(a.cards || a.questions, plan);
  // the draft is the plan for the usual answers, so it carries them; whatever the model said it assumed comes after
  const draft = normPlan(a.draft || a.plan, { repair: opts.repair, answers: usualAnswers(cards) });
  return { reflect: str(a.reflect).slice(0, 240), cards, draft };
}

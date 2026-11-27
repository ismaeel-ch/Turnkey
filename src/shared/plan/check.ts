/**
 * The checks a plan must pass before the owner sees it and before anything is built from it. Code, not a model,
 * decides whether a plan is good enough: the Planner's answer is checked here, and so is every edit the owner makes
 * on the plan card. A failed check goes back to the Planner as feedback, in the same shape as every other station's
 * checks.
 */
import { COLUMN_TYPES, SYSTEM_COLUMNS, SYSTEM_TABLES } from '@/shared/sql/types';
import type { Check } from '@/shared/types/app';
import { AUDIENCES, PLAN_LIMITS, STAGE_FIELD, type PlanList, type PlanSpec } from './types';

const SNAKE = /^[a-z][a-z0-9_]*$/;
const within = (n: number, r: { min: number; max: number }) => n >= r.min && n <= r.max;
const range = (r: { min: number; max: number }) => (r.min === r.max ? String(r.min) : r.min + ' to ' + r.max);
const dupes = (names: string[]) => names.filter((n, i) => names.indexOf(n) !== i);
const quote = (names: string[]) => [...new Set(names)].map((n) => '"' + n + '"').join(', ');

/** The value picked for a slot, when an option of its card was picked. */
export function slotValue(plan: Pick<PlanSpec, 'answers'>, slot: string): string | null {
  const a = plan.answers.find((x) => x.slot === slot);
  return a && a.value ? a.value : null;
}

function listProblems(list: PlanList, plan: PlanSpec): string[] {
  const out: string[] = [];
  const fields = list.fields.map((f) => f.name);
  const lists = plan.lists.map((l) => l.name);
  const people = plan.people.map((p) => p.id);
  const say = (text: string) => out.push(list.label + ': ' + text);
  if (!within(list.fields.length, PLAN_LIMITS.fields)) say('has ' + list.fields.length + ' fields, needs ' + range(PLAN_LIMITS.fields));
  if (dupes(fields).length) say('fields named twice: ' + quote(dupes(fields)));
  if (!fields.includes(list.title)) say('its title "' + list.title + '" is not one of its fields');
  for (const f of list.fields) {
    if (!SNAKE.test(f.name)) say('the field name "' + f.name + '" must be lower case with underscores');
    if ((SYSTEM_COLUMNS as readonly string[]).includes(f.name)) say('"' + f.name + '" is added to every list automatically, leave it out');
    if (!(COLUMN_TYPES as readonly string[]).includes(f.type)) say('the field "' + f.name + '" has an unknown type "' + f.type + '"');
    if (f.type === 'select' && (!f.options || f.options.length < 2)) say('the choice "' + f.name + '" needs at least 2 options');
    if (f.type === 'ref' && !lists.includes(String(f.ref)))
      say('the link "' + f.name + '" points to "' + f.ref + '", which is not a list in the plan');
    if (f.type === 'user' && f.role && !people.includes(f.role))
      say('the person field "' + f.name + '" names "' + f.role + '", which is not a kind of person in the plan');
  }
  if (list.owner) {
    const owner = list.fields.find((f) => f.name === list.owner);
    if (!owner || owner.type !== 'user') say('its owner "' + list.owner + '" must be a person field of the list');
  }
  return out;
}

function stageProblems(plan: PlanSpec): string[] {
  const st = plan.stages;
  if (!st) return [];
  const out: string[] = [];
  const list = plan.lists.find((l) => l.name === st.list);
  const ids = st.stages.map((s) => s.id);
  const people = plan.people.map((p) => p.id);
  if (!list) return ['the stages are on "' + st.list + '", which is not a list in the plan'];
  if (list.settings) out.push('the stages are on ' + list.label + ', which holds starter settings');
  if (!within(ids.length, PLAN_LIMITS.stages)) out.push('there are ' + ids.length + ' stages, needs ' + range(PLAN_LIMITS.stages));
  if (dupes(ids).length) out.push('stages named twice: ' + quote(dupes(ids)));
  if (st.field !== STAGE_FIELD) out.push('the stage field must be named "' + STAGE_FIELD + '", not "' + st.field + '"');
  const field = list.fields.find((f) => f.name === st.field);
  if (!field || field.type !== 'select') out.push('the stage field "' + st.field + '" must be a choice field of ' + list.label);
  else if (ids.some((id) => !(field.options || []).includes(id)) || (field.options || []).some((o) => !ids.includes(o)))
    out.push('the options of "' + st.field + '" must be exactly the stages');
  for (const m of st.moves) {
    const bad = [...m.from, m.to].filter((id) => !ids.includes(id));
    if (bad.length)
      out.push('the move "' + m.label + '" uses ' + quote(bad) + ', which ' + (bad.length > 1 ? 'are not stages' : 'is not a stage'));
    if (!m.from.length) out.push('the move "' + m.label + '" starts from no stage');
    if (!m.by.length) out.push('nobody may do the move "' + m.label + '"');
    const who = m.by.filter((id) => !people.includes(id));
    if (who.length) out.push('the move "' + m.label + '" is done by ' + quote(who) + ', not a kind of person in the plan');
  }
  // every stage must be reachable from the first one
  const seen = new Set(ids.slice(0, 1));
  for (let grew = true; grew;) {
    grew = false;
    for (const m of st.moves)
      if (m.from.some((id) => seen.has(id)) && !seen.has(m.to)) {
        seen.add(m.to);
        grew = true;
      }
  }
  const lost = ids.filter((id) => !seen.has(id));
  if (lost.length) out.push('no move leads to ' + quote(lost));
  return out;
}

function permissionProblems(plan: PlanSpec): string[] {
  const out: string[] = [];
  const lists = plan.lists.map((l) => l.name);
  const people = plan.people.map((p) => p.id);
  for (const [name, byPerson] of Object.entries(plan.permissions)) {
    if (!lists.includes(name)) {
      out.push('there are permissions for "' + name + '", which is not a list in the plan');
      continue;
    }
    const strangers = Object.keys(byPerson).filter((id) => !people.includes(id));
    if (strangers.length) out.push(name + ': permissions for ' + quote(strangers) + ', not a kind of person in the plan');
  }
  for (const list of plan.lists)
    for (const person of plan.people) {
      const p = plan.permissions[list.name]?.[person.id];
      if (!p) {
        out.push(list.label + ': nothing says what ' + person.name + ' can see and do');
        continue;
      }
      if ((p.list === 'own' || p.update === 'own') && !list.owner)
        out.push(list.label + ': "' + person.name + ' sees or changes only their own" needs a person field that says whose record it is');
    }
  for (const person of plan.people)
    if (!plan.lists.some((l) => (plan.permissions[l.name]?.[person.id]?.list ?? 'none') !== 'none'))
      out.push(person.name + ' cannot see any list');
  return out;
}

/** Where the plan disagrees with what the owner answered. */
function answerProblems(plan: PlanSpec): string[] {
  const out: string[] = [];
  const audience = slotValue(plan, 'audience');
  if (audience && audience !== plan.audience)
    out.push('the answer says the app is for "' + audience + '", the plan says "' + plan.audience + '"');
  if (plan.audience === 'just_me' && plan.people.length !== 1)
    out.push('"Just me" means one kind of person, the plan has ' + plan.people.length);
  if (plan.audience !== 'just_me' && plan.people.length < 2) out.push('an app for several people needs at least 2 kinds of people');
  const approval = slotValue(plan, 'approval');
  if (approval === 'none' && plan.stages) out.push('the answer was "no approval", but the plan has stages');
  if ((approval === 'one' || approval === 'two') && !plan.stages) out.push('the answer asked for an approval, but the plan has no stages');
  const demo = slotValue(plan, 'demo_data');
  if (demo === 'no' && plan.demoData) out.push('the answer was "no demo data", but the plan adds it');
  if (demo === 'yes' && !plan.demoData) out.push('the answer asked for demo data, but the plan leaves it out');
  return out;
}

const check = (label: string, problems: string[], good: string): Check => ({
  label,
  ok: problems.length === 0,
  detail: problems.length ? problems.join('. ') + '.' : good,
});

export function checkPlan(plan: PlanSpec): Check[] {
  const people = plan.people.map((p) => p.id);
  const lists = plan.lists.map((l) => l.name);
  const basics: string[] = [];
  if (!plan.name.trim()) basics.push('the app has no name');
  if (!plan.summary.trim()) basics.push('the plan has no one-line summary');
  if (!(AUDIENCES as readonly string[]).includes(plan.audience))
    basics.push('"' + plan.audience + '" is not one of ' + AUDIENCES.join(', '));

  const who: string[] = [];
  if (!within(people.length, PLAN_LIMITS.people))
    who.push('there are ' + people.length + ' kinds of people, needs ' + range(PLAN_LIMITS.people));
  if (dupes(people).length) who.push('named twice: ' + quote(dupes(people)));
  for (const p of plan.people) {
    if (!SNAKE.test(p.id)) who.push('the id "' + p.id + '" must be lower case with underscores');
    if (!p.name.trim() || !p.can.trim()) who.push('"' + p.id + '" needs a name and a sentence on what they do');
  }

  const keeps: string[] = [];
  if (!within(lists.length, PLAN_LIMITS.lists)) keeps.push('there are ' + lists.length + ' lists, needs ' + range(PLAN_LIMITS.lists));
  if (dupes(lists).length) keeps.push('lists named twice: ' + quote(dupes(lists)));
  for (const l of plan.lists) {
    if (!SNAKE.test(l.name)) keeps.push('the list name "' + l.name + '" must be lower case with underscores');
    if ((SYSTEM_TABLES as readonly string[]).includes(l.name))
      keeps.push('"' + l.name + '" is a list Turnkey keeps itself, choose another name');
    keeps.push(...listProblems(l, plan));
  }

  return [
    check('The plan says what the app is and who it is for', basics, plan.name + ', for ' + plan.audience.replace('_', ' ') + '.'),
    check('Kinds of people', who, plan.people.map((p) => p.name).join(', ') + '.'),
    check('Lists and fields', keeps, plan.lists.map((l) => l.label + ' (' + l.fields.length + ')').join(', ') + '.'),
    check('Stages', stageProblems(plan), plan.stages ? plan.stages.stages.map((s) => s.label).join(', ') + '.' : 'No approval steps.'),
    check('Who can see and do what', permissionProblems(plan), 'Every kind of person can see at least one list.'),
    check('The plan agrees with the answers', answerProblems(plan), plan.answers.length + ' answers, all followed.'),
  ];
}

/** True when every check passes. */
export const planOk = (plan: PlanSpec) => checkPlan(plan).every((c) => c.ok);

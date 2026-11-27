/**
 * The plan beside the question cards. The Planner writes a draft plan and the cards in one call; every option of a
 * card says what it leads to (`leads`). So the plan can be redrawn after each answer by code alone: start from the
 * draft and lay each answered card's `leads` over it, in card order. No model call, and the same answers always give
 * the same plan.
 *
 * Also here: the two views of a plan that every screen showing one needs, the path through its stages and the table
 * of who can see and do what. Pure functions, usable on the server and in the browser.
 */
import type { Permission, Scope } from '@/shared/types/app';
import { AUDIENCES } from './types';
import type { Audience, PlanAnswer, PlanPatch, PlanSpec, PlanStages, QuestionCard } from './types';

/** The owner's answer to one card. `usual`: they skipped it, so the card's usual choice stands in. */
export interface CardAnswer {
  /** option ids; empty when they answered in their own words */
  picked: string[];
  /** an answer typed in their own words, for the Planner to read */
  other?: string;
  by: 'you' | 'usual';
}
/** Answers by card id. */
export type CardAnswers = Readonly<Record<string, CardAnswer | undefined>>;

const picks = (card: QuestionCard, answers: CardAnswers): string[] => answers[card.id]?.picked ?? card.usual;

/**
 * The cards that apply, given the answers so far, in order. A card with `onlyIf` is asked only when the card it hangs
 * on applies and was answered with one of the named options; until that card is answered its usual choice counts.
 */
export function cardsToAsk(cards: readonly QuestionCard[], answers: CardAnswers): QuestionCard[] {
  const asked: QuestionCard[] = [];
  for (const card of cards) {
    const on = card.onlyIf;
    if (on) {
      const parent = asked.find((c) => c.id === on.card);
      const typed = parent && answers[parent.id]?.other;
      if (!parent || typed || !picks(parent, answers).some((p) => on.anyOf.includes(p))) continue;
    }
    asked.push(card);
  }
  return asked;
}

/** The first card that applies and has no answer yet, or null when the interview is done. */
export const nextCard = (cards: readonly QuestionCard[], answers: CardAnswers): QuestionCard | null =>
  cardsToAsk(cards, answers).find((c) => !answers[c.id]) ?? null;

/** An answer in words, as it is shown back to the owner: what they typed, or the labels of what they picked. */
export function answerText(card: QuestionCard, answer: CardAnswer | undefined): string {
  if (answer?.other) return answer.other;
  const picked = answer ? answer.picked : card.usual;
  return card.options
    .filter((o) => picked.includes(o.id))
    .map((o) => o.label)
    .join(', ');
}

/** The answered cards as the plan keeps them. A skipped card is `assumed`, so the plan can offer to change it. */
export function planAnswers(cards: readonly QuestionCard[], answers: CardAnswers): PlanAnswer[] {
  return cardsToAsk(cards, answers).flatMap((card) => {
    const a = answers[card.id];
    if (!a) return [];
    const line: PlanAnswer = { slot: card.id, question: card.title, answer: answerText(card, a), by: a.by === 'you' ? 'you' : 'assumed' };
    if (!a.other && a.picked.length === 1) line.value = a.picked[0];
    return [line];
  });
}

const uniqueBy = <T>(items: T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => (seen.has(key(item)) ? false : (seen.add(key(item)), true)));
};

/** What several ticked options lead to together: people, lists and rules add up; for the rest the later tick wins. */
function together(patches: PlanPatch[]): PlanPatch {
  const out: PlanPatch = {};
  for (const p of patches) {
    if (p.people) out.people = uniqueBy([...(out.people ?? []), ...p.people], (x) => x.id);
    if (p.lists) out.lists = uniqueBy([...(out.lists ?? []), ...p.lists], (x) => x.name);
    if (p.rules) out.rules = uniqueBy([...(out.rules ?? []), ...p.rules], (x) => x);
    if (p.permissions) out.permissions = overPermissions(out.permissions ?? {}, p.permissions);
    if (p.audience !== undefined) out.audience = p.audience;
    if (p.stages !== undefined) out.stages = p.stages;
    if (p.demoData !== undefined) out.demoData = p.demoData;
    if (p.overview !== undefined) out.overview = p.overview;
  }
  return out;
}

/** Permissions are laid over list by list, so an option only has to name the lists it changes. */
const overPermissions = (base: PlanSpec['permissions'], over: PlanSpec['permissions']): PlanSpec['permissions'] => {
  const out: PlanSpec['permissions'] = { ...base };
  for (const [list, byPerson] of Object.entries(over)) out[list] = { ...byPerson };
  return out;
};

const isAudience = (v: string | undefined): v is Audience => (AUDIENCES as readonly string[]).includes(v ?? '');

/**
 * The plan as it stands after the answers so far. `draft` is the plan for the usual choices; it is not changed.
 * Cards that do not apply (see `cardsToAsk`) and cards with no answer yet leave the draft as it is.
 */
export function previewPlan(draft: PlanSpec, cards: readonly QuestionCard[], answers: CardAnswers): PlanSpec {
  const plan: PlanSpec = { ...draft };
  for (const card of cardsToAsk(cards, answers)) {
    const a = answers[card.id];
    if (!a || a.other) continue; // an answer in the owner's own words changes the plan when the Planner reads it
    const chosen = card.options.filter((o) => a.picked.includes(o.id));
    const patch = together(chosen.map((o) => o.leads ?? {}));
    const { permissions, ...rest } = patch;
    Object.assign(plan, rest);
    if (permissions) plan.permissions = overPermissions(plan.permissions, permissions);
    // the fixed slots mean the same on every card, whether or not the Planner spelled it out in `leads`
    const value = a.picked.length === 1 ? a.picked[0] : undefined;
    if (card.id === 'audience' && patch.audience === undefined && isAudience(value)) plan.audience = value;
    if (card.id === 'demo_data' && patch.demoData === undefined && (value === 'yes' || value === 'no')) plan.demoData = value === 'yes';
  }
  // nothing in the plan may point at a person or a list an answer took out
  const people = new Set(plan.people.map((p) => p.id));
  if (plan.stages) {
    const stages: PlanStages | null = plan.lists.some((l) => l.name === plan.stages?.list)
      ? {
          ...plan.stages,
          moves: plan.stages.moves.map((m) => ({ ...m, by: m.by.filter((id) => people.has(id)) })).filter((m) => m.by.length),
        }
      : null;
    plan.stages = stages;
  }
  plan.stories = plan.stories.filter((s) => people.has(s.role));
  const asked = new Set(cards.map((c) => c.id));
  plan.answers = [...planAnswers(cards, answers), ...draft.answers.filter((x) => !asked.has(x.slot))];
  return plan;
}

/* ---------- two views of a plan ---------- */

/**
 * The stages as a path: the longest way from where a record starts, and the stages off that path ("also: Rejected").
 * With no moves to follow, the stages are shown in the order the plan lists them.
 */
export function stagePath(stages: PlanStages): { main: string[]; also: string[] } {
  const next: Record<string, string[]> = {};
  for (const m of stages.moves) for (const from of m.from) if (!(next[from] ??= []).includes(m.to)) next[from].push(m.to);
  const first = stages.stages[0]?.id;
  let best: string[] = first ? [first] : [];
  const walk = (at: string, path: string[]) => {
    if (path.length > best.length) best = path;
    for (const to of next[at] ?? []) if (!path.includes(to)) walk(to, [...path, to]);
  };
  if (first) walk(first, [first]);
  if (best.length < 2) best = stages.stages.map((s) => s.id);
  const label = (id: string) => stages.stages.find((s) => s.id === id)?.label ?? id;
  return { main: best.map(label), also: stages.stages.filter((s) => !best.includes(s.id)).map((s) => s.label) };
}

export type AccessTone = 'yes' | 'part' | 'no';
export interface AccessCell {
  text: string;
  tone: AccessTone;
}
/** One row of "who can see and do what": something to do, and one cell per kind of person, in the plan's order. */
export interface AccessRow {
  what: string;
  cells: AccessCell[];
}

const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const list = (names: string[]) => (names.length < 2 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);
const scope = (v: Scope | undefined): AccessCell =>
  v === 'all' ? { text: 'All', tone: 'yes' } : v === 'own' ? { text: 'Own only', tone: 'part' } : { text: 'No', tone: 'no' };
const yesNo = (v: unknown): AccessCell => (v ? { text: 'Yes', tone: 'yes' } : { text: 'No', tone: 'no' });

/**
 * "Who can see and do what" as a short table: seeing, adding, changing and deleting each list, then each move between
 * stages. Lists that give every kind of person the same rights share a row ("See categories and teams"), and so do
 * moves made by the same people. A row that nobody may do is left out.
 */
export function accessRows(plan: Pick<PlanSpec, 'people' | 'lists' | 'permissions' | 'stages'>): AccessRow[] {
  const rows: { key: string; verb: string; names: string[]; cells: AccessCell[] }[] = [];
  const add = (verb: string, name: string, cells: AccessCell[]) => {
    if (cells.every((c) => c.tone === 'no')) return;
    const key = verb + '|' + cells.map((c) => c.text).join('|');
    const same = rows.find((r) => r.key === key);
    if (same) same.names.push(name);
    else rows.push({ key, verb, names: [name], cells });
  };
  const cellFor: Record<string, (p: Permission | undefined) => AccessCell> = {
    See: (p) => scope(p?.list),
    Add: (p) => yesNo(p?.create),
    Change: (p) => scope(p?.update),
    Delete: (p) => yesNo(p?.delete),
  };
  for (const verb of Object.keys(cellFor))
    for (const l of plan.lists)
      add(
        verb,
        lower(l.label),
        plan.people.map((p) => cellFor[verb](plan.permissions[l.name]?.[p.id])),
      );
  for (const m of plan.stages?.moves ?? [])
    add(
      'move',
      m.label,
      plan.people.map((p) => yesNo(m.by.includes(p.id))),
    );
  return rows.map((r) => ({ what: r.verb === 'move' ? r.names.join(', ') : r.verb + ' ' + list(r.names), cells: r.cells }));
}

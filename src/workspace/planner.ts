/**
 * The Planner: the agent that turns the owner's sentence into question cards and, from the answers, into the plan
 * the owner approves before anything is built. It takes the Researcher's place at the start of a build.
 *
 * Two model calls, each tried at most three times:
 *   askPlanner(request)                  one sentence that says the request back, the question cards, and a draft:
 *                                        the plan for the usual answers
 *   writePlan(request, answers, draft)   the final plan. When the owner changed nothing, the draft is the plan and
 *                                        no model is called.
 *
 * Code decides whether an answer is good enough: `normPlan` reads it, `checkPlan` checks it, and a failed check goes
 * back to the Planner with the reasons. Who works on the build is not the Planner's decision either: `teamFor` picks
 * the team from the plan. Both live in src/shared/plan with their tests.
 */
import {
  PLAN_LIMITS,
  PLAN_SLOTS,
  checkPlan,
  normAsk,
  normPlan,
  planOk,
  usualAnswers,
  type PlanAnswer,
  type PlanSpec,
  type PlannerAsk,
  type QuestionCard,
} from '@/shared/plan';
import type { Untrusted } from '@/shared/types/app';
import { emit, str } from './core';
import { HEAD, Stopped, callModel, fbText, type CallRun } from './line';

export { planFromDef } from '@/shared/plan';
export type { PlannerAsk } from '@/shared/plan';

/** Model calls allowed for one Planner answer, the first try included. The same cap as every station of the build line. */
const ATTEMPTS = 3;
/** The app does not exist while it is planned; model calls and their cost are kept under this name until it does. */
const PLAN_APP = { id: 'plan' };
/** What the Planner's calls of this session used. */
export const PLANNING: CallRun = { id: 'plan', calls: 0, tokIn: 0, tokOut: 0 };
/** Lets the caller stop a Planner call: set `stop` and abort `ctrl`, as a build's run control does. */
export type PlannerCtl = { stop: boolean; ctrl?: AbortController | null };

/** The owner's sentence as it goes into a prompt: one line, no double quotes, not longer than a short paragraph. */
const quoted = (request: string) => str(request).replace(/\s+/g, ' ').replace(/"/g, "'").slice(0, 600);

const PLAN_RULES =
  'THE PLAN\n' +
  '- "people": ' +
  PLAN_LIMITS.people.min +
  ' to ' +
  PLAN_LIMITS.people.max +
  ' kinds of people who use the app: id (snake_case), name, can (what they do, one sentence). An app for one person has exactly one, with id "owner" and name "You".\n' +
  '- "lists": ' +
  PLAN_LIMITS.lists.min +
  ' to ' +
  PLAN_LIMITS.lists.max +
  " lists of records, named in plural snake_case. Each has label, one (what one record is called), what (one sentence), title (the field shown as a record's name), owner (the person field that says whose record it is, or null), settings (true only for starter settings such as categories or teams, which stay when the demo data is removed) and " +
  PLAN_LIMITS.fields.min +
  ' to ' +
  PLAN_LIMITS.fields.max +
  ' fields.\n' +
  '- Field types: text, longtext, number, money, date, datetime, bool, select, ref, user. select needs "options" (snake_case, at least 2). ref needs "ref" (the name of a list in the plan). user is a person who signs in; "role" limits it to one kind of person. Do not list id, created_by or created_at. No list named users or activity.\n' +
  '- "stages": null when records do not move through steps (a personal tracker usually has none). Otherwise the one list whose records move: "list", "field" (always "status": a select field of that list, named status, whose options are exactly the stage ids), "stages" (' +
  PLAN_LIMITS.stages.min +
  ' to ' +
  PLAN_LIMITS.stages.max +
  ' in order, each id and label; the first is where a new record starts), "moves" (label: the words on the button, from: stage ids, to: a stage id, by: ids of the kinds of people who may do it) and "note" (the path in one or two sentences). Every stage must be reachable from the first.\n' +
  '- "permissions": for EVERY list and EVERY kind of person. list: "all", "own" (only records whose owner is the signed-in person) or "none". create: true or false. update: "all", "own" or "none". delete: true or false. "own" works only on a list that has an owner. Every kind of person must see at least one list.\n' +
  '- "rules": up to 6 plain sentences that say who can see and do what. "stories": 3 to 6, each with role (the id of a kind of person), want and so.\n' +
  '- "demoData": true unless the owner said no. "overview": true when there are amounts or counts worth a screen of numbers and charts. "helpers": null, unless the owner asked for AI to do part of the work inside the app; then one sentence on what it does.\n' +
  '- The finished app can only do this: at most 4 kinds of people; a person sees all records of a list, only their own, or none; no file or photo fields (use a text field for a link); no calculated fields; a move between stages has no conditions and nothing moves on its own; who may change a record does not depend on its stage. Where the owner asked for more, or would expect more, plan the nearest thing the app can do and add an entry to "notInThisVersion": ask (what they wanted) and instead (what they get).\n' +
  '- Write for an owner who is not technical: plain names, no jargon.';

const PLAN_FORMAT =
  '{"name":"2 or 3 words","summary":"one sentence","audience":"just_me|group|company","people":[{"id":"","name":"","can":""}],"lists":[{"name":"","label":"","one":"","what":"","title":"","owner":null,"settings":false,"fields":[{"name":"","label":"","type":"","required":true,"options":[],"ref":"","role":""}]}],"stages":{"list":"","field":"status","stages":[{"id":"","label":""}],"moves":[{"label":"","from":[""],"to":"","by":[""]}],"note":""},"permissions":{"list name":{"person id":{"list":"all","create":true,"update":"all","delete":false}}},"rules":[""],"stories":[{"role":"","want":"","so":""}],"demoData":true,"overview":true,"helpers":null,"assumed":[{"slot":"","question":"","answer":""}],"notInThisVersion":[{"ask":"","instead":""}]}';

/** The Planner's first prompt: the question cards and the draft. */
export function askPrompt(request: string, f?: string[] | null) {
  return (
    HEAD('Planner') +
    'REQUEST: "' +
    quoted(request) +
    '"\n\nWrite the questions to ask the owner before the app is built, and the plan for the usual answers.\n\nTHE QUESTIONS\n' +
    '- "reflect": one sentence that says back what you understood, starting with "Got it:".\n' +
    '- "cards": at most ' +
    PLAN_LIMITS.questions +
    ' question cards, the one that changes the app most first. Ask only what changes what gets built. Leave out a card the request already answers.\n' +
    '- Use these ids for these questions. "audience": who the app is for; option ids just_me, group (a household, club or small group) and company. "people": which kinds of people use it; kind "many", each option is one kind of person (id, label: its name, desc: what they do). "approval": what happens after someone adds a record; option ids none, one (one person approves) and two (an approval, then a second step). "visibility": who can see a record; option ids own and all. You may add cards of your own about this kind of app, with ids in snake_case. Do not ask about demo data: Turnkey asks that itself.\n' +
    '- Each card: title (the question), why (one sentence: why you ask), kind ("one" to pick one option, "many" to tick several), 2 to 4 options (id, label, desc: one line on what picking it means), and usual (the ids most owners of such an app would pick).\n' +
    '- An option may say what it changes: "people" (the kinds of people the app has when it is picked) and "stages" (the stage labels in order when it is picked; [] for no stages).\n' +
    '- "onlyIf": ask the card only when an earlier card was answered with one of these options, for example {"card":"audience","anyOf":["group","company"]}. Turnkey itself never asks one person on their own about people, approval or visibility.\n' +
    '- "draft": the plan for the usual answers. It must agree with every card\'s usual choice.\n\n' +
    PLAN_RULES +
    '\n\nFORMAT: {"reflect":"Got it: ...","cards":[{"id":"","title":"","why":"","kind":"one","options":[{"id":"","label":"","desc":"","people":[{"id":"","name":"","can":""}],"stages":[""]}],"usual":[""],"onlyIf":{"card":"","anyOf":[""]}}],"draft":' +
    PLAN_FORMAT +
    '}' +
    fbText(f)
  );
}

/** A plan as a prompt carries it: without the answers, which the prompt lists on their own. */
const planText = (plan: PlanSpec) => JSON.stringify({ ...plan, v: undefined, answers: undefined });

/** The Planner's second prompt: the final plan from the answers. The draft may be missing. */
export function planPrompt(request: string, answers: PlanAnswer[], draft: PlanSpec | null, f?: string[] | null) {
  return (
    HEAD('Planner') +
    'REQUEST: "' +
    quoted(request) +
    '"\n\nANSWERS: ' +
    JSON.stringify(answers) +
    (draft ? '\n\nDRAFT: ' + planText(draft) : '') +
    '\n\nWrite the final plan.\n' +
    '- ANSWERS are what the owner said (by "you") and the usual choice for what they skipped (by "assumed"). Follow every one. audience "just_me" means exactly one kind of person. approval "none" means no stages; "one" or "two" means stages. visibility "own" means people see only their own records of the main list, which then needs an owner. demo_data "no" means "demoData": false.\n' +
    (draft ? '- DRAFT is the plan you wrote before the answers. Keep what the answers do not change.\n' : '') +
    '- "assumed": anything else you had to decide that the owner was not asked, each with slot (snake_case), question and answer. At most 4.\n\n' +
    PLAN_RULES +
    '\n\nFORMAT: ' +
    PLAN_FORMAT +
    fbText(f)
  );
}

/** The checks a plan failed, as the sentences the Planner is sent back. */
const problemsOf = (plan: PlanSpec) =>
  checkPlan(plan)
    .filter((c) => !c.ok)
    .map((c) => c.label + ': ' + c.detail);

/**
 * Asks the Planner until its answer passes the checks, at most three times. On the last try the answer is also
 * repaired by code before it is checked. A model that cannot be reached, or the owner stopping, ends it at once.
 */
async function ask<T>(
  prompt: (feedback: string[] | null) => string,
  read: (answer: Untrusted, repair: boolean) => { value: T; problems: string[] },
  ctl?: PlannerCtl,
): Promise<T> {
  let feedback: string[] | null = null;
  // The Planner's turn opens and closes as a step of its own, so the list of agents shows it working and then done.
  const turn = { stepName: 'plan', agent: 'researcher', app: PLAN_APP.id };
  emit('STEP_STARTED', turn);
  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      let answer: Untrusted;
      try {
        answer = await callModel(PLAN_APP, PLANNING, 'researcher', prompt(feedback), attempt, ctl);
      } catch (e) {
        if (e instanceof Stopped || (e as { fatal?: boolean } | null)?.fatal) throw e;
        feedback = [(e as Error).message];
        continue;
      }
      const { value, problems } = read(answer, attempt >= ATTEMPTS);
      if (!problems.length) return value;
      feedback = problems;
    }
    throw new Error('The Planner could not write a plan that passes the checks. ' + (feedback || []).join(' '));
  } finally {
    emit('STEP_FINISHED', turn);
  }
}

/** Reads the request and writes the question cards and the draft plan. */
export function askPlanner(request: string, ctl?: PlannerCtl): Promise<PlannerAsk> {
  return ask(
    (f) => askPrompt(request, f),
    (answer, repair) => {
      const value = normAsk(answer, { repair });
      if (!value.reflect) value.reflect = 'Got it: ' + (value.draft.summary || quoted(request));
      return { value, problems: problemsOf(value.draft) };
    },
    ctl,
  );
}

/**
 * The answers the plan is written from. With the cards: every card the owner's answers lead to, answered by them or
 * with its usual choice. Then whatever else the owner said, and what the draft assumed beyond the fixed questions.
 */
function allAnswers(answers: PlanAnswer[], cards: QuestionCard[] | undefined, draft: PlanSpec | null): PlanAnswer[] {
  const mine = answers.filter((a) => a.by === 'you');
  const out = cards ? usualAnswers(cards, mine) : [...mine];
  const has = new Set(out.map((a) => a.slot));
  const fixed: readonly string[] = PLAN_SLOTS;
  const rest = [...mine, ...(draft ? draft.answers : []).filter((a) => !fixed.includes(a.slot) && !cards?.some((c) => c.id === a.slot))];
  for (const a of rest)
    if (!has.has(a.slot)) {
      has.add(a.slot);
      out.push(a.by === 'you' ? a : { ...a, by: 'assumed' });
    }
  return out;
}

/** True when no answer of the owner differs from what the draft was written for. */
function nothingChanged(answers: PlanAnswer[], draft: PlanSpec): boolean {
  const was = new Map(draft.answers.map((a) => [a.slot, a]));
  return answers
    .filter((a) => a.by === 'you')
    .every((a) => {
      const d = was.get(a.slot);
      return !!d && (a.value || d.value ? a.value === d.value : a.answer === d.answer);
    });
}

/**
 * Writes the final plan from the owner's answers. `draft` is what `askPlanner` returned; pass its `cards` too, so a
 * skipped card is answered with its usual choice. When nothing differs from the draft, the draft is the plan.
 */
export async function writePlan(
  request: string,
  answers: PlanAnswer[],
  draft: PlanSpec | null,
  opts: { cards?: QuestionCard[]; ctl?: PlannerCtl } = {},
): Promise<PlanSpec> {
  const all = allAnswers(answers, opts.cards, draft);
  if (draft && nothingChanged(answers, draft)) {
    const same = normPlan(draft, { answers: all });
    if (planOk(same)) return same;
  }
  return ask(
    (f) => planPrompt(request, all, draft, f),
    (answer, repair) => {
      const value = normPlan(answer, { answers: all, repair });
      return { value, problems: problemsOf(value) };
    },
    opts.ctl,
  );
}

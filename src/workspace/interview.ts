import {
  PLAN_LIMITS,
  cardsToAsk,
  demoDataCard,
  nextCard,
  planAnswers,
  previewPlan,
  type CardAnswer,
  type PlanAnswer,
  type PlanList,
  type PlanPatch,
  type PlanSpec,
  type PlanStages,
  type QuestionCard,
} from '@/shared/plan';
import type { Untrusted } from '@/shared/types/app';
import type { Interview } from '@/shared/types/interview';
import type { Dict } from '@/shared/types/workspace';
import { U, errText, label, notify, singular, str } from './core';
import { normBackend, normBrief, normSchema } from './engine';
import { startBuild } from './line';
import type { PlannerCtl } from './planner';
import { REC } from './registry';

/* ===== The interview before a build =====
   Describe, a few question cards (one at a time, each with a usual choice and a skip), then a plan in plain words
   that the owner approves with "Build it". Nothing is built and no app exists until then.

   Where the cards and the plan come from:
   - a saved build (Demo, or no model to call): the build's own question and the demo data choice. The plan is read
     off the saved build with the build line's own normalisers, so it shows exactly what will be built, and it
     changes with the answer because each option carries the plan it leads to.
   - the model (Live): the Planner writes the cards and a draft plan in one call, and the final plan from the answers
     in a second one (src/workspace/planner.ts, reached through PLANNER). Start over stops a call that is still out.
   Either way the plan beside the cards is `previewPlan`: the draft with the answers laid over it, no model call. */

/** The Planner's two calls (src/workspace/planner.ts) as the interview makes them. Tests put their own in. */
export const PLANNER: {
  /** One model call: what was understood, the cards to ask, and the plan for the usual choices. */
  ask: ((request: string, ctl?: PlannerCtl) => Promise<{ reflect: string; cards: QuestionCard[]; draft: PlanSpec }>) | null;
  /** One model call: the plan to approve, from the answers the owner gave (skipped cards are left out), the draft and the cards. */
  write: ((request: string, answers: PlanAnswer[], draft: PlanSpec, cards: QuestionCard[], ctl?: PlannerCtl) => Promise<PlanSpec>) | null;
} = {
  // the Planner and its prompts are loaded when a sentence is first sent, so they stay out of the first page load
  ask: (request, ctl) => import('./planner').then((m) => m.askPlanner(request, ctl)),
  write: (request, answers, draft, cards, ctl) => import('./planner').then((m) => m.writePlan(request, answers, draft, { cards, ctl })),
};
/** The Planner writes the plan for one interview at most this many times; after that the plan is put together from the answers by rule. */
export const MAX_WRITES = 3;

/* ---------- a saved build as a plan ---------- */

const savedMemo: Dict<PlanSpec> = {};
/**
 * The plan of a saved build for one answer to its question: people, lists with their fields, stages, and who can see
 * and do what. Read from the recorded agents' output with the build line's own normalisers, before anything is built.
 */
export function planFromSaved(tpl: string, q: number): PlanSpec {
  const key = tpl + ':' + q;
  if (savedMemo[key]) return savedMemo[key];
  const rec = REC[tpl],
    ctx = { answer: q },
    brief = normBrief(rec.research(ctx, 1) as Untrusted),
    // a saved build may keep a slip in its first attempt for the checks to catch; the second attempt is what gets built
    sc = normSchema(rec.database(ctx, 2) as Untrusted, brief, true),
    be = normBackend(rec.backend(ctx, 1) as Untrusted, { brief, tables: sc.tables, users: sc.users } as Parameters<typeof normBackend>[1]),
    p = be.process;
  const lists: PlanList[] = sc.tables.map((t) => ({
    name: t.name,
    label: t.label || label(t.name),
    one: (t.one || singular(label(t.name))).toLowerCase(),
    what: brief.entities.find((e) => e.name === t.name)?.what || '',
    title: t.title,
    owner: t.owner || null,
    settings: false,
    fields: t.columns.map((c) => ({
      name: c.name,
      label: c.label || label(c.name),
      type: c.type,
      ...(c.required ? { required: true } : {}),
      ...(c.options ? { options: c.options } : {}),
      ...(c.ref ? { ref: c.ref } : {}),
      ...(c.role ? { role: c.role } : {}),
    })),
  }));
  const stages: PlanStages | null =
    p && p.states.length > 1
      ? {
          list: p.table,
          field: p.column,
          // the first stage is where a new record starts
          stages: p.states
            .slice()
            .sort((a, b) => Number(b.id === p.initial) - Number(a.id === p.initial))
            .map((s) => ({ id: s.id, label: s.label || label(s.id) })),
          moves: p.transitions.map((t) => ({ label: t.label || label(t.id), from: t.from, to: t.to, by: t.roles })),
          note: brief.process.note,
        }
      : null;
  return (savedMemo[key] = {
    v: 1,
    name: brief.name,
    summary: brief.summary,
    audience: 'company',
    people: brief.roles.map((r) => ({ id: r.id, name: r.name, can: r.can })),
    lists,
    stages,
    permissions: be.access,
    rules: brief.rules,
    stories: brief.stories,
    demoData: true,
    overview: true,
    helpers: be.team ? be.team.agents.map((a) => a.name).join(', ') : null,
    answers: [],
    notInThisVersion: [],
  });
}

/** The parts of a saved plan that its question can change. */
const leadsOf = (plan: PlanSpec): PlanPatch => ({
  people: plan.people,
  lists: plan.lists,
  stages: plan.stages,
  permissions: plan.permissions,
  rules: plan.rules,
});

/**
 * The interview for a saved build: its own question, if it has one, and the demo data choice. Each option of the
 * question leads to the plan the build replays for that answer.
 */
export function savedInterview(tpl: string): { reflect: string; cards: QuestionCard[]; draft: PlanSpec } {
  const brief = normBrief(REC[tpl].research({ answer: 0 }, 1) as Untrusted),
    q = brief.question,
    cards: QuestionCard[] = [];
  if (q)
    cards.push({
      id: 'q',
      title: q.text,
      why: 'this is the one choice that changes what people can do in this app, and the rules follow your answer.',
      kind: 'one',
      options: q.options.map((o, i) => ({ id: String(i), label: o, desc: '', leads: leadsOf(planFromSaved(tpl, i)) })),
      usual: [String(q.recommended)],
    });
  return { reflect: brief.summary, cards, draft: planFromSaved(tpl, q ? q.recommended : 0) };
}

/* ---------- the interview on the Home tab ---------- */

export const interviewNow = (): Interview | null => U.home.interview || null;
const mine = (iv: Interview) => U.home.interview === iv;
/** The Planner's call that is out for an interview, so that leaving the interview stops it. */
const out = new WeakMap<Interview, PlannerCtl>();
function control(iv: Interview): PlannerCtl {
  const ctl: PlannerCtl = { stop: false, ctrl: typeof AbortController === 'function' ? new AbortController() : null };
  out.set(iv, ctl);
  return ctl;
}
function stopCall(iv: Interview) {
  const ctl = out.get(iv);
  if (!ctl) return;
  ctl.stop = true;
  ctl.ctrl?.abort();
  out.delete(iv);
}

/** The cards as asked: at most five, then the demo data card, which every interview ends with. */
function askable(cards: QuestionCard[]): QuestionCard[] {
  const own = cards.filter((c) => c.id !== 'demo_data' && c.options.length >= 2).slice(0, PLAN_LIMITS.questions);
  return own.concat(cards.find((c) => c.id === 'demo_data') || demoDataCard());
}
/** What was understood, as one sentence. The Planner starts its own with "Got it:", which the opening already says. */
const said = (reflect: string) => {
  const t = str(reflect)
    .replace(/^got it\s*[:.,!]?\s*/i, '')
    .replace(/([^.!?])$/, '$1.');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const opening = (reflect: string, n: number) =>
  'Got it. ' +
  said(reflect) +
  ' ' +
  (n === 1 ? 'One quick question' : 'A few quick questions') +
  ' so I build the right one. Skip ' +
  (n === 1 ? 'it' : 'any of them') +
  " and I'll use the usual choice.";

function open(iv: Interview, got: { reflect: string; cards: QuestionCard[]; draft: PlanSpec }, skip?: boolean) {
  iv.cards = askable(got.cards);
  iv.draft = got.draft;
  iv.reflect = opening(got.reflect, iv.cards.length);
  iv.busy = null;
  iv.error = '';
  if (skip) takeUsual();
  else notify();
}

/**
 * Starts the interview for a sentence. `tpl` names the saved build that stands in when no model builds from it.
 * `skip`: "Skip the questions and use the usual choices", straight to the plan.
 * `sample`: opened by "Try a sample", so the short tour follows "Build it".
 */
export function beginInterview(request: string, tpl: string | null, skip?: boolean, sample?: boolean): Interview {
  const iv: Interview = {
    request,
    tpl,
    step: 'questions',
    busy: tpl ? null : 'asking',
    error: '',
    reflect: '',
    cards: [],
    draft: null,
    answers: {},
    plan: null,
    written: 0,
    editing: null,
    ticks: null,
    ...(sample ? { sample: true } : {}),
  };
  if (U.home.interview) stopCall(U.home.interview);
  U.home.interview = iv;
  U.home.text = '';
  U.home.note = '';
  if (tpl) open(iv, savedInterview(tpl), skip);
  else {
    notify();
    void askPlanner(iv, skip);
  }
  return iv;
}
async function askPlanner(iv: Interview, skip?: boolean) {
  try {
    if (!PLANNER.ask) throw new Error('The Planner is not connected.');
    const got = await PLANNER.ask(iv.request, control(iv));
    if (mine(iv)) open(iv, got, skip);
  } catch (e) {
    if (!mine(iv)) return;
    iv.busy = null;
    iv.error = errText(e);
    notify();
  }
}
/** Asks the Planner again after a failed call: for the cards if there are none yet, otherwise for the plan. */
export function retryPlanner() {
  const iv = interviewNow();
  if (!iv || iv.busy || iv.tpl) return;
  iv.error = '';
  if (iv.draft) return void reviewPlan();
  iv.busy = 'asking';
  notify();
  void askPlanner(iv);
}

/** The card on screen: the one reopened with Change, or the first that applies and has no answer. Null when all are answered. */
export function currentCard(iv: Interview): QuestionCard | null {
  return cardsToAsk(iv.cards, iv.answers).find((c) => c.id === iv.editing) || nextCard(iv.cards, iv.answers);
}
/** The plan to show: the approved-to-be plan on the plan step, otherwise the draft with the answers so far laid over it. */
export const planNow = (iv: Interview): PlanSpec | null =>
  iv.step === 'plan' && iv.plan ? iv.plan : iv.draft ? previewPlan(iv.draft, iv.cards, iv.answers) : null;

const settle = (iv: Interview, id: string, a: CardAnswer) => {
  iv.answers[id] = a;
  iv.editing = null;
  iv.ticks = null;
  iv.plan = null; // the plan follows the answers
  notify();
};
const cardOf = (iv: Interview | null, id: string) =>
  iv && !iv.busy ? cardsToAsk(iv.cards, iv.answers).find((c) => c.id === id) : undefined;
/** The ticks showing on a tick-all card: what the owner ticked so far, their earlier answer, or the usual choice. */
export const ticksOf = (iv: Interview, c: QuestionCard): string[] => iv.ticks || iv.answers[c.id]?.picked || c.usual;
/** Picks an option. On a pick-one card that is the answer; on a tick-all card it ticks or unticks, and Continue answers. */
export function pickOption(cardId: string, optionId: string) {
  const iv = interviewNow(),
    c = cardOf(iv, cardId);
  if (!iv || !c || !c.options.some((o) => o.id === optionId)) return;
  if (c.kind === 'one') return settle(iv, c.id, { picked: [optionId], by: 'you' });
  const t = ticksOf(iv, c);
  iv.ticks = t.includes(optionId) ? t.filter((x) => x !== optionId) : t.concat(optionId);
  notify();
}
export function confirmTicks(cardId: string) {
  const iv = interviewNow(),
    c = cardOf(iv, cardId);
  if (!iv || !c || c.kind !== 'many') return;
  const picked = c.options.map((o) => o.id).filter((id) => ticksOf(iv, c).includes(id));
  if (picked.length) settle(iv, c.id, { picked, by: 'you' });
}
/** An answer in the owner's own words. Only the Planner can read one, so a saved build does not offer it. */
export const takesWords = (iv: Interview) => !iv.tpl;
export function answerInWords(cardId: string, text: string) {
  const iv = interviewNow(),
    c = cardOf(iv, cardId),
    t = str(text).slice(0, 240);
  if (!iv || !c || !takesWords(iv) || !t) return;
  settle(iv, c.id, { picked: [], other: t, by: 'you' });
}
const usualAnswer = (c: QuestionCard): CardAnswer => ({ picked: c.usual.slice(), by: 'usual' });
/** Skip: the usual choice answers the card, and the plan says so under "I assumed". */
export function skipCard(cardId: string) {
  const iv = interviewNow(),
    c = cardOf(iv, cardId);
  if (iv && c) settle(iv, c.id, iv.answers[c.id] || usualAnswer(c));
}
/** "Use the usual choices and show me the plan": every open card gets its usual choice. */
export function takeUsual() {
  const iv = interviewNow();
  if (!iv || iv.busy) return;
  for (let c = nextCard(iv.cards, iv.answers); c; c = nextCard(iv.cards, iv.answers)) iv.answers[c.id] = usualAnswer(c);
  iv.editing = null;
  iv.ticks = null;
  reviewPlan();
}
export function changeAnswer(cardId: string) {
  const iv = interviewNow();
  if (!iv || !cardOf(iv, cardId)) return;
  iv.editing = cardId;
  iv.ticks = null;
  iv.step = 'questions';
  notify();
}
/** Back to the questions from the plan ("Change something"). */
export function backToQuestions() {
  const iv = interviewNow();
  if (!iv || iv.busy) return;
  iv.step = 'questions';
  iv.editing = null;
  notify();
}
/**
 * "Review the plan": after the last answer. A saved build's plan is the draft with the answers laid over it. For a
 * sentence the model builds from, the Planner writes the plan from the answers (one call, at most MAX_WRITES per
 * interview; after that the plan is put together from the answers by rule).
 */
export function reviewPlan() {
  const iv = interviewNow();
  if (!iv || iv.busy || !iv.draft || nextCard(iv.cards, iv.answers)) return;
  iv.editing = null;
  iv.error = '';
  if (iv.plan) {
    iv.step = 'plan';
    return notify();
  }
  const laid = previewPlan(iv.draft, iv.cards, iv.answers);
  if (iv.tpl || !PLANNER.write || iv.written >= MAX_WRITES) {
    iv.plan = laid;
    iv.step = 'plan';
    return notify();
  }
  iv.busy = 'writing';
  iv.written++;
  notify();
  const given = planAnswers(iv.cards, iv.answers).filter((a) => a.by === 'you');
  PLANNER.write(iv.request, given, iv.draft, iv.cards, control(iv)).then(
    (plan) => {
      if (!mine(iv)) return;
      iv.busy = null;
      iv.plan = plan;
      iv.step = 'plan';
      notify();
    },
    (e: unknown) => {
      if (!mine(iv)) return;
      iv.busy = null;
      iv.error = errText(e);
      notify();
    },
  );
}
/** The demo data switch on the plan: the same answer as the card, changed by hand with no model call. */
export function setDemoData(on: boolean) {
  const iv = interviewNow();
  if (!iv || iv.busy) return;
  iv.answers.demo_data = { picked: [on ? 'yes' : 'no'], by: 'you' };
  if (iv.plan) {
    const mark = planAnswers(iv.cards, iv.answers).find((a) => a.slot === 'demo_data');
    iv.plan = { ...iv.plan, demoData: on, answers: iv.plan.answers.filter((a) => a.slot !== 'demo_data').concat(mark || []) };
  }
  notify();
}
/** What runs once a build has started from "Build it". The shell puts the short tour here for "Try a sample". */
export const AFTER_BUILD: { sample: (() => void) | null } = { sample: null };
/** Start over: back to the sentence, which goes back into the box. */
export function leaveInterview() {
  const iv = interviewNow();
  if (!iv) return;
  stopCall(iv);
  U.home.interview = null;
  U.home.text = iv.request;
  notify();
}
/** "Build it": the app is created now, with the approved plan, and the build starts. */
export function buildIt() {
  const iv = interviewNow();
  if (!iv || iv.busy || !iv.plan || iv.step !== 'plan') return null;
  const app = startBuild({ request: iv.request, tpl: iv.tpl, plan: iv.plan });
  if (app) {
    U.home.interview = null;
    notify();
    if (iv.sample) AFTER_BUILD.sample?.();
  }
  return app;
}

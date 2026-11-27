import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPANY_EXPENSES, PERSONAL_EXPENSES, accessRows, previewPlan, slotValue, type PlanSpec, type QuestionCard } from '@/shared/plan';
import { HOME_TEMPLATES, REC } from '@/workspace/builds';
import { U } from '@/workspace/core';
import {
  MAX_WRITES,
  PLANNER,
  answerInWords,
  backToQuestions,
  beginInterview,
  changeAnswer,
  confirmTicks,
  currentCard,
  interviewNow,
  leaveInterview,
  pickOption,
  planFromSaved,
  planNow,
  reviewPlan,
  savedInterview,
  setDemoData,
  skipCard,
  takeUsual,
} from '@/workspace/interview';
import { QUESTS } from '@/workspace/quests';

const SAVED = [...HOME_TEMPLATES, ...QUESTS];
const tick = () => new Promise((r) => setTimeout(r, 0));
const shape = (p: PlanSpec) => ({ people: p.people, lists: p.lists, stages: p.stages, permissions: p.permissions, rules: p.rules });

afterEach(() => {
  U.home.interview = null;
  U.home.text = '';
  PLANNER.ask = null;
  PLANNER.write = null;
});

describe('a saved build as a plan', () => {
  it('every saved build has a plan before anything is built: its name, its people and its lists', () => {
    for (const id of SAVED) {
      const plan = planFromSaved(id, 0);
      expect(plan.name, id).toBeTruthy();
      expect(plan.people.length, id).toBeGreaterThan(0);
      expect(plan.lists.length, id).toBeGreaterThan(0);
      expect(
        plan.lists.some((l) => l.name === 'users'),
        id,
      ).toBe(false);
      expect(
        plan.lists.every((l) => l.fields.length > 0),
        id,
      ).toBe(true);
      expect(Object.keys(plan.permissions).sort(), id).toEqual(plan.lists.map((l) => l.name).sort());
      if (plan.stages)
        expect(
          plan.lists.some((l) => l.name === plan.stages?.list),
          id,
        ).toBe(true);
    }
  });

  it('the clinic reads as three kinds of people, three lists and the path of an appointment', () => {
    const plan = planFromSaved('clinic', 0);
    expect(plan.name).toBe('CareDesk');
    expect(plan.people.map((p) => p.name)).toEqual(['Receptionist', 'Doctor', 'Clinic manager']);
    expect(plan.lists.map((l) => l.label)).toEqual(['Patients', 'Appointments', 'Visit notes']);
    expect(plan.stages?.stages.map((s) => s.label).slice(0, 2)).toEqual(['Booked', 'Checked in']);
    expect(plan.demoData).toBe(true);
  });

  it('asks the build’s own question as one card, with the recorded recommendation as the usual choice', () => {
    for (const id of SAVED) {
      const q = (REC[id].research({ answer: 0 }, 1) as { question?: { text: string; options: string[]; recommended?: number } | null })
        .question;
      const { cards, draft } = savedInterview(id);
      if (!q) {
        expect(cards, id).toEqual([]);
        continue;
      }
      expect(
        cards.map((c) => c.id),
        id,
      ).toEqual(['q']);
      expect(cards[0].title, id).toBe(q.text);
      expect(
        cards[0].options.map((o) => o.label),
        id,
      ).toEqual(q.options);
      expect(cards[0].usual, id).toEqual([String(q.recommended ?? 0)]);
      expect(shape(draft), id).toEqual(shape(planFromSaved(id, q.recommended ?? 0)));
    }
  });

  it('each option leads to the plan that answer builds, so the plan beside the card follows the answer', () => {
    for (const id of SAVED) {
      const { cards, draft } = savedInterview(id);
      if (!cards.length) continue;
      cards[0].options.forEach((o, i) => {
        const plan = previewPlan(draft, cards, { q: { picked: [o.id], by: 'you' } });
        expect(shape(plan), id + ' ' + i).toEqual(shape(planFromSaved(id, i)));
        expect(slotValue(plan, 'q'), id).toBe(String(i));
      });
    }
    const { cards, draft } = savedInterview('clinic');
    const see = (plan: PlanSpec) => accessRows(plan).filter((r) => /^See /.test(r.what) && /visit notes/.test(r.what))[0].cells[0].text;
    expect(see(previewPlan(draft, cards, { q: { picked: ['0'], by: 'you' } }))).toBe('No');
    expect(see(previewPlan(draft, cards, { q: { picked: ['1'], by: 'you' } }))).toBe('All');
  });
});

describe('the interview for a saved build', () => {
  it('opens on the question with no plan approved, and nothing else changes until an answer', () => {
    const iv = beginInterview(REC.leave.sentence, 'leave');
    expect(interviewNow()).toBe(iv);
    expect(iv.step).toBe('questions');
    expect(iv.busy).toBeNull();
    expect(currentCard(iv)?.id).toBe('q');
    expect(iv.plan).toBeNull();
    expect(planNow(iv)?.name).toBe('TimeOff');
    expect(iv.cards.map((c) => c.id)).toEqual(['q', 'demo_data']); // the build's own question, then the demo data choice
    expect(iv.reflect).toMatch(/^Got it\. .*A few quick questions/);
  });

  it('an answer ends the questions, Review shows the plan with the answer kept as the owner’s', () => {
    const iv = beginInterview(REC.leave.sentence, 'leave');
    pickOption('q', '1');
    expect(currentCard(iv)?.id).toBe('demo_data');
    reviewPlan(); // not before the last card is answered
    expect(iv.step).toBe('questions');
    pickOption('demo_data', 'yes');
    expect(currentCard(iv)).toBeNull();
    expect(iv.step).toBe('questions');
    reviewPlan();
    expect(iv.step).toBe('plan');
    expect(iv.plan?.answers[0]).toMatchObject({ slot: 'q', value: '1', by: 'you', answer: currentLabel(iv.cards[0], '1') });
    expect(shape(iv.plan!)).toEqual(shape(planFromSaved('leave', 1)));
  });

  it('Skip uses the usual choice and the plan says it was assumed', () => {
    const iv = beginInterview(REC.leave.sentence, 'leave');
    skipCard('q');
    skipCard('demo_data');
    reviewPlan();
    expect(iv.plan?.demoData).toBe(true);
    expect(iv.plan?.answers[0]).toMatchObject({ slot: 'q', value: iv.cards[0].usual[0], by: 'assumed' });
  });

  it('"Skip the questions" goes straight to the plan with every usual choice', () => {
    const iv = beginInterview(REC.leave.sentence, 'leave', true);
    expect(iv.step).toBe('plan');
    expect(iv.plan?.answers.map((a) => a.slot + ':' + a.by)).toEqual(['q:assumed', 'demo_data:assumed']);
    expect(iv.plan?.demoData).toBe(true);
  });

  it('a saved build with no question of its own still asks about demo data', () => {
    const none = beginInterview(REC.grants.sentence, 'grants');
    expect(none.cards.map((c) => c.id)).toEqual(['demo_data']);
    expect(none.step).toBe('questions');
    expect(none.reflect).toMatch(/One quick question/);
  });

  it('Change reopens a card, and a new answer takes the approved plan away until it is reviewed again', () => {
    const iv = beginInterview(REC.leave.sentence, 'leave');
    takeUsual();
    expect(iv.step).toBe('plan');
    changeAnswer('q');
    expect(iv.step).toBe('questions');
    expect(currentCard(iv)?.id).toBe('q');
    const other = iv.cards[0].options.find((o) => !iv.cards[0].usual.includes(o.id))!.id;
    pickOption('q', other);
    expect(iv.plan).toBeNull();
    reviewPlan();
    expect(iv.plan?.answers[0]).toMatchObject({ value: other, by: 'you' });
    backToQuestions();
    expect(iv.step).toBe('questions');
    expect(iv.plan).not.toBeNull(); // looking back changes nothing
  });

  it('does not take an answer in the owner’s own words, since no model reads it', () => {
    const iv = beginInterview(REC.leave.sentence, 'leave');
    answerInWords('q', 'Whoever is in on Friday');
    expect(iv.answers.q).toBeUndefined();
  });

  it('asks about demo data last, as a card, and offers the same choice as a switch on the plan', () => {
    const iv = beginInterview(REC.leave.sentence, 'leave');
    expect(planNow(iv)?.demoData).toBe(true);
    pickOption('q', '0');
    expect(currentCard(iv)?.id).toBe('demo_data');
    pickOption('demo_data', 'no');
    reviewPlan();
    expect(iv.plan?.demoData).toBe(false);
    setDemoData(true);
    expect(iv.plan?.demoData).toBe(true);
    expect(iv.plan?.answers.find((a) => a.slot === 'demo_data')).toMatchObject({ value: 'yes', by: 'you' });
    expect(iv.step).toBe('plan');
  });

  it('Start over leaves the interview and puts the sentence back in the box', () => {
    beginInterview(REC.leave.sentence, 'leave');
    expect(U.home.text).toBe('');
    leaveInterview();
    expect(interviewNow()).toBeNull();
    expect(U.home.text).toBe(REC.leave.sentence);
  });
});

const currentLabel = (card: QuestionCard, id: string) => card.options.find((o) => o.id === id)!.label;

/** The Planner as the interview sees it: three cards over the company expenses plan. */
const CARDS: QuestionCard[] = [
  {
    id: 'audience',
    title: 'Who is this for?',
    why: 'it decides whether the app needs approvals.',
    kind: 'one',
    usual: ['company'],
    options: [
      {
        id: 'just_me',
        label: 'Just me',
        desc: '',
        leads: {
          audience: 'just_me',
          people: PERSONAL_EXPENSES.people,
          lists: PERSONAL_EXPENSES.lists,
          stages: null,
          permissions: PERSONAL_EXPENSES.permissions,
        },
      },
      { id: 'company', label: 'A company or team', desc: '' },
    ],
  },
  {
    id: 'people',
    title: 'Who does what?',
    why: 'each kind of person gets their own screens.',
    kind: 'many',
    usual: ['employee', 'manager', 'finance'],
    onlyIf: { card: 'audience', anyOf: ['company'] },
    options: COMPANY_EXPENSES.people.map((p) => ({ id: p.id, label: p.name, desc: p.can, leads: { people: [p] } })),
  },
  {
    id: 'demo_data',
    title: 'Would you like demo data?',
    why: 'an empty app is hard to judge.',
    kind: 'one',
    usual: ['yes'],
    options: [
      { id: 'yes', label: 'Yes', desc: '' },
      { id: 'no', label: 'No', desc: '' },
    ],
  },
];

describe('the interview for a sentence the model builds from', () => {
  const plug = () => {
    const ask = vi.fn(async () => ({ reflect: 'People claim expenses and someone approves them', cards: CARDS, draft: COMPANY_EXPENSES }));
    const write = vi.fn(async (_request: string, _answers: unknown, draft: PlanSpec) => ({ ...draft, name: 'Written' }));
    PLANNER.ask = ask;
    PLANNER.write = write;
    return { ask, write };
  };

  it('asks the Planner once for the cards and the draft, and shows it is busy meanwhile', async () => {
    const { ask } = plug();
    const iv = beginInterview('an expense app', null);
    expect(iv.busy).toBe('asking');
    await tick();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(iv.busy).toBeNull();
    expect(iv.cards.map((c) => c.id)).toEqual(['audience', 'people', 'demo_data']);
    expect(planNow(iv)?.people).toHaveLength(3);
  });

  it('redraws the plan after each answer with no call, and drops the cards an answer makes pointless', async () => {
    const { ask, write } = plug();
    const iv = beginInterview('an expense app', null);
    await tick();
    pickOption('audience', 'just_me');
    expect(planNow(iv)?.people.map((p) => p.name)).toEqual(['You']);
    expect(currentCard(iv)?.id).toBe('demo_data'); // the people card is not asked of one person
    changeAnswer('audience');
    pickOption('audience', 'company');
    expect(currentCard(iv)?.id).toBe('people');
    pickOption('people', 'finance'); // unticks one of the usual three
    expect(iv.answers.people).toBeUndefined();
    confirmTicks('people');
    expect(planNow(iv)?.people.map((p) => p.id)).toEqual(['employee', 'manager']);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  it('the Planner writes the plan from the answers the owner gave; skipped cards are left for it to fill', async () => {
    const { write } = plug();
    const iv = beginInterview('an expense app', null);
    await tick();
    pickOption('audience', 'company');
    skipCard('people');
    skipCard('demo_data');
    reviewPlan();
    expect(iv.busy).toBe('writing');
    await tick();
    expect(iv.step).toBe('plan');
    expect(iv.plan?.name).toBe('Written');
    const [request, answers, draft, cards] = write.mock.calls[0] as unknown as [
      string,
      { slot: string; by: string }[],
      PlanSpec,
      QuestionCard[],
    ];
    expect(request).toBe('an expense app');
    expect(answers.map((a) => a.slot + ':' + a.by)).toEqual(['audience:you']);
    expect(draft).toBe(COMPANY_EXPENSES);
    expect(cards.map((c) => c.id)).toEqual(['audience', 'people', 'demo_data']);
  });

  it('takes an answer in the owner’s own words and hands it to the Planner', async () => {
    const { write } = plug();
    const iv = beginInterview('an expense app', null);
    await tick();
    answerInWords('audience', 'My football club');
    expect(currentCard(iv)?.id).toBe('demo_data'); // the card that hangs on it is not asked
    skipCard('demo_data');
    reviewPlan();
    await tick();
    expect((write.mock.calls[0] as unknown as [string, { answer: string; value?: string }[]])[1][0]).toMatchObject({
      answer: 'My football club',
    });
  });

  it('says in plain words why the Planner failed, and writes the plan at most three times', async () => {
    plug();
    PLANNER.ask = async () => {
      throw new Error('No model is connected.');
    };
    let iv = beginInterview('an expense app', null);
    await tick();
    expect(iv.error).toBe('No model is connected.');
    expect(iv.busy).toBeNull();

    const { write } = plug();
    iv = beginInterview('an expense app', null, true);
    await tick();
    await tick();
    expect(iv.step).toBe('plan');
    for (let i = 0; i < MAX_WRITES + 2; i++) {
      changeAnswer('audience');
      pickOption('audience', i % 2 ? 'company' : 'just_me');
      if (currentCard(iv)) skipCard('people');
      reviewPlan();
      await tick();
      expect(iv.step).toBe('plan');
    }
    expect(write).toHaveBeenCalledTimes(MAX_WRITES);
    expect(iv.plan?.name).toBe(COMPANY_EXPENSES.name); // past the cap the plan is the draft with the answers laid over it
  });

  it('an answer from a call that came back after Start over is dropped', async () => {
    plug();
    beginInterview('an expense app', null);
    leaveInterview();
    await tick();
    expect(interviewNow()).toBeNull();
  });
});

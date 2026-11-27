/**
 * The plan: what the Planner writes from the owner's sentence and their answers, and what the owner approves before
 * anything is built. Every part of the guided build reads this one object: the question cards fill `answers`, the plan
 * card shows it, the build picks its team from it (`teamFor`), the Database agent is held to `lists`, and the demo
 * data and first-run features read `demoData`, `settings` and `stories`.
 *
 * Words: the owner sees "kinds of people", "lists", "records", "stages" and "demo data". The code keeps the short
 * names below. Pure types and constants, usable on the server and in the browser.
 */
import type { ColumnType } from '@/shared/sql/types';
import type { AccessMap, Story } from '@/shared/types/app';

/** Who the app is for. Decides whether it needs sign-ins, approvals and access rules at all. */
export const AUDIENCES = ['just_me', 'group', 'company'] as const;
export type Audience = (typeof AUDIENCES)[number];

/**
 * The questions the team selection depends on. A question card that fills one of these must use the slot's name, and
 * for a picked option the value below. Any other card (currency, budgets and so on) may use its own slot name: the
 * Planner reads it as free text.
 */
export const PLAN_SLOTS = ['audience', 'people', 'approval', 'visibility', 'demo_data'] as const;
export type PlanSlot = (typeof PLAN_SLOTS)[number];

/** The option ids of the slots that have fixed options. `people` is a checklist, so it has none. */
export const SLOT_VALUES = {
  audience: AUDIENCES,
  /** no approval, one approval, or an approval and then a second step (for example Finance pays) */
  approval: ['none', 'one', 'two'],
  /** people see only their own records, or everyone sees every record */
  visibility: ['own', 'all'],
  demo_data: ['yes', 'no'],
} as const satisfies Partial<Record<PlanSlot, readonly string[]>>;

/** What a plan may hold. The runtime's own limits (`LIMITS` in src/shared/sql/types.ts) are a little wider. */
export const PLAN_LIMITS = {
  people: { min: 1, max: 4 },
  lists: { min: 1, max: 6 },
  fields: { min: 2, max: 10 },
  stages: { min: 3, max: 7 },
  /** question cards before the plan, not counting the demo data card */
  questions: 5,
} as const;

/** A kind of person who uses the app. Same shape as a `Role` of the brief. */
export interface PlanPerson {
  /** snake_case id */
  id: string;
  /** "Employee", "Manager"; for a one-person app, "You" */
  name: string;
  /** what they do, in a sentence */
  can: string;
}

/** A field of a list, in the runtime's ten field types. */
export interface PlanField {
  /** snake_case */
  name: string;
  label: string;
  type: ColumnType;
  required?: boolean;
  /** type `select`: the choices, snake_case */
  options?: string[];
  /** type `ref`: the list this field points to */
  ref?: string;
  /** type `user`: limit the person to one kind of person */
  role?: string;
}

/** A list of records the app keeps. */
export interface PlanList {
  /** snake_case, plural: `claims` */
  name: string;
  /** "Claims" */
  label: string;
  /** what one record is called: "claim" */
  one: string;
  /** what the list is for, in a sentence */
  what: string;
  /** the field shown as a record's name */
  title: string;
  /** the person field that says whose record it is; "only their own" rules need it */
  owner: string | null;
  /** starter settings (categories, limits, teams): real from day one, kept when the demo data is removed */
  settings: boolean;
  fields: PlanField[];
}

/** One stage a record can be in. */
export interface PlanStage {
  /** snake_case */
  id: string;
  label: string;
}

/** Who may move a record from one stage to another. */
export interface PlanMove {
  /** the words on the button: "Approve" */
  label: string;
  from: string[];
  to: string;
  /** ids of the kinds of people who may do it */
  by: string[];
}

/** How a record moves. An app has one of these or none: a personal tracker has no approval steps. */
export interface PlanStages {
  /** the list whose records move */
  list: string;
  /** the choice field of that list that holds the stage; its options are the stage ids */
  field: string;
  /** in order; the first is where a new record starts */
  stages: PlanStage[];
  moves: PlanMove[];
  /** the path in a sentence: "The Employee submits. The Manager approves…" */
  note: string;
}

/** One answer the plan was written from. */
export interface PlanAnswer {
  /** a `PlanSlot`, or the card's own name */
  slot: string;
  question: string;
  /** the answer in words, as shown back to the owner */
  answer: string;
  /** the option id, when an option of the card was picked (see `SLOT_VALUES`) */
  value?: string;
  /** `assumed`: nobody answered, so the Planner took the usual choice. Shown under "I assumed" with Change. */
  by: 'you' | 'assumed';
}

/** Something the owner asked for or would expect that the runtime cannot do yet, and what they get instead. */
export interface PlanGap {
  ask: string;
  instead: string;
}

export interface PlanSpec {
  /** format version */
  v: 1;
  name: string;
  /** one sentence: what the app does and for whom */
  summary: string;
  audience: Audience;
  /** the kinds of people, 1 to 4 */
  people: PlanPerson[];
  /** the lists with their fields, 1 to 6 */
  lists: PlanList[];
  stages: PlanStages | null;
  /** who can see and do what: by list name, then by person id */
  permissions: AccessMap;
  /** the same rules in plain sentences, for the plan card */
  rules: string[];
  /** what each kind of person wants to do; the tests and each person's welcome are written from these */
  stories: Story[];
  /** start with made-up records and people, marked as demo data and removable in one action */
  demoData: boolean;
  /** an overview screen with numbers and charts */
  overview: boolean;
  /** an agent team inside the finished app: what it should do, or null for none */
  helpers: string | null;
  answers: PlanAnswer[];
  notInThisVersion: PlanGap[];
}

/* ---------- the question cards ---------- */

/** Parts of a plan that an answer replaces. The plan beside the cards is redrawn from these with no model call. */
export type PlanPatch = Partial<
  Pick<PlanSpec, 'audience' | 'people' | 'lists' | 'stages' | 'permissions' | 'rules' | 'demoData' | 'overview'>
>;

export interface QuestionOption {
  /** for a slot with fixed options, one of `SLOT_VALUES` */
  id: string;
  label: string;
  /** one line under the label: what picking it means */
  desc: string;
  /** what the plan becomes when this option is picked */
  leads?: PlanPatch;
}

/** One question the owner is asked before the plan is written. At most `PLAN_LIMITS.questions`, plus the demo data card. */
export interface QuestionCard {
  /** the slot it fills: a `PlanSlot`, or the card's own name */
  id: string;
  title: string;
  /** "Why I'm asking": one sentence */
  why: string;
  /** pick one option, or tick several */
  kind: 'one' | 'many';
  options: QuestionOption[];
  /** the option ids of the usual choice: what a skipped card is answered with */
  usual: string[];
  /** ask this card only when an earlier card was answered with one of these options */
  onlyIf?: { card: string; anyOf: string[] };
}

/* ---------- the team, picked from the plan by code ---------- */

/**
 * The steps of a build, by the id of their station on the build line (`STATIONS` in src/workspace/line.ts), then the
 * tests. Every build has all of them; the plan decides who does each one.
 */
export const PLAN_STEPS = ['research', 'database', 'backend', 'views', 'screens', 'walkthrough', 'tests'] as const;
export type PlanStepId = (typeof PLAN_STEPS)[number];

/** An agent does the step, or Turnkey's own rules do it with no model call. */
export type StepBy = 'agent' | 'code';

export interface PlannedStep {
  id: PlanStepId;
  /** "Set up the lists" */
  name: string;
  by: StepBy;
  /** the agent's id in the workspace registry (`AGENTS`), when an agent does it */
  agent: string | null;
  /** the agent's plain name ("List builder"), or "Turnkey" when code does it */
  who: string;
  /** one plain sentence: what it does on this build, and why it is done this way */
  why: string;
}

/** A review the plan adds on its own, by an agent that reads another agent's work. */
export interface PlannedReview {
  /** the reviewer's id in the workspace library (`REVIEWERS`) */
  id: string;
  /** the reviewer's plain name ("Access checker") */
  who: string;
  /** the step it reads */
  after: PlanStepId;
  why: string;
}

/** A place where the build stops for the owner. */
export interface PlannedPause {
  after: PlanStepId;
  why: string;
}

/** An agent of the catalog that this build does not need, and why. */
export interface NotNeeded {
  /** an id in `AGENTS` or `REVIEWERS` */
  agent: string;
  who: string;
  why: string;
}

export interface PlanTeam {
  steps: PlannedStep[];
  reviews: PlannedReview[];
  pauses: PlannedPause[];
  notNeeded: NotNeeded[];
  /** how many different agents work on this build, reviewers included */
  agents: number;
}

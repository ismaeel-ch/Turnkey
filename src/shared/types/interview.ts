/**
 * The interview on the Home tab (src/workspace/interview.ts): from "Continue" on the sentence, through the question
 * cards, to the plan the owner approves with "Build it". It is view state: no app exists until "Build it".
 */
import type { CardAnswer, PlanSpec, QuestionCard } from '@/shared/plan';

export interface Interview {
  request: string;
  /** the saved build that stands in for the model, or null when the model builds from the sentence */
  tpl: string | null;
  step: 'questions' | 'plan';
  /** what the Planner is doing right now: writing the cards, or writing the plan from the answers */
  busy: 'asking' | 'writing' | null;
  /** why the Planner's last call failed, in plain words */
  error: string;
  /** what was understood, said back before the first question */
  reflect: string;
  cards: QuestionCard[];
  /** the plan for the usual choices; the plan beside the cards is this with the answers laid over it */
  draft: PlanSpec | null;
  /** answers by card id */
  answers: Record<string, CardAnswer>;
  /** the plan to approve; null until the last answer is in, and again after an answer changes */
  plan: PlanSpec | null;
  /** how many times the Planner wrote the plan for this interview */
  written: number;
  /** the card reopened with "Change" */
  editing: string | null;
  /** ticks on a "tick all that apply" card before Continue */
  ticks: string[] | null;
  /** opened by "Try a sample" on the first screen: a short tour follows "Build it" */
  sample?: boolean;
}

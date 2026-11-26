/**
 * The contract for agent `step`: one Turnkey agent prompt in, one checked JSON answer out.
 *
 * Owned by agent-graphs. agui-stream (the AG-UI bridge), team-graph and integration build against this file.
 * Safe for browser and server code: it holds types, constants and zod schemas only.
 *
 * How it travels over AG-UI (agent id `step` at /api/copilotkit):
 *   RunAgentInput.forwardedProps = StepInput                 (parse it with `parseStepInput`)
 *   events, in order:
 *     RUN_STARTED
 *     per attempt:  STEP_STARTED/STEP_FINISHED with stepName in STEP_NAMES, in graph order
 *                   TEXT_MESSAGE_START/CONTENT/END for the draft step, messageId `draft-<attempt>`
 *                   CUSTOM name `issues` with value { attempt, issues } when validation fails
 *     RUN_FINISHED with result = StepResult      or      RUN_ERROR with code a StepErrorCode
 * The graph itself emits the neutral `StepEvent` below to an `EventSink`; the bridge maps each one to the AG-UI
 * event named in its comment.
 */
import { z } from 'zod';

export const STEP_AGENT_ID = 'step';

/** Which JSON shape the answer must have. Leave out `role` and the server works it out from the prompt. */
export const STEP_ROLES = [
  'research', // Researcher: the brief
  'database', // Database: tables, seed rows, users
  'backend', // Backend: workflow, access rules, optional agent team
  'views', // View advisor: views per table, dashboard, optional board
  'screens', // UI: theme, screens, tour
  'walkthrough', // UI, second pass: a corrected tour
  'tester', // Tester: test cases
  'qa_repair', // Backend, after failed tests: fixes in plain words
  'review', // a review step (data, security, insight, or one the owner added): findings
  'change', // Orchestrator, a chat request turned into operations
  'team', // an app's own agent: its rows, updates and summary
  'any', // any one JSON object, no shape check
] as const;
export type StepRole = (typeof STEP_ROLES)[number];

export const MAX_ATTEMPTS = 3;
export const MAX_PROMPT_CHARS = 120_000;

export const stepInputSchema = z.object({
  /** One of Turnkey's agent prompts, exactly as the browser builds it. */
  prompt: z.string().trim().min(1, 'the prompt is empty').max(MAX_PROMPT_CHARS, 'the prompt is too long'),
  /** `default` is the careful model, `quick` the cheap one. */
  tier: z.enum(['default', 'quick']).default('default'),
  role: z.enum(STEP_ROLES).optional(),
  /** Model calls allowed for this step, the first draft included. Never more than MAX_ATTEMPTS. */
  maxAttempts: z.number().int().min(1).max(MAX_ATTEMPTS).default(MAX_ATTEMPTS),
});
export type StepInput = z.input<typeof stepInputSchema>;
export type ParsedStepInput = z.output<typeof stepInputSchema>;

export function parseStepInput(value: unknown): { ok: true; input: ParsedStepInput } | { ok: false; message: string } {
  const r = stepInputSchema.safeParse(value);
  if (r.success) return { ok: true, input: r.data };
  return { ok: false, message: r.error.issues.map((i) => (i.path.length ? i.path.join('.') + ': ' : '') + i.message).join('; ') };
}

/** The graph's nodes, in order. `repair` appears only when an attempt failed its check. */
export const STEP_NAMES = ['guard', 'draft', 'validate', 'repair', 'finish'] as const;
export type StepName = (typeof STEP_NAMES)[number];

export type StepErrorCode =
  | 'bad_request' // the input is not valid
  | 'not_configured' // no model provider is set up
  | 'rate_limited'
  | 'budget'
  | 'unauthorized'
  | 'upstream' // the model call failed
  | 'aborted' // the caller cancelled
  | 'truncated' // the last answer was cut off before its JSON ended
  | 'invalid_output'; // no valid answer within the attempt cap

/** The final result, carried by RUN_FINISHED. `text` is exactly one JSON object, with no fences and no prose. */
export type StepResult = {
  text: string;
  role: StepRole;
  /** Model calls used. 1 means the first draft was valid. */
  attempts: number;
  repaired: boolean;
  /** True when the model reported a cut-off but the JSON was complete and valid anyway. */
  truncated: boolean;
};

export type StepError = {
  code: StepErrorCode;
  message: string;
  attempts: number;
  /** What the last check found, for `invalid_output` and `truncated`. */
  issues: string[];
};

/** What the graph emits while it runs. */
export type StepEvent =
  | { type: 'step_started'; step: StepName; attempt: number } // STEP_STARTED
  | { type: 'step_finished'; step: StepName; attempt: number } // STEP_FINISHED
  | { type: 'draft_started'; attempt: number; messageId: string } // TEXT_MESSAGE_START
  | { type: 'draft_text'; attempt: number; messageId: string; text: string } // TEXT_MESSAGE_CONTENT, one model delta
  | { type: 'draft_ended'; attempt: number; messageId: string } // TEXT_MESSAGE_END
  | { type: 'issues'; attempt: number; issues: string[] } // CUSTOM `issues`
  | { type: 'result'; result: StepResult } // RUN_FINISHED
  | { type: 'error'; error: StepError }; // RUN_ERROR

export type EventSink = (event: StepEvent) => void;

/** The agent as the runtime registry holds it. agui-stream wraps `run` in its AG-UI agent class. */
export interface StepAgent {
  readonly id: typeof STEP_AGENT_ID;
  run(input: StepInput, options?: { sink?: EventSink; signal?: AbortSignal }): Promise<{ result: StepResult } | { error: StepError }>;
}

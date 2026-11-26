/**
 * What goes in and what comes out of a team run. Server only.
 *
 * The team definition is the one the workspace saves in `def.team` (see src/workspace/team.tsx, `normTeam`). The browser
 * owns the app's database, so the server never writes rows itself: each agent's answer comes back as events and as
 * an output object, and the workspace applies it through the app's own API exactly as the prototype does.
 */
import { z } from 'zod';

const text = (max: number) => z.string().max(max);
const id = z.string().min(1).max(60);

export const ColumnSchema = z.object({
  name: id,
  type: z.enum(['text', 'longtext', 'number', 'money', 'date', 'datetime', 'bool', 'select', 'ref', 'user']),
  options: z.array(text(80)).max(30).optional(),
  ref: id.optional(),
});
export const TableSchema = z.object({ name: id, one: text(60).optional(), columns: z.array(ColumnSchema).min(1).max(40) });

export const AgentSpecSchema = z.object({
  id,
  name: text(60),
  job: text(600).default(''),
  hint: text(600).default(''),
  /** the table whose new rows this agent writes */
  writes: id.nullish(),
  /** the table whose rows this agent updates, by their number in the run */
  updates: id.nullish(),
  /** columns of the input row this agent fills in at the end of its turn */
  sets: z.array(id).max(12).default([]),
  /** values added to every row it writes, not asked of the model */
  fixed: z.record(z.string(), z.unknown()).default({}),
  tools: z
    .array(z.object({ connector: id, tool: id }))
    .max(6)
    .default([]),
});

export const TeamSpecSchema = z.object({
  title: text(100).default('Agent team'),
  about: text(600).default(''),
  agents: z.array(AgentSpecSchema).min(2).max(4),
  /** the run stops before this agent so a person can add a point */
  pause: z.object({ before: id, text: text(300).default('Add something before the next agent runs, or continue.') }).nullish(),
});

export const NoteSchema = z.object({ who: text(60), text: text(1500) });

export const TeamLimitsSchema = z.object({
  /** tool calls one agent may make in one turn */
  toolCallsPerAgent: z.number().int().min(0).max(6).default(3),
  /** node visits in the whole graph, sent-back turns included */
  maxSteps: z.number().int().min(4).max(80).default(40),
  /** model calls in the whole run */
  maxModelCalls: z.number().int().min(2).max(60).default(26),
  /** milliseconds after which the run ends, well under the five-minute request limit */
  maxMillis: z.number().int().min(5_000).max(270_000).default(230_000),
});
export type TeamLimits = z.infer<typeof TeamLimitsSchema>;

export const SnapshotSchema = z.object({
  values: z.record(z.string(), z.unknown()),
  asNode: z.string().max(80),
  /** what the run used before it paused, so a resumed run cannot start its caps over */
  used: z.object({ steps: z.number().int().min(0), calls: z.number().int().min(0) }).optional(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const TeamRequestSchema = z.object({
  runId: text(80).optional(),
  appName: text(120).default('this app'),
  team: TeamSpecSchema,
  /** the table and column the run starts from, with the text the person gave */
  input: z.object({ table: id, column: id, text: text(8000), row: z.record(z.string(), z.unknown()).default({}) }),
  /** the tables the agents write, so each answer can be checked against their columns */
  tables: z.array(TableSchema).max(12),
  notes: z.array(NoteSchema).max(10).default([]),
  /** ask a reviewer model to look at each agent's work. Rule checks always run. */
  review: z.boolean().default(true),
  limits: TeamLimitsSchema.partial().default({}),
  /** continue a run that stopped at the pause: the state the pause event carried, and what the person added */
  resume: z.object({ snapshot: SnapshotSchema, note: NoteSchema.nullish() }).nullish(),
});
export type TeamRequest = z.infer<typeof TeamRequestSchema>;
export type AgentSpec = z.infer<typeof AgentSpecSchema>;
export type TableSpec = z.infer<typeof TableSchema>;
export type Note = z.infer<typeof NoteSchema>;

/** One agent's finished work. The workspace turns it into rows through the app's API. */
export type AgentOutput = {
  say: string;
  rows: Record<string, unknown>[];
  update: Record<string, unknown>[];
  summary: Record<string, unknown> | null;
};

export type TeamStatus = 'done' | 'paused' | 'capped' | 'failed' | 'stopped';

/** The events a run emits. Same names and fields as AG-UI, so the stream layer can pass them on as they are. */
export type TeamEvent =
  | { type: 'RUN_STARTED'; threadId: string; runId: string }
  | { type: 'RUN_FINISHED'; threadId: string; runId: string; result: { status: TeamStatus; reason?: string } }
  | { type: 'RUN_ERROR'; message: string; code?: string }
  | { type: 'STEP_STARTED'; stepName: string }
  | { type: 'STEP_FINISHED'; stepName: string }
  | { type: 'TEXT_MESSAGE_START'; messageId: string; role: 'assistant' }
  | { type: 'TEXT_MESSAGE_CONTENT'; messageId: string; delta: string }
  | { type: 'TEXT_MESSAGE_END'; messageId: string }
  | { type: 'TOOL_CALL_START'; toolCallId: string; toolCallName: string; parentMessageId?: string }
  | { type: 'TOOL_CALL_ARGS'; toolCallId: string; delta: string }
  | { type: 'TOOL_CALL_END'; toolCallId: string }
  | { type: 'TOOL_CALL_RESULT'; messageId: string; toolCallId: string; content: string; role: 'tool' }
  | { type: 'STATE_DELTA'; delta: { op: 'add' | 'replace'; path: string; value: unknown }[] }
  | { type: 'CUSTOM'; name: 'check' | 'interrupt' | 'resume' | 'cap'; value: Record<string, unknown> };

/** Where events go. The stream layer provides one; tests collect them in an array. */
export interface EventSink {
  emit(event: TeamEvent): void;
}

/**
 * The agent-step graph: one Turnkey agent prompt in, one checked JSON answer out.
 *
 *   START → guard → draft → validate → finish → END
 *                     ↑         │
 *                     └─ repair ┘      (validate fails and attempts are left)
 *
 * `guard` checks the input and the provider, `draft` calls the model and streams its text, `validate` finds the JSON
 * object like the browser does and checks it against the role's schema, `repair` adds the exact failures to the
 * conversation, `finish` settles the result or the error (the agent wrapper then emits it as the last event). At most `maxAttempts` model calls (never more than 3).
 * Runtime options travel in the run config: `configurable.sink` (events) and `signal` (cancel).
 */
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import { issuesOf } from '@/server/agents/schemas';
import { parseJSONLoose } from '@/server/agents/json';
import { detectRole, repairNote } from '@/server/agents/registry';
import { LlmError, resolveProvider, type ChatMessage, type Provider } from '@/server/llm';
import {
  MAX_ATTEMPTS,
  parseStepInput,
  type EventSink,
  type StepError,
  type StepErrorCode,
  type StepName,
  type StepResult,
  type StepRole,
} from '@/shared/agent-contract';

const lastValue = <T>(initial: () => T) => Annotation<T>({ reducer: (_old, next) => next, default: initial });

export const StepState = Annotation.Root({
  input: lastValue<unknown>(() => null),
  prompt: lastValue<string>(() => ''),
  tier: lastValue<'default' | 'quick'>(() => 'default'),
  role: lastValue<StepRole>(() => 'any'),
  maxAttempts: lastValue<number>(() => MAX_ATTEMPTS),
  attempt: lastValue<number>(() => 0),
  messages: lastValue<ChatMessage[]>(() => []),
  drafted: lastValue<string>(() => ''),
  truncated: lastValue<boolean>(() => false),
  /** the JSON object text once an attempt passed */
  answer: lastValue<string | null>(() => null),
  issues: lastValue<string[]>(() => []),
  /** true when the last attempt's JSON could not be read at all */
  unreadable: lastValue<boolean>(() => false),
  error: lastValue<StepError | null>(() => null),
  result: lastValue<StepResult | null>(() => null),
});
type State = typeof StepState.State;
type Update = typeof StepState.Update;

export type StepGraphOptions = {
  provider?: Provider | null | (() => Provider | null);
  /** Asked before every model call (attempt 1, 2, 3). Return a refusal to stop the step, for spend limits. */
  admit?: (attempt: number) => { code: StepErrorCode; message: string } | null;
  /** Passed to every model call. */
  maxTokens?: number;
};

const sinkOf = (config?: RunnableConfig): EventSink => (config?.configurable?.sink as EventSink | undefined) ?? (() => {});
const fail = (code: StepErrorCode, message: string, attempts: number, issues: string[] = []): StepError => ({
  code,
  message,
  attempts,
  issues,
});
const cap = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '\n…' : s);

export function createStepGraph(options: StepGraphOptions = {}) {
  const getProvider = (): Provider | null => {
    const p = options.provider;
    if (p === undefined) return resolveProvider();
    return typeof p === 'function' ? p() : p;
  };

  /** wraps a node so its start and end are visible as events */
  const node =
    (step: StepName, run: (state: State, config: RunnableConfig, sink: EventSink) => Promise<Update> | Update) =>
    async (state: State, config: RunnableConfig): Promise<Update> => {
      const sink = sinkOf(config);
      sink({ type: 'step_started', step, attempt: state.attempt });
      const update = await run(state, config, sink);
      sink({ type: 'step_finished', step, attempt: typeof update.attempt === 'number' ? update.attempt : state.attempt });
      return update;
    };

  const guard = node('guard', (state, config) => {
    const parsed = parseStepInput(state.input);
    if (!parsed.ok) return { error: fail('bad_request', parsed.message, 0) };
    if (config.signal?.aborted) return { error: fail('aborted', 'The request was cancelled.', 0) };
    if (!getProvider()) return { error: fail('not_configured', 'No model is configured on this server.', 0) };
    const { prompt, tier, role, maxAttempts } = parsed.input;
    return {
      prompt,
      tier,
      role: role ?? detectRole(prompt),
      maxAttempts: Math.min(maxAttempts, MAX_ATTEMPTS),
      messages: [{ role: 'user', content: prompt }],
    };
  });

  const draft = node('draft', async (state, config, sink) => {
    const attempt = state.attempt + 1;
    const provider = getProvider();
    if (!provider) return { attempt, error: fail('not_configured', 'No model is configured on this server.', state.attempt) };
    const refusal = options.admit?.(attempt);
    if (refusal) return { attempt: state.attempt, error: fail(refusal.code, refusal.message, state.attempt) };
    const messageId = `draft-${attempt}`;
    sink({ type: 'draft_started', attempt, messageId });
    let text = '';
    let truncated = false;
    try {
      for await (const chunk of provider.stream({
        messages: state.messages,
        tier: state.tier,
        maxTokens: options.maxTokens,
        temperature: 0.2,
        signal: config.signal,
      })) {
        if (config.signal?.aborted) throw new LlmError('aborted', 'The request was cancelled.', 499);
        if (chunk.type === 'delta') {
          text += chunk.text;
          sink({ type: 'draft_text', attempt, messageId, text: chunk.text });
        } else if (chunk.type === 'done') truncated = chunk.truncated;
      }
    } catch (e) {
      sink({ type: 'draft_ended', attempt, messageId });
      if (config.signal?.aborted) return { attempt, error: fail('aborted', 'The request was cancelled.', attempt) };
      if (e instanceof LlmError) return { attempt, error: fail(e.code, e.message, attempt) };
      return { attempt, error: fail('upstream', 'The model call failed: ' + (e instanceof Error ? e.message : 'unknown error'), attempt) };
    }
    sink({ type: 'draft_ended', attempt, messageId });
    return { attempt, drafted: text, truncated };
  });

  const validate = node('validate', (state, _config, sink) => {
    const parsed = parseJSONLoose(state.drafted);
    let issues: string[];
    let unreadable = false;
    if (!parsed.ok) {
      unreadable = true;
      issues = [state.truncated ? 'the answer was cut off before the JSON ended: keep every text short and use fewer rows' : parsed.reason];
    } else {
      issues = issuesOf(state.role, parsed.value);
      if (!issues.length) return { answer: JSON.stringify(parsed.value), issues: [], unreadable: false };
    }
    sink({ type: 'issues', attempt: state.attempt, issues });
    return { answer: null, issues, unreadable };
  });

  const repair = node('repair', (state) => ({
    messages: [
      ...state.messages.slice(0, 1),
      { role: 'assistant', content: cap(state.drafted, 8000) },
      { role: 'user', content: repairNote(state.issues) },
    ],
  }));

  const finish = node('finish', (state) => {
    if (state.error) {
      return {};
    }
    if (state.answer !== null) {
      const result: StepResult = {
        text: state.answer,
        role: state.role,
        attempts: state.attempt,
        repaired: state.attempt > 1,
        truncated: state.truncated,
      };
      return { result };
    }
    const cutOff = state.unreadable && state.truncated;
    const error = fail(
      cutOff ? 'truncated' : 'invalid_output',
      (cutOff ? 'The answer was cut off before its JSON ended' : 'The model did not return a valid answer') +
        ` after ${state.attempt} ${state.attempt === 1 ? 'attempt' : 'attempts'}: ${state.issues.join('; ')}`,
      state.attempt,
      state.issues,
    );
    return { error };
  });

  return new StateGraph(StepState)
    .addNode('guard', guard)
    .addNode('draft', draft)
    .addNode('validate', validate)
    .addNode('repair', repair)
    .addNode('finish', finish)
    .addEdge(START, 'guard')
    .addConditionalEdges('guard', (s) => (s.error ? 'finish' : 'draft'), ['draft', 'finish'])
    .addConditionalEdges('draft', (s) => (s.error ? 'finish' : 'validate'), ['validate', 'finish'])
    .addConditionalEdges('validate', (s) => (s.answer !== null || s.attempt >= s.maxAttempts ? 'finish' : 'repair'), ['finish', 'repair'])
    .addEdge('repair', 'draft')
    .addEdge('finish', END)
    .compile();
}

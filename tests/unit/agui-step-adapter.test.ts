import { describe, expect, it } from 'vitest';
import { lastValueFrom, toArray } from 'rxjs';
import { verifyEvents } from '@ag-ui/client';
import { EventType, type RunAgentInput } from '@ag-ui/core';
import { EventSchemas } from '@ag-ui/core/schemas';
import { wrapStepAgent, type StepLikeAgent } from '@/server/agui/step-adapter';

const input = (forwardedProps: unknown): RunAgentInput => ({
  threadId: 't', runId: 'r', messages: [], tools: [], context: [], state: {}, forwardedProps,
});
const play = async (agent: StepLikeAgent) => {
  const a = wrapStepAgent(agent);
  const events = await lastValueFrom(a.run(input({ prompt: 'p' })).pipe(toArray()));
  events.forEach((e) => EventSchemas.parse(e));
  await lastValueFrom(a.run(input({ prompt: 'p' })).pipe(verifyEvents(false), toArray()));
  return events;
};

describe('wrapStepAgent', () => {
  it('maps a failed first draft and a repaired second draft to a valid sequence', async () => {
    let got: unknown;
    const events = await play({
      async run(inp, opts) {
        got = inp;
        const s = opts!.sink!;
        s({ type: 'step_started', step: 'draft', attempt: 1 });
        s({ type: 'draft_started', attempt: 1, messageId: 'draft-1' });
        s({ type: 'draft_text', attempt: 1, messageId: 'draft-1', text: 'oops' });
        s({ type: 'draft_ended', attempt: 1, messageId: 'draft-1' });
        s({ type: 'step_finished', step: 'draft', attempt: 1 });
        s({ type: 'step_started', step: 'validate', attempt: 1 });
        s({ type: 'issues', attempt: 1, issues: ['not JSON'] });
        s({ type: 'step_finished', step: 'validate', attempt: 1 });
        s({ type: 'step_started', step: 'repair', attempt: 2 });
        s({ type: 'draft_text', attempt: 2, messageId: 'draft-2', text: '{}' });
        s({ type: 'step_finished', step: 'repair', attempt: 2 });
        return { result: { text: '{}' } };
      },
    });
    expect(got).toEqual({ prompt: 'p' });
    expect(events.at(-1)).toMatchObject({ type: EventType.RUN_FINISHED, result: { text: '{}' } });
    expect(events.filter((e) => e.type === EventType.CUSTOM)).toHaveLength(1);
    const ids = events.filter((e) => e.type === EventType.TEXT_MESSAGE_START).map((e) => (e as unknown as { messageId: string }).messageId);
    expect(ids).toEqual(['draft-1', 'draft-2']);
  });

  it('maps an error outcome to RUN_ERROR with its code', async () => {
    const events = await play({ run: async () => ({ error: { code: 'invalid_output', message: 'still not JSON' } }) });
    expect(events.at(-1)).toMatchObject({ type: EventType.RUN_ERROR, code: 'invalid_output', message: 'still not JSON' });
  });
});

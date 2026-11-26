import { describe, expect, it } from 'vitest';
import { lastValueFrom, toArray } from 'rxjs';
import { verifyEvents } from '@ag-ui/client';
import { EventType, type BaseEvent, type RunAgentInput } from '@ag-ui/core';
import { EventSchemas } from '@ag-ui/core/schemas';
import { graphAgent, type AgentWork } from '@/server/agui/graph-agent';

const input = (extra: Partial<RunAgentInput> = {}): RunAgentInput => ({
  threadId: 't1',
  runId: 'r1',
  messages: [],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
  ...extra,
});

/** Runs the agent to its end and returns the events, after checking each against the official schemas and rules. */
async function events(work: AgentWork, inp = input()): Promise<BaseEvent[]> {
  const agent = graphAgent(work);
  const out = await lastValueFrom(agent.run(inp).pipe(toArray()));
  for (const e of out) EventSchemas.parse(e);
  // verifyEvents is the protocol's own state machine; it errors on a bad order.
  await lastValueFrom(agent.run(inp).pipe(verifyEvents(false), toArray()));
  return out;
}
const types = (list: BaseEvent[]) => list.map((e) => e.type);

describe('GraphAgent event sequences', () => {
  it('an empty run is RUN_STARTED then RUN_FINISHED', async () => {
    expect(types(await events(() => {}))).toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED]);
  });

  it('finish(result) puts the result on RUN_FINISHED', async () => {
    const list = await events((s) => s.finish({ ok: 1 }));
    const last = list.at(-1) as { type: string; result: unknown; threadId: string; runId: string };
    expect(last).toMatchObject({ type: EventType.RUN_FINISHED, result: { ok: 1 }, threadId: 't1', runId: 'r1' });
  });

  it('steps are opened and closed, and a new step closes the last one', async () => {
    const list = await events((s) => {
      s.step('draft');
      s.step('validate');
    });
    expect(types(list)).toEqual([
      EventType.RUN_STARTED,
      EventType.STEP_STARTED,
      EventType.STEP_FINISHED,
      EventType.STEP_STARTED,
      EventType.STEP_FINISHED,
      EventType.RUN_FINISHED,
    ]);
  });

  it('text streams as start, content per delta, end; empty deltas are skipped', async () => {
    const list = await events((s) => {
      s.text('Hel');
      s.text('');
      s.text('lo');
    });
    expect(types(list)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
  });

  it('a given messageId is used, and a different one starts a new message', async () => {
    const list = await events((s) => {
      s.text('a', { messageId: 'draft-1' });
      s.text('b', { messageId: 'draft-2' });
    });
    const starts = list.filter((e) => e.type === EventType.TEXT_MESSAGE_START) as unknown as { messageId: string }[];
    expect(starts.map((e) => e.messageId)).toEqual(['draft-1', 'draft-2']);
  });

  it('a tool call is start, args, end, then a result; objects become JSON', async () => {
    const list = await events((s) => {
      s.text('thinking');
      const id = s.toolCall('lookup', { q: 'x' });
      s.toolResult(id, { hits: 2 });
    });
    expect(types(list)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.RUN_FINISHED,
    ]);
    const args = list.find((e) => e.type === EventType.TOOL_CALL_ARGS) as unknown as { delta: string };
    expect(JSON.parse(args.delta)).toEqual({ q: 'x' });
    const res = list.find((e) => e.type === EventType.TOOL_CALL_RESULT) as unknown as { content: string; toolCallId: string };
    const start = list.find((e) => e.type === EventType.TOOL_CALL_START) as unknown as { toolCallId: string; toolCallName: string };
    expect(res.toolCallId).toBe(start.toolCallId);
    expect(start.toolCallName).toBe('lookup');
    expect(JSON.parse(res.content)).toEqual({ hits: 2 });
  });

  it('state(delta) is STATE_DELTA, snapshot is STATE_SNAPSHOT, an empty delta is skipped', async () => {
    const list = await events((s) => {
      s.snapshot({ n: 0 });
      s.state([{ op: 'replace', path: '/n', value: 1 }]);
      s.state([]);
    });
    expect(types(list)).toEqual([EventType.RUN_STARTED, EventType.STATE_SNAPSHOT, EventType.STATE_DELTA, EventType.RUN_FINISHED]);
  });

  it('custom events pass through', async () => {
    const list = await events((s) => s.custom('issues', { attempt: 1 }));
    expect(list[1]).toMatchObject({ type: EventType.CUSTOM, name: 'issues', value: { attempt: 1 } });
  });

  it('fail() ends with RUN_ERROR after closing open blocks, and nothing follows it', async () => {
    const list = await events((s) => {
      s.step('draft');
      s.text('partial');
      s.fail('bad_output', 'no JSON');
      s.text('ignored');
      s.finish();
    });
    expect(types(list)).toEqual([
      EventType.RUN_STARTED,
      EventType.STEP_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.STEP_FINISHED,
      EventType.RUN_ERROR,
    ]);
    expect(list.at(-1)).toMatchObject({ code: 'bad_output', message: 'no JSON' });
  });

  it('a thrown error becomes RUN_ERROR agent_error with its message only', async () => {
    const list = await events(async (s) => {
      s.step('go');
      throw new Error('boom');
    });
    expect(list.at(-1)).toMatchObject({ type: EventType.RUN_ERROR, code: 'agent_error', message: 'boom' });
    expect(types(list)).toContain(EventType.STEP_FINISHED);
  });

  it('finish() inside an open step and message closes them first', async () => {
    const list = await events((s) => {
      s.step('a');
      s.text('x');
      s.toolCall('t', {});
      s.finish('done');
    });
    expect(types(list).slice(-3)).toEqual([EventType.TOOL_CALL_END, EventType.STEP_FINISHED, EventType.RUN_FINISHED]);
  });

  it('always starts with RUN_STARTED, even when the work is async', async () => {
    const list = await events(async (s) => {
      await new Promise((r) => setTimeout(r, 5));
      s.text('late');
    });
    expect(list[0].type).toBe(EventType.RUN_STARTED);
    expect(list.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });
});

describe('GraphAgent abort', () => {
  it('unsubscribing aborts the signal the work sees', async () => {
    let seen: AbortSignal | undefined;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const agent = graphAgent(async (s) => {
      seen = s.signal;
      await gate;
    });
    const sub = agent.run(input()).subscribe();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen?.aborted).toBe(false);
    sub.unsubscribe();
    expect(seen?.aborted).toBe(true);
    release();
  });

  it('after an abort nothing more is delivered to the caller', async () => {
    const got: BaseEvent[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const agent = graphAgent(async (s) => {
      s.text('one');
      await gate;
      s.text('two');
    });
    const sub = agent.run(input()).subscribe((e) => got.push(e));
    await new Promise((r) => setTimeout(r, 0));
    const before = got.length;
    sub.unsubscribe();
    release();
    await new Promise((r) => setTimeout(r, 5));
    expect(got.length).toBe(before);
  });
});

describe('GraphAgent as the runtime uses it', () => {
  it('clone() keeps the work function and runs it', async () => {
    const agent = graphAgent((s) => s.finish('cloned'));
    const copy = agent.clone();
    expect(copy).not.toBe(agent);
    const list = await lastValueFrom(copy.run(input()).pipe(toArray()));
    expect(list.at(-1)).toMatchObject({ type: EventType.RUN_FINISHED, result: 'cloned' });
  });
});

import { describe, expect, it } from 'vitest';
import { deriveActivity, publishAgentEvent, subscribeAgentEvents, toActivity, type RawAgentEvent } from '@/platform/agui/activity';
import { runAgent } from '@/platform/agui/client';

let seq = 0;
const ev = (type: string, d: Record<string, unknown> = {}): RawAgentEvent => ({ type, seq: ++seq, t: seq * 10, app: 'a1', ...d });
const STATION_AGENT: Record<string, string> = { research: 'researcher', database: 'database', backend: 'backend' };
const agentOf = (e: RawAgentEvent) => (typeof e.stepName === 'string' ? (STATION_AGENT[e.stepName] ?? null) : null);

describe('toActivity', () => {
  it('maps AG-UI events and ignores the ones the feed does not show', () => {
    expect(toActivity(ev('STEP_STARTED', { stepName: 'research' }), agentOf)).toMatchObject({
      kind: 'step_started',
      agent: 'researcher',
      step: 'research',
    });
    expect(toActivity(ev('TEXT_MESSAGE_START', { messageId: 'm' }))).toBeNull();
    expect(toActivity(ev('TOOL_CALL_END', { toolCallId: 'c' }))).toBeNull();
    expect(toActivity(ev('CUSTOM', { name: 'unknown', value: {} }))).toBeNull();
    expect(toActivity(ev('CUSTOM', { name: 'checks', value: { station: 'database', passed: 4, failed: 1, attempt: 1 } }))).toMatchObject({
      kind: 'checks',
      step: 'database',
      passed: 4,
      failed: 1,
    });
    expect(toActivity(ev('CUSTOM', { name: 'issues', value: { attempt: 2, issues: ['no id column', 'bad type'] } }))).toMatchObject({
      kind: 'issues',
      failed: 2,
      text: 'no id column; bad type',
    });
    expect(toActivity(ev('STATE_DELTA', { delta: [{ op: 'replace', path: '/schema' }] }))).toMatchObject({ kind: 'state', text: 'schema' });
    expect(toActivity({ type: 'RUN_ERROR', message: 'x'.repeat(500) })?.text.length).toBeLessThanOrEqual(240);
  });
});

describe('deriveActivity', () => {
  it('follows a build: steps, checks, a send-back, a hand-off, a question and the end', () => {
    const run = { runId: 'r1' };
    const m = deriveActivity(
      [
        ev('RUN_STARTED', run),
        ev('STEP_STARTED', { ...run, stepName: 'research' }),
        ev('TEXT_MESSAGE_CONTENT', { messageId: 'm1', delta: 'Reading ', agent: 'researcher' }),
        ev('TEXT_MESSAGE_CONTENT', { messageId: 'm1', delta: 'the request.', agent: 'researcher' }),
        ev('CUSTOM', { name: 'interrupt', value: { reason: 'question', text: 'Can the desk read notes?' } }),
        ev('CUSTOM', { name: 'resume', value: { answer: 'No' } }),
        ev('STEP_FINISHED', { ...run, stepName: 'research' }),
        ev('STEP_STARTED', { ...run, stepName: 'database' }),
        ev('TOOL_CALL_START', { toolCallId: 'c1', toolCallName: 'create_table', agent: 'database' }),
        ev('TOOL_CALL_ARGS', { toolCallId: 'c1', delta: '{"name":"patients"}' }),
        ev('TOOL_CALL_RESULT', { toolCallId: 'c1', content: '{"ok":true}' }),
        ev('CUSTOM', { name: 'checks', value: { station: 'database', attempt: 1, passed: 3, failed: 1 } }),
        ev('CUSTOM', { name: 'sent_back', value: { station: 'database', attempt: 1, issues: 1 } }),
      ],
      { agentOf },
    );
    expect(m.running).toBe(true);
    expect(m.agents.researcher).toMatchObject({ state: 'done', steps: 1 });
    expect(m.agents.database).toMatchObject({ state: 'working', step: 'database', tools: 1, sentBack: 1 });
    const kinds = m.items.map((i) => i.kind);
    expect(kinds).toEqual([
      'run_started',
      'step_started',
      'message',
      'waiting',
      'resumed',
      'step_finished',
      'handoff',
      'step_started',
      'tool_call',
      'checks',
      'sent_back',
    ]);
    expect(m.items.find((i) => i.kind === 'message')?.text).toBe('Reading the request.');
    expect(m.items.find((i) => i.kind === 'waiting')).toMatchObject({ agent: 'researcher', reason: 'question' });
    expect(m.items.find((i) => i.kind === 'handoff')).toMatchObject({ from: 'researcher', agent: 'database' });
    expect(m.items.find((i) => i.kind === 'tool_call')).toMatchObject({
      text: 'create_table',
      args: '{"name":"patients"}',
      result: '{"ok":true}',
    });

    const done = deriveActivity([ev('RUN_STARTED', run), ev('STEP_STARTED', { ...run, stepName: 'backend' }), ev('RUN_FINISHED', run)], {
      agentOf,
    });
    expect(done.running).toBe(false);
    expect(done.agents.backend.state).toBe('done');
  });

  it('marks the agents of a failed run as failed, and only those', () => {
    const m = deriveActivity(
      [
        ev('RUN_STARTED', { runId: 'x' }),
        ev('STEP_STARTED', { runId: 'x', stepName: 'research' }),
        ev('RUN_STARTED', { runId: 'y', app: 'a2' }),
        ev('STEP_STARTED', { runId: 'y', app: 'a2', stepName: 'backend' }),
        ev('RUN_ERROR', { runId: 'x', message: 'stopped' }),
      ],
      { agentOf },
    );
    expect(m.agents.researcher.state).toBe('failed');
    expect(m.agents.backend.state).toBe('working');
    expect(m.running).toBe(true);
  });

  it('filters by app, keeps server steps inside one agent, and caps the feed', () => {
    const m = deriveActivity(
      [
        ev('STEP_STARTED', { app: 'other', stepName: 'research' }),
        ev('STEP_STARTED', { stepName: 'draft', agent: 'database', server: true }),
        ev('STEP_FINISHED', { stepName: 'draft', agent: 'database', server: true }),
        ev('STEP_STARTED', { stepName: 'validate', agent: 'database', server: true }),
      ],
      { agentOf, app: 'a1' },
    );
    expect(m.agents.researcher).toBeUndefined();
    expect(m.agents.database).toMatchObject({ state: 'working', step: 'validate', steps: 2 });
    expect(m.items.some((i) => i.kind === 'handoff')).toBe(false);
    const many = Array.from({ length: 50 }, (_, i) => ev('STEP_STARTED', { stepName: 's' + i, agent: 'ui' }));
    expect(deriveActivity(many, { limit: 10 }).items).toHaveLength(10);
  });
});

describe('the bus', () => {
  it('runAgent publishes every event with the agent role and app', async () => {
    const seen: RawAgentEvent[] = [];
    const stop = subscribeAgentEvents((e) => seen.push(e));
    const body = [
      { type: 'RUN_STARTED', threadId: 't', runId: 'r' },
      { type: 'STEP_STARTED', stepName: 'draft' },
      { type: 'STEP_FINISHED', stepName: 'draft' },
      { type: 'RUN_FINISHED', threadId: 't', runId: 'r' },
    ];
    const fetchFake = (async () =>
      new Response(body.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      })) as unknown as typeof fetch;
    await runAgent('step', { forwardedProps: { role: 'database' }, activity: { app: 'a9' }, fetch: fetchFake });
    await runAgent('step', { activity: false, fetch: fetchFake });
    stop();
    expect(seen.map((e) => e.type)).toEqual(['RUN_STARTED', 'STEP_STARTED', 'STEP_FINISHED', 'RUN_FINISHED']);
    expect(seen.every((e) => e.agent === 'database' && e.app === 'a9' && e.server === true)).toBe(true);
  });

  it('keeps going when a listener throws, and stops after unsubscribe', () => {
    const seen: string[] = [];
    const a = subscribeAgentEvents(() => {
      throw new Error('broken');
    });
    const b = subscribeAgentEvents((e) => seen.push(e.type));
    publishAgentEvent({ type: 'STEP_STARTED' }, { agent: 'ui' });
    a();
    b();
    publishAgentEvent({ type: 'STEP_FINISHED' }, { agent: 'ui' });
    expect(seen).toEqual(['STEP_STARTED']);
  });
});

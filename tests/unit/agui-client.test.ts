import { describe, expect, it } from 'vitest';
import { runAgent } from '@/platform/agui/client';

const sse = (events: Record<string, unknown>[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
const started = { type: 'RUN_STARTED', threadId: 't', runId: 'r' };
const finished = (result?: unknown) => ({ type: 'RUN_FINISHED', threadId: 't', runId: 'r', ...(result === undefined ? {} : { result }) });
const fake = (events: Record<string, unknown>[], seen?: { url?: string; body?: unknown }) =>
  (async (url: string, init: RequestInit) => {
    if (seen) {
      seen.url = url;
      seen.body = JSON.parse(String(init.body));
    }
    return sse(events);
  }) as unknown as typeof fetch;

describe('runAgent (browser client, fake stream)', () => {
  it('posts to the agent run URL with forwardedProps and the user message', async () => {
    const seen: { url?: string; body?: { forwardedProps: unknown; messages: { role: string; content: string }[] } } = {};
    await runAgent('step', {
      messages: 'hi',
      forwardedProps: { prompt: 'p' },
      fetch: fake([started, finished()], seen),
    });
    expect(seen.url).toBe('/api/copilotkit/agent/step/run');
    expect(seen.body?.forwardedProps).toEqual({ prompt: 'p' });
    expect(seen.body?.messages.at(-1)).toMatchObject({ role: 'user', content: 'hi' });
  });

  it('calls back for steps, streamed text, tool calls, results, state and custom events', async () => {
    const log: string[] = [];
    const res = await runAgent('team', {
      fetch: fake([
        started,
        { type: 'STEP_STARTED', stepName: 'draft' },
        { type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: '{"a":' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: '1}' },
        { type: 'TEXT_MESSAGE_END', messageId: 'm' },
        { type: 'TOOL_CALL_START', toolCallId: 'c', toolCallName: 'wiki' },
        { type: 'TOOL_CALL_ARGS', toolCallId: 'c', delta: '{"q":"x"}' },
        { type: 'TOOL_CALL_END', toolCallId: 'c' },
        { type: 'TOOL_CALL_RESULT', messageId: 'r1', toolCallId: 'c', content: '{"n":2}', role: 'tool' },
        { type: 'STATE_SNAPSHOT', snapshot: { n: 0 } },
        { type: 'STATE_DELTA', delta: [{ op: 'replace', path: '/n', value: 3 }] },
        { type: 'CUSTOM', name: 'issues', value: { attempt: 1 } },
        { type: 'STEP_FINISHED', stepName: 'draft' },
        finished({ text: '{"a":1}' }),
      ]),
      onStepStarted: (n) => log.push('start:' + n),
      onStepFinished: (n) => log.push('end:' + n),
      onText: (d, id, soFar) => log.push(`text:${id}:${d}:${soFar}`),
      onTextEnd: (id, t) => log.push(`textEnd:${id}:${t}`),
      onToolCall: (c) => log.push(`tool:${c.name}:${JSON.stringify(c.args)}`),
      onToolResult: (r) => log.push(`result:${r.id}:${r.content}`),
      onState: (s) => log.push('state:' + JSON.stringify(s)),
      onCustom: (n, v) => log.push(`custom:${n}:${JSON.stringify(v)}`),
    });
    expect(log).toEqual([
      'start:draft',
      'text:m:{"a"::{"a":',
      'text:m:1}:{"a":1}',
      'textEnd:m:{"a":1}',
      'tool:wiki:{"q":"x"}',
      'result:c:{"n":2}',
      'state:{"n":0}',
      'state:{"n":3}',
      'custom:issues:{"attempt":1}',
      'end:draft',
    ]);
    expect(res).toMatchObject({ ok: true, result: { text: '{"a":1}' }, state: { n: 3 } });
  });

  it('a RUN_ERROR becomes ok:false with the code and message', async () => {
    const res = await runAgent('step', {
      fetch: fake([started, { type: 'RUN_ERROR', code: 'bad_output', message: 'no JSON after 3 tries' }]),
    });
    expect(res).toMatchObject({ ok: false, aborted: false, error: { code: 'bad_output', message: 'no JSON after 3 tries' } });
  });

  it('a failed request becomes ok:false with code network', async () => {
    const res = await runAgent('step', { fetch: (async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch });
    expect(res).toMatchObject({ ok: false, aborted: false, error: { code: 'network' } });
  });

  it('a refusal from the server (HTTP 429) is a failure, not a hang', async () => {
    const res = await runAgent('step', {
      fetch: (async () => Response.json({ code: 'rate_limited', message: 'slow down' }, { status: 429 })) as unknown as typeof fetch,
    });
    expect(res.ok).toBe(false);
  });

  it('an already aborted signal never sends the request', async () => {
    let called = false;
    const ctl = new AbortController();
    ctl.abort();
    const res = await runAgent('step', {
      signal: ctl.signal,
      fetch: (async () => ((called = true), sse([]))) as unknown as typeof fetch,
    });
    expect(called).toBe(false);
    expect(res).toMatchObject({ ok: false, aborted: true });
  });

  it('aborting mid-stream settles with aborted:true and keeps what arrived', async () => {
    const ctl = new AbortController();
    const stream = new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode(`data: ${JSON.stringify(started)}\n\n`));
        c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'TEXT_MESSAGE_START', messageId: 'm', role: 'assistant' })}\n\n`));
        c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'part' })}\n\n`));
      },
    });
    let text = '';
    const res = await runAgent('step', {
      signal: ctl.signal,
      fetch: (async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } })) as unknown as typeof fetch,
      onText: (d) => {
        text += d;
        ctl.abort();
      },
    });
    expect(text).toBe('part');
    expect(res).toMatchObject({ ok: false, aborted: true });
  });
});

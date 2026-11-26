import { afterEach, describe, expect, it, vi } from 'vitest';
import { SseParser, TeamStreamError, jsonObject, splitToolName, streamTeam } from '@/workspace/team-stream';

const sse = (events: object[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');

function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('SseParser', () => {
  it('returns each data line as an event, keeping a partial event for the next chunk', () => {
    const p = new SseParser();
    const text = sse([
      { type: 'RUN_STARTED', runId: 'r' },
      { type: 'STEP_STARTED', stepName: 'a' },
    ]);
    const cutAt = text.indexOf('STEP_STARTED');
    expect(p.push(text.slice(0, cutAt))).toEqual([{ type: 'RUN_STARTED', runId: 'r' }]);
    expect(p.push(text.slice(cutAt))).toEqual([{ type: 'STEP_STARTED', stepName: 'a' }]);
  });

  it('skips comments, lines that are not JSON and objects without a type', () => {
    const p = new SseParser();
    expect(p.push(': ping\n\ndata: nope\n\ndata: {"x":1}\n\ndata: {"type":"A"}\r\n\r\n')).toEqual([{ type: 'A' }]);
  });

  it('reads an event the stream ends without a blank line', () => {
    const p = new SseParser();
    expect(p.push('data: {"type":"RUN_FINISHED"}')).toEqual([]);
    expect(p.end()).toEqual([{ type: 'RUN_FINISHED' }]);
  });
});

describe('streamTeam', () => {
  it('posts the run as JSON and yields the events in order, across chunk boundaries', async () => {
    const text = sse([
      { type: 'RUN_STARTED' },
      { type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'wikipedia.page_summary' },
      { type: 'RUN_FINISHED', result: { status: 'done' } },
    ]);
    const fetchMock = vi.fn(async () => new Response(bodyOf([text.slice(0, 7), text.slice(7, 50), text.slice(50)]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const out = [];
    for await (const e of streamTeam({ team: 'x' })) out.push(e.type);
    expect(out).toEqual(['RUN_STARTED', 'TOOL_CALL_START', 'RUN_FINISHED']);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/agent/team');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ team: 'x' });
  });

  it('turns a refused request into a TeamStreamError with the server message', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ code: 'bad_request', message: 'The request body must be JSON.' }, { status: 400 }));
    const it = streamTeam({});
    await expect(it.next()).rejects.toMatchObject({ code: 'bad_request', status: 400, message: 'The request body must be JSON.' });
  });

  it('reports a stopped run as aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    const err = await streamTeam({}, ctrl.signal)
      .next()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TeamStreamError);
    expect((err as TeamStreamError).code).toBe('aborted');
  });

  it('closes the request when the caller stops reading early, so the server stops the team', async () => {
    const cancelled: unknown[] = [];
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(sse([{ type: 'RUN_STARTED' }, { type: 'RUN_ERROR', message: 'no' }])));
      },
      cancel: (reason) => void cancelled.push(reason),
    });
    vi.stubGlobal('fetch', async () => new Response(body, { status: 200 }));
    for await (const e of streamTeam({})) if (e.type === 'RUN_ERROR') break;
    expect(cancelled).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('splits a tool name into connector and tool', () => {
    expect(splitToolName('wikipedia.page_summary')).toEqual({ connector: 'wikipedia', tool: 'page_summary' });
    expect(splitToolName('odd')).toEqual({ connector: 'odd', tool: '' });
  });
  it('reads JSON objects carried as strings and ignores anything else', () => {
    expect(jsonObject('{"q":"tea"}')).toEqual({ q: 'tea' });
    expect(jsonObject('[1]')).toEqual({});
    expect(jsonObject('nope')).toEqual({});
    expect(jsonObject(3)).toEqual({});
  });
});

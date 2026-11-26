import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { log, noteModelCall, requestIdFor, setLogSink, withRequestLog } from '@/server/log';
import { recordUsage } from '@/server/llm/usage';

type Line = Record<string, unknown> & { level: string; event: string };
let lines: Line[];
let restoreSink: () => void;
let saved: string | undefined;

beforeEach(() => {
  lines = [];
  restoreSink = setLogSink((level, line) => lines.push({ ...JSON.parse(line), sinkLevel: level }));
  saved = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'debug';
});
afterEach(() => {
  restoreSink();
  if (saved === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = saved;
});

const req = (headers: Record<string, string> = {}) => new Request('http://localhost/api/x', { method: 'POST', headers });

describe('log', () => {
  it('writes one JSON object with level, event and fields, leaving out undefined ones', () => {
    log('warn', 'something', { a: 1, b: undefined, c: 'x' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 'warn', event: 'something', a: 1, c: 'x' });
    expect('b' in lines[0]).toBe(false);
  });

  it('respects LOG_LEVEL and is silent under vitest by default', () => {
    log('debug', 'quiet', {}, { LOG_LEVEL: 'info' });
    log('error', 'loud', {}, { VITEST: 'true' });
    expect(lines).toHaveLength(0);
    log('info', 'heard', {}, { LOG_LEVEL: 'info' });
    expect(lines).toHaveLength(1);
  });
});

describe('requestIdFor', () => {
  it("uses Vercel's id when it is well formed, else a fresh one", () => {
    expect(requestIdFor(req({ 'x-vercel-id': 'fra1::abc-123' }))).toBe('fra1::abc-123');
    expect(requestIdFor(req({ 'x-vercel-id': 'bad id <script>' }))).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestIdFor(req())).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('withRequestLog', () => {
  it('adds x-request-id and logs one request line after the body is read', async () => {
    const route = withRequestLog('test', async () => Response.json({ ok: true }));
    const res = await route(req({ 'x-vercel-id': 'id-1' }));
    expect(res.headers.get('x-request-id')).toBe('id-1');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ ok: true });
    const line = lines.find((l) => l.event === 'request');
    expect(line).toMatchObject({ level: 'info', requestId: 'id-1', route: 'test', method: 'POST', status: 200, outcome: 'ok' });
    expect(typeof line?.ms).toBe('number');
  });

  it('logs a refusal as a warning and keeps its status and body', async () => {
    const route = withRequestLog('test', () => Response.json({ code: 'rate_limited', message: 'slow down' }, { status: 429 }));
    const res = await route(req());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ code: 'rate_limited', message: 'slow down' });
    expect(lines.find((l) => l.event === 'request')).toMatchObject({ level: 'warn', status: 429 });
  });

  it('answers a thrown error with a typed 500 and logs the message, not the stack', async () => {
    const route = withRequestLog('test', () => {
      throw new Error('made-up failure');
    });
    const res = await route(req({ 'x-vercel-id': 'id-2' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ code: 'internal', message: expect.any(String), requestId: 'id-2' });
    const unhandled = lines.find((l) => l.event === 'unhandled');
    expect(unhandled).toMatchObject({ level: 'error', error: 'made-up failure', requestId: 'id-2' });
    expect(JSON.stringify(unhandled)).not.toContain('at ');
    expect(lines.find((l) => l.event === 'request')).toMatchObject({ level: 'error', status: 500 });
  });

  it('times a stream to its end and adds the cost of model calls made while it ran', async () => {
    const route = withRequestLog('test', () => {
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          await Promise.resolve();
          noteModelCall({ input: 100, output: 20, cacheRead: 50, costUsd: 0.001 });
          recordUsage(
            { provider: 'mock', model: 'm', tier: 'quick', effort: 'low', usage: { input: 10, output: 5, costUsd: 0.0005 }, ms: 3 },
            { LLM_LOG_USAGE: '1' },
          );
          controller.enqueue(new TextEncoder().encode('a\n'));
          controller.close();
        },
      });
      return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
    });
    const res = await route(req());
    expect(lines.find((l) => l.event === 'request')).toBeUndefined(); // not until the stream ends
    expect(await res.text()).toBe('a\n');
    const line = lines.find((l) => l.event === 'request');
    expect(line).toMatchObject({ modelCalls: 2, inputTokens: 110, outputTokens: 25, cacheReadTokens: 50, costUsd: 0.0015 });
    const call = lines.find((l) => l.event === 'model_call');
    expect(call).toMatchObject({ provider: 'mock', inputTokens: 10, costUsd: 0.0005, route: 'test' });
  });

  it('logs an abandoned stream as aborted', async () => {
    const route = withRequestLog('test', () => new Response(new ReadableStream({ pull() {} })));
    const res = await route(req());
    await res.body?.cancel();
    expect(lines.find((l) => l.event === 'request')).toMatchObject({ outcome: 'aborted' });
  });
});

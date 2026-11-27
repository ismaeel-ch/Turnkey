/**
 * The structured request log on real routes, with the stand-in model: one `request` line per request carrying the
 * id sent back in `x-request-id`, the model calls the request made, and nothing from the prompt or the answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as stepPOST } from '@/app/api/agent/step/route';
import { POST as teamPOST } from '@/app/api/agent/team/route';
import { setLogSink } from '@/server/log';
import { resetUsageTotals } from '@/server/llm/usage';
import { factRequest } from './team/fixtures';

const PROMPT =
  'You are the Researcher agent on Turnkey, a line of agents that builds small record-keeping web apps (tables, roles, one status workflow, screens) from one sentence. Code checks your answer and sends it back if it fails, so follow the format exactly. Reply with ONE JSON object and nothing else: no prose, no code fences.\n\nREQUEST: "a clinic"';

type Line = Record<string, unknown>;
let lines: Line[];
let raw: string[];
let restore: () => void;
let n = 0;
const ip = () => `192.0.2.${100 + ++n}`;
const post = (route: (r: Request) => Promise<Response>, path: string, body: unknown, headers: Record<string, string> = {}) =>
  route(
    new Request('http://localhost' + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip(), ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  lines = [];
  raw = [];
  restore = setLogSink((_level, line) => {
    raw.push(line);
    lines.push(JSON.parse(line) as Line);
  });
  resetUsageTotals();
  vi.stubEnv('LOG_LEVEL', 'debug');
  vi.stubEnv('LLM_LOG_USAGE', '1');
  vi.stubEnv('LLM_PROVIDER', 'mock');
  vi.stubEnv('LLM_RATE_PER_MINUTE', '100000');
  vi.stubEnv('LLM_GLOBAL_PER_MINUTE', '100000');
  vi.stubEnv('LLM_DAILY_CALL_CAP', '100000');
});
afterEach(() => {
  restore();
  vi.unstubAllEnvs();
});

const requestLine = () => lines.filter((l) => l.event === 'request');

describe('request log on /api/agent/step', () => {
  it('logs one line when the stream ends, with the id it sent back and the model calls it made', async () => {
    const res = await post(stepPOST, '/api/agent/step', { prompt: PROMPT });
    const id = res.headers.get('x-request-id');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestLine()).toHaveLength(0); // not before the body is read
    await res.text();
    const [line] = requestLine();
    expect(line).toMatchObject({
      level: 'info',
      requestId: id,
      route: 'agent.step',
      method: 'POST',
      status: 200,
      outcome: 'ok',
      modelCalls: 1,
    });
    expect(line.inputTokens).toEqual(expect.any(Number));
    // the model call's own line belongs to the same request
    expect(lines.find((l) => l.event === 'model_call')).toMatchObject({ requestId: id, route: 'agent.step', provider: 'mock' });
  });

  it("keeps Vercel's id when it sends one", async () => {
    const res = await post(stepPOST, '/api/agent/step', { prompt: PROMPT }, { 'x-vercel-id': 'fra1::abc12-1700000000000-0123456789ab' });
    await res.text();
    expect(res.headers.get('x-request-id')).toBe('fra1::abc12-1700000000000-0123456789ab');
    expect(requestLine()[0].requestId).toBe('fra1::abc12-1700000000000-0123456789ab');
  });

  it('logs a refusal as a warning with its status, and no model calls', async () => {
    const res = await post(stepPOST, '/api/agent/step', '{not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'bad_request' });
    expect(requestLine()[0]).toMatchObject({ level: 'warn', status: 400, outcome: 'ok' });
    expect(requestLine()[0]).not.toHaveProperty('modelCalls');
  });

  it('never writes the prompt, the answer or the visitor address', async () => {
    const res = await post(stepPOST, '/api/agent/step', { prompt: PROMPT }, { 'x-forwarded-for': '203.0.113.99' });
    const answer = await res.text();
    const all = raw.join('\n');
    expect(all).not.toContain('a clinic');
    expect(all).not.toContain('203.0.113.99');
    // the streamed answer carries the model's JSON; no piece of it reaches the log
    const result = JSON.parse(answer.trim().split('\n').pop()!) as { result?: { text: string } };
    expect(result.result?.text.length).toBeGreaterThan(20);
    expect(all).not.toContain(result.result!.text.slice(0, 20));
  });
});

describe('request log on /api/agent/team', () => {
  it('counts every model call of the team run in one request line', async () => {
    const res = await post(teamPOST, '/api/agent/team', factRequest());
    await res.text();
    const calls = lines.filter((l) => l.event === 'model_call');
    expect(calls.length).toBeGreaterThan(1);
    expect(requestLine()[0]).toMatchObject({ route: 'agent.team', status: 200, outcome: 'ok', modelCalls: calls.length });
    expect(new Set(calls.map((l) => l.requestId))).toEqual(new Set([res.headers.get('x-request-id')]));
  });
});

describe('cost reporting on /api/agent/team', () => {
  it('sends one CUSTOM usage event per model call, inside the run, with numbers and no text', async () => {
    const res = await post(teamPOST, '/api/agent/team', factRequest());
    const events = (await res.text())
      .split('\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice(6)) as { type: string; name?: string; value?: Record<string, unknown> });
    const usage = events.filter((e) => e.type === 'CUSTOM' && e.name === 'usage');
    const calls = lines.filter((l) => l.event === 'model_call');
    expect(usage.length).toBe(calls.length);
    expect(usage.length).toBeGreaterThan(1);
    for (const e of usage) {
      expect(Object.keys(e.value ?? {}).sort()).toEqual(
        ['cacheRead', 'cacheWrite', 'costUsd', 'estimated', 'input', 'ms', 'model', 'output', 'tier'].sort(),
      );
      expect(e.value).toMatchObject({ model: expect.stringMatching(/^mock-/), input: expect.any(Number), estimated: false });
    }
    const first = events.findIndex((e) => e.type === 'CUSTOM' && e.name === 'usage');
    const end = events.findIndex((e) => e.type === 'RUN_FINISHED' || e.type === 'RUN_ERROR');
    expect(events[0].type).toBe('RUN_STARTED');
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(end);
  });
});

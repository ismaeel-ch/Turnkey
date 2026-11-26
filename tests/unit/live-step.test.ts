import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/copilotkit/[[...slug]]/route';
import { resolveAgents } from '@/server/agui/registry';
import { codeFor, ModelError, sample, type StepProgress } from '@/platform/model-client';

/* Live builds: the browser's `sample` runs every agent prompt on the server's step agent over AG-UI. */

/** The opening the workspace writes (HEAD() in src/workspace/line.ts): the route's prompt policy only relays these. */
const head = (name: string) => 'You are the ' + name + ' agent on Turnkey, a line of agents that builds small record-keeping web apps (tables, roles, one status workflow, screens) from one sentence. Code checks your answer and sends it back if it fails, so follow the format exactly. Reply with ONE JSON object and nothing else: no prose, no code fences.\n\n';

const origin = 'http://localhost:3109';
let ip = 0;
/** The real route, called in process: the browser client's fetch goes straight to the handler. */
const viaRoute = (async (url: string, init: RequestInit) => {
  const headers = new Headers(init.headers);
  headers.set('x-forwarded-for', `10.1.0.${++ip % 250}`);
  return POST(new Request(origin + url, { ...init, headers }));
}) as unknown as typeof fetch;

const sse = (events: Record<string, unknown>[]) =>
  (async () =>
    new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    })) as unknown as typeof fetch;
const started = { type: 'RUN_STARTED', threadId: 't', runId: 'r' };

beforeEach(() => vi.stubEnv('LLM_PROVIDER', 'mock'));
afterEach(() => vi.unstubAllEnvs());

describe('agent step in the registry', () => {
  it('is served with the default agent', async () => {
    expect(Object.keys(await resolveAgents({}))).toEqual(expect.arrayContaining(['default', 'step']));
  });
});

describe('sample() on the step agent, through the real route with the mock provider', () => {
  it('returns the checked JSON and reports draft and format check in order', async () => {
    const steps: string[] = [];
    let streamed = '';
    const out = await sample(head('Researcher') + 'Request: a dental clinic books patients.', {
      fetch: viaRoute,
      onStep: (s: StepProgress) => steps.push(`${s.phase}:${s.name}:${s.attempt}${s.ok === false ? ':bad' : ''}`),
      onText: (p) => (streamed = p.text),
    });
    const brief = JSON.parse(out.text) as { name: string; roles: unknown[] };
    expect(brief.name).toBeTruthy();
    expect(brief.roles.length).toBeGreaterThanOrEqual(2);
    expect(out.attempts).toBe(1);
    expect(streamed.length).toBeGreaterThan(0);
    expect(steps).toEqual([
      'start:guard:1',
      'end:guard:1',
      'start:draft:1',
      'end:draft:1',
      'start:validate:1',
      'end:validate:1',
      'start:finish:1',
      'end:finish:1',
    ]);
  });

  it('sends one model call by default, so a station keeps its own cap of three', async () => {
    const seen: { forwardedProps?: { maxAttempts?: number; tier?: string } } = {};
    const spy = (async (url: string, init: RequestInit) => {
      Object.assign(seen, JSON.parse(String(init.body)));
      return viaRoute(url, init);
    }) as unknown as typeof fetch;
    await sample(head('Database') + 'Tables for a clinic.', { fetch: spy, modelTier: 'quick' });
    expect(seen.forwardedProps).toMatchObject({ maxAttempts: 1, tier: 'quick' });
  });
});

describe('sample() on a scripted stream', () => {
  it('returns the last draft with the issues when the shape check fails, so the workspace checks and sends it back', async () => {
    const steps: StepProgress[] = [];
    const out = await sample('p', {
      fetch: sse([
        started,
        { type: 'STEP_STARTED', stepName: 'draft' },
        { type: 'TEXT_MESSAGE_START', messageId: 'draft-1', role: 'assistant' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'draft-1', delta: '{"name":"x"}' },
        { type: 'TEXT_MESSAGE_END', messageId: 'draft-1' },
        { type: 'STEP_FINISHED', stepName: 'draft' },
        { type: 'STEP_STARTED', stepName: 'validate' },
        { type: 'CUSTOM', name: 'issues', value: { attempt: 1, issues: ['"roles": needs at least 2 roles'] } },
        { type: 'STEP_FINISHED', stepName: 'validate' },
        { type: 'RUN_ERROR', code: 'invalid_output', message: 'no valid answer' },
      ]),
      onStep: (s) => steps.push(s),
    });
    expect(out).toMatchObject({ text: '{"name":"x"}', truncated: false, issues: ['"roles": needs at least 2 roles'] });
    expect(steps.find((s) => s.name === 'validate' && s.phase === 'end')).toMatchObject({ ok: false, issues: ['"roles": needs at least 2 roles'] });
  });

  it('reports a repair as a second draft', async () => {
    const steps: string[] = [];
    const out = await sample('p', {
      maxAttempts: 2,
      fetch: sse([
        started,
        { type: 'STEP_STARTED', stepName: 'draft' },
        { type: 'STEP_FINISHED', stepName: 'draft' },
        { type: 'STEP_STARTED', stepName: 'validate' },
        { type: 'CUSTOM', name: 'issues', value: { attempt: 1, issues: ['bad'] } },
        { type: 'STEP_FINISHED', stepName: 'validate' },
        { type: 'STEP_STARTED', stepName: 'repair' },
        { type: 'STEP_FINISHED', stepName: 'repair' },
        { type: 'STEP_STARTED', stepName: 'draft' },
        { type: 'STEP_FINISHED', stepName: 'draft' },
        { type: 'STEP_STARTED', stepName: 'validate' },
        { type: 'STEP_FINISHED', stepName: 'validate' },
        { type: 'RUN_FINISHED', threadId: 't', runId: 'r', result: { text: '{"ok":1}', role: 'any', attempts: 2, repaired: true, truncated: false } },
      ]),
      onStep: (s) => s.phase === 'end' && steps.push(`${s.name}:${s.attempt}:${s.ok}`),
    });
    expect(out).toMatchObject({ text: '{"ok":1}', attempts: 2 });
    expect(steps).toEqual(['draft:1:true', 'validate:1:false', 'repair:1:true', 'draft:2:true', 'validate:2:true']);
  });

  it('closes a step the stream left open', async () => {
    const ends: string[] = [];
    await expect(
      sample('p', {
        fetch: sse([started, { type: 'STEP_STARTED', stepName: 'draft' }, { type: 'RUN_ERROR', code: 'upstream', message: 'boom' }]),
        onStep: (s) => s.phase === 'end' && ends.push(`${s.name}:${s.ok}`),
      }),
    ).rejects.toThrow('boom');
    expect(ends).toEqual(['draft:false']);
  });

  it('maps refusals and failures to the codes the workspace understands', async () => {
    const refuse = (status: number, body: unknown) =>
      (async () => Response.json(body, { status })) as unknown as typeof fetch;
    const codeOf = async (f: typeof fetch) => {
      try {
        await sample('p', { fetch: f });
        return 'no error';
      } catch (e) {
        return e instanceof ModelError ? e.code : 'other';
      }
    };
    expect(await codeOf(refuse(429, { code: 'rate_limited', message: 'slow down' }))).toBe('rate_limited');
    expect(await codeOf(refuse(429, { code: 'budget', message: 'used up' }))).toBe('budget');
    expect(await codeOf(refuse(503, { code: 'off', message: 'off' }))).toBe('not_granted');
    expect(await codeOf(sse([started, { type: 'RUN_ERROR', code: 'not_configured', message: 'no model' }]))).toBe('not_granted');
    expect(await codeOf((async () => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch)).toBe('network');
    expect(codeFor('unauthorized')).toBe('not_granted');
    expect(codeFor('upstream')).toBe('upstream');
  });
});

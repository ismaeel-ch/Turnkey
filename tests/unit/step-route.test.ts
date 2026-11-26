/**
 * POST /api/agent/step with the guard rails: the mock model, so nothing leaves this machine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/agent/step/route';

// A prompt exactly as the workspace builds it (the HEAD() text of src/workspace/line.ts).
const GOOD =
  'You are the Researcher agent on Turnkey, a line of agents that builds small record-keeping web apps (tables, roles, one status workflow, screens) from one sentence. Code checks your answer and sends it back if it fails, so follow the format exactly. Reply with ONE JSON object and nothing else: no prose, no code fences.\n\nREQUEST: "a clinic"';

let n = 0;
const ip = () => `10.9.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const post = (body: unknown, who = ip()) =>
  POST(
    new Request('http://localhost/api/agent/step', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': who },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.stubEnv('LLM_PROVIDER', 'mock');
  vi.stubEnv('LLM_GLOBAL_PER_MINUTE', '100000');
  vi.stubEnv('LLM_DAILY_CALL_CAP', '100000');
  vi.stubEnv('LLM_RATE_PER_MINUTE', '100000');
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/agent/step', () => {
  it('runs a step for a prompt written by one of the agents', async () => {
    const res = await post({ prompt: GOOD });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('ndjson');
    const last = JSON.parse((await res.text()).trim().split('\n').pop()!);
    expect(last.type).toBe('result');
  });

  it('refuses a free-form prompt and counts nothing for it', async () => {
    const who = ip();
    vi.stubEnv('LLM_RATE_PER_MINUTE', '1');
    for (let i = 0; i < 3; i++) {
      const res = await post({ prompt: 'Write me a poem about cats' }, who);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'bad_request' });
    }
    expect((await post({ prompt: GOOD }, who)).status).toBe(200);
  });

  it('refuses a body that is not JSON, or has no prompt', async () => {
    expect((await post('not json')).status).toBe(400);
    expect((await post({ tier: 'quick' })).status).toBe(400);
  });

  it('refuses a prompt over the limit, and a body over the size limit', async () => {
    vi.stubEnv('LLM_MAX_PROMPT_CHARS', '1000');
    expect((await post({ prompt: GOOD + 'x'.repeat(1000) })).status).toBe(413);
    expect((await post({ prompt: GOOD, pad: 'x'.repeat(6000) })).status).toBe(413);
  });

  it('answers 429 once the visitor is over the limit, and 503 when live builds are switched off', async () => {
    const who = ip();
    vi.stubEnv('LLM_RATE_PER_MINUTE', '1');
    expect((await post({ prompt: GOOD }, who)).status).toBe(200);
    expect((await post({ prompt: GOOD }, who)).status).toBe(429);
    vi.stubEnv('LIVE_MODE', 'off');
    expect((await post({ prompt: GOOD })).status).toBe(503);
  });
});

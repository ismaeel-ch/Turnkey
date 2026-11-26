import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/agent/team/route';
import { factRequest } from './fixtures';

afterEach(() => vi.unstubAllEnvs());

let n = 0;
const ip = () => `10.8.${Math.floor(n / 250)}.${(n++ % 250) + 1}`;
const post = (body: unknown, who = ip()) =>
  POST(
    new Request('http://x/api/agent/team', {
      method: 'POST',
      headers: { 'x-forwarded-for': who },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
const events = async (res: Response) =>
  (await res.text())
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice(6)) as { type: string; code?: string });

describe('POST /api/agent/team', () => {
  it('streams a run on the stand-in model and ends with one final event', async () => {
    vi.stubEnv('LLM_PROVIDER', 'mock');
    const res = await post(factRequest());
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const ev = await events(res);
    expect(ev[0].type).toBe('RUN_STARTED');
    expect(ev.filter((e) => e.type === 'RUN_FINISHED' || e.type === 'RUN_ERROR')).toHaveLength(1);
    expect(['RUN_FINISHED', 'RUN_ERROR']).toContain(ev[ev.length - 1].type);
  });

  it('says plainly that no model is connected', async () => {
    vi.stubEnv('NODE_ENV', 'production'); // in development the stand-in or the Claude Code command answers
    vi.stubEnv('LLM_PROVIDER', '');
    vi.stubEnv('LITELLM_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    const ev = await events(await post(factRequest()));
    expect(ev[ev.length - 1]).toMatchObject({ type: 'RUN_ERROR', code: 'not_configured' });
  });

  it('refuses a body that is not JSON', async () => {
    expect((await post('nope')).status).toBe(400);
  });

  it('refuses a body over the size limit, and every run when live builds are switched off', async () => {
    vi.stubEnv('LLM_PROVIDER', 'mock');
    vi.stubEnv('LLM_MAX_PROMPT_CHARS', '1000');
    expect((await post({ ...factRequest(), pad: 'x'.repeat(6000) })).status).toBe(413);
    vi.stubEnv('LLM_MAX_PROMPT_CHARS', '');
    vi.stubEnv('LIVE_MODE', 'off');
    const off = await post(factRequest());
    expect(off.status).toBe(503);
    expect(await off.json()).toMatchObject({ code: 'not_configured' });
  });

  it('answers 429 before streaming once the visitor is over the limit', async () => {
    vi.stubEnv('LLM_PROVIDER', 'mock');
    vi.stubEnv('LLM_GLOBAL_PER_MINUTE', '100000');
    vi.stubEnv('LLM_DAILY_CALL_CAP', '100000');
    vi.stubEnv('LLM_RATE_PER_MINUTE', '1');
    const who = ip();
    await (await post(factRequest(), who)).text();
    const res = await post(factRequest(), who);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: 'rate_limited' });
  });
});

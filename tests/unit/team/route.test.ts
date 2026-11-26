import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/agent/team/route';
import { factRequest } from './fixtures';

afterEach(() => vi.unstubAllEnvs());

const post = (body: unknown) =>
  POST(new Request('http://x/api/agent/team', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
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
});

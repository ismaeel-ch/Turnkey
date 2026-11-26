import { describe, expect, it } from 'vitest';
import { createStepAgent } from '@/server/graph/step';
import { LlmError, type ChatChunk, type ChatRequest, type Provider } from '@/server/llm';
import { mockProvider } from '@/server/llm/providers/mock';
import { parseStepInput, type StepEvent } from '@/shared/agent-contract';
import saved from './fixtures/saved-builds.json';

const builds = saved as unknown as Record<string, Record<string, unknown>>;
const head = (who: string) =>
  `You are the ${who} agent on Turnkey, a line of agents that builds small record-keeping web apps.\n\nREQUEST: "x"`;
const BRIEF = JSON.stringify(builds.clinic.research);

/** Answers from a list, one per call, and records every request. */
function scripted(answers: Array<string | { text: string; truncated: true } | Error>) {
  const requests: ChatRequest[] = [];
  const provider: Provider = {
    id: 'scripted',
    model: () => 'scripted',
    async *stream(request): AsyncGenerator<ChatChunk> {
      requests.push(request);
      const a = answers[Math.min(requests.length - 1, answers.length - 1)];
      if (a instanceof Error) throw a;
      const text = typeof a === 'string' ? a : a.text;
      yield { type: 'delta', text: text.slice(0, 10) };
      yield { type: 'delta', text: text.slice(10) };
      yield { type: 'done', truncated: typeof a !== 'string' };
    },
  };
  return { provider, requests };
}

const run = (provider: Provider | null, input: Parameters<ReturnType<typeof createStepAgent>['run']>[0], signal?: AbortSignal) => {
  const events: StepEvent[] = [];
  return createStepAgent({ provider })
    .run(input, { sink: (e) => events.push(e), signal })
    .then((out) => ({ out, events }));
};
const steps = (events: StepEvent[]) => events.filter((e) => e.type === 'step_started').map((e) => (e as { step: string }).step);

describe('agent step graph', () => {
  it('returns the first draft when it is valid, with fences and prose removed', async () => {
    const { provider, requests } = scripted(['Here it is:\n```json\n' + BRIEF + '\n```']);
    const { out, events } = await run(provider, { prompt: head('Researcher') });
    expect('result' in out && out.result.attempts).toBe(1);
    if (!('result' in out)) throw new Error('no result');
    expect(out.result.role).toBe('research');
    expect(out.result.repaired).toBe(false);
    expect(JSON.parse(out.result.text)).toEqual(JSON.parse(BRIEF));
    expect(out.result.text.startsWith('{')).toBe(true);
    expect(requests).toHaveLength(1);
    expect(steps(events)).toEqual(['guard', 'draft', 'validate', 'finish']);
    const text = events.filter((e) => e.type === 'draft_text').map((e) => (e as { text: string }).text);
    expect(text.length).toBeGreaterThan(1);
  });

  it('repairs on the second attempt and sends the exact failures back', async () => {
    const bad = JSON.stringify({
      name: 'A',
      summary: 'b',
      roles: [{ id: 'a' }],
      entities: ['x', 'y'],
      process: { entity: 'x', states: ['a', 'b', 'c'] },
      stories: [],
    });
    const { provider, requests } = scripted([bad, BRIEF]);
    const { out, events } = await run(provider, { prompt: head('Researcher') });
    if (!('result' in out)) throw new Error('no result');
    expect(out.result.attempts).toBe(2);
    expect(out.result.repaired).toBe(true);
    expect(steps(events)).toEqual(['guard', 'draft', 'validate', 'repair', 'draft', 'validate', 'finish']);
    const second = requests[1].messages;
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(second[1].content).toBe(bad);
    expect(second[2].content).toMatch(/needs at least 2 roles/);
    expect(second[2].content).toMatch(/needs at least 2 user stories/);
    expect(events.find((e) => e.type === 'issues')).toMatchObject({ attempt: 1 });
  });

  it('fails after three attempts with a clear error, and never makes a fourth call', async () => {
    const { provider, requests } = scripted(['I would rather chat about it.']);
    const { out } = await run(provider, { prompt: head('Researcher'), maxAttempts: 3 });
    expect(requests).toHaveLength(3);
    if (!('error' in out)) throw new Error('expected an error');
    expect(out.error.code).toBe('invalid_output');
    expect(out.error.attempts).toBe(3);
    expect(out.error.message).toMatch(/after 3 attempts/);
    expect(out.error.issues[0]).toMatch(/no JSON object/);
  });

  it('honours a lower attempt cap and refuses a higher one', async () => {
    const one = scripted(['nope']);
    await run(one.provider, { prompt: head('Researcher'), maxAttempts: 1 });
    expect(one.requests).toHaveLength(1);
    const many = scripted(['nope']);
    const { out } = await run(many.provider, { prompt: head('Researcher'), maxAttempts: 9 });
    expect(many.requests).toHaveLength(0);
    expect('error' in out && out.error.code).toBe('bad_request');
  });

  it('reports a truncated answer, and asks for a shorter one before giving up', async () => {
    const cut = BRIEF.slice(0, Math.floor(BRIEF.length / 2));
    const { provider, requests } = scripted([{ text: cut, truncated: true }]);
    const { out } = await run(provider, { prompt: head('Researcher') });
    if (!('error' in out)) throw new Error('expected an error');
    expect(out.error.code).toBe('truncated');
    expect(out.error.message).toMatch(/cut off/);
    expect(requests).toHaveLength(3);
    expect(requests[1].messages[2].content).toMatch(/cut off/);
  });

  it('accepts a flagged answer whose JSON is complete and valid', async () => {
    const { provider } = scripted([{ text: BRIEF, truncated: true }]);
    const { out } = await run(provider, { prompt: head('Researcher') });
    expect('result' in out && out.result.truncated).toBe(true);
  });

  it('stops when the request is aborted, before and during the model call', async () => {
    const early = new AbortController();
    early.abort();
    const a = await run(scripted([BRIEF]).provider, { prompt: head('Researcher') }, early.signal);
    expect('error' in a.out && a.out.error.code).toBe('aborted');

    const late = new AbortController();
    const slow: Provider = {
      id: 'slow',
      model: () => 'slow',
      async *stream(): AsyncGenerator<ChatChunk> {
        yield { type: 'delta', text: '{"a"' };
        late.abort();
        yield { type: 'delta', text: ':1}' };
        yield { type: 'done', truncated: false };
      },
    };
    const b = await run(slow, { prompt: head('Researcher') }, late.signal);
    expect('error' in b.out && b.out.error.code).toBe('aborted');
    expect(b.events.some((e) => e.type === 'error')).toBe(true);
    expect(b.events.some((e) => e.type === 'result')).toBe(false);
  });

  it('passes provider errors on with their code', async () => {
    const { out } = await run(scripted([new LlmError('rate_limited', 'slow down', 429)]).provider, { prompt: head('Researcher') });
    expect('error' in out && out.error.code).toBe('rate_limited');
  });

  it('says so when no model is configured, and refuses an empty prompt', async () => {
    expect(
      'error' in (await run(null, { prompt: head('Researcher') })).out &&
        ((await run(null, { prompt: 'x' })).out as { error: { code: string } }).error.code,
    ).toBe('not_configured');
    const empty = await run(scripted([BRIEF]).provider, { prompt: '   ' });
    expect('error' in empty.out && empty.out.error.code).toBe('bad_request');
  });

  it('works with the mock provider, and accepts any JSON object for an unknown prompt', async () => {
    const { out } = await run(mockProvider(), { prompt: 'Say hello', tier: 'quick' });
    expect('result' in out && out.result.role).toBe('any');
  });

  it('takes an explicit role over the detected one', async () => {
    const { out } = await run(scripted([JSON.stringify({ findings: [] })]).provider, { prompt: 'Review this', role: 'review' });
    expect('result' in out && out.result.role).toBe('review');
  });
});

describe('parseStepInput', () => {
  it('fills the defaults', () => {
    expect(parseStepInput({ prompt: 'p' })).toEqual({ ok: true, input: { prompt: 'p', tier: 'default', maxAttempts: 3 } });
  });
  it('explains what is wrong', () => {
    const r = parseStepInput({ prompt: '', tier: 'huge' });
    expect(r.ok).toBe(false);
  });
});

describe('spend limits', () => {
  it('stops the step when a later call is refused', async () => {
    const calls: number[] = [];
    const { provider, requests } = scripted(['nope']);
    const agent = createStepAgent({
      provider,
      admit: (n) => (calls.push(n), n === 2 ? { code: 'rate_limited', message: 'Many builds are running right now.' } : null),
    });
    const out = await agent.run({ prompt: head('Researcher') });
    expect(requests).toHaveLength(1);
    expect('error' in out && out.error.code).toBe('rate_limited');
    expect(calls).toEqual([1, 2]);
  });
});

describe('POST /api/agent/step', () => {
  it('streams events and ends with the result, and refuses bad input before streaming', async () => {
    process.env.LLM_PROVIDER = 'mock';
    try {
      const { POST } = await import('@/app/api/agent/step/route');
      const post = (body: unknown) => POST(new Request('http://x/api/agent/step', { method: 'POST', body: JSON.stringify(body) }));
      const bad = await post({ prompt: '' });
      expect(bad.status).toBe(400);
      const ok = await post({ prompt: 'Say hello' });
      expect(ok.headers.get('content-type')).toMatch(/ndjson/);
      const lines = (await ok.text())
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as StepEvent);
      expect(lines[lines.length - 1].type).toBe('result');
      expect(lines.map((l) => l.type)).toContain('draft_text');
    } finally {
      delete process.env.LLM_PROVIDER;
    }
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHost, health, ModelError, sample } from '@/platform/model-client';
import { streamResponse } from './helpers/fakes';

/** Replaces the global fetch for one test. Each call gets the url and init, and answers with `answer`. */
function fakeFetch(answer: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer(url, init);
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const encoder = new TextEncoder();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sample: reading the stream', () => {
  it('joins deltas that arrive split across chunk boundaries, including a split line', async () => {
    fakeFetch(() =>
      streamResponse(['{"type":"del', 'ta","text":"Hel"}\n{"type":"delta","te', 'xt":"lo"}\n{"type":"done","truncated":false}\n']),
    );
    await expect(sample('say hello')).resolves.toEqual({ text: 'Hello', truncated: false });
  });

  it('does not split a multi-byte character that arrives across two chunks', async () => {
    const line = encoder.encode('{"type":"delta","text":"naïve €"}\n{"type":"done","truncated":false}\n');
    const cut = line.indexOf(0xe2) + 1; // inside the three bytes of the euro sign
    fakeFetch(() => streamResponse([line.slice(0, cut), line.slice(cut)]));
    await expect(sample('x')).resolves.toEqual({ text: 'naïve €', truncated: false });
  });

  it('reads a last line that has no newline after it', async () => {
    fakeFetch(() => streamResponse(['{"type":"delta","text":"ok"}\n{"type":"done","truncated":true}']));
    await expect(sample('x')).resolves.toEqual({ text: 'ok', truncated: true });
  });

  it('skips blank lines and reports truncated only when the server says so', async () => {
    fakeFetch(() => streamResponse(['\n{"type":"delta","text":"a"}\n\n{"type":"done"}\n']));
    await expect(sample('x')).resolves.toEqual({ text: 'a', truncated: false });
  });

  it('calls onText with the growing text after each delta, and ignores empty deltas', async () => {
    fakeFetch(() =>
      streamResponse([
        '{"type":"delta","text":"H"}\n{"type":"delta","text":""}\n{"type":"delta","text":"i"}\n{"type":"done","truncated":false}\n',
      ]),
    );
    const seen: string[] = [];
    await sample('x', { onText: ({ text }) => seen.push(text) });
    expect(seen).toEqual(['H', 'Hi']);
  });

  it('sends the prompt and the tier, and defaults to the careful tier', async () => {
    const calls = fakeFetch(() => streamResponse(['{"type":"done","truncated":false}\n']));
    await sample('build it', { modelTier: 'quick' });
    await sample('build it');
    expect(calls[0].url).toBe('/api/llm');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ prompt: 'build it', tier: 'quick' });
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ prompt: 'build it', tier: 'default' });
  });

  it('turns an error event in the stream into a ModelError with its code', async () => {
    fakeFetch(() => streamResponse(['{"type":"delta","text":"par"}\n{"type":"error","code":"budget","message":"Out of budget"}\n']));
    const error = await sample('x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelError);
    expect(error).toMatchObject({ code: 'budget', message: 'Out of budget' });
  });

  it('maps a not_configured error in the stream to not_granted', async () => {
    fakeFetch(() => streamResponse(['{"type":"error","code":"not_configured","message":"No model"}\n']));
    await expect(sample('x')).rejects.toMatchObject({ code: 'not_granted' });
  });
});

describe('sample: refusals before the stream', () => {
  const refuse = (status: number, body: unknown) =>
    fakeFetch(() => (typeof body === 'string' ? new Response(body, { status }) : Response.json(body, { status })));

  it('turns a 503 with code not_configured into not_granted, keeping the message', async () => {
    refuse(503, { code: 'not_configured', message: 'No model is configured on this deployment.' });
    await expect(sample('x')).rejects.toMatchObject({ code: 'not_granted', message: 'No model is configured on this deployment.' });
  });

  it('turns 401 and 403 into not_granted even without a code', async () => {
    refuse(401, {});
    await expect(sample('x')).rejects.toMatchObject({ code: 'not_granted' });
    refuse(403, 'forbidden');
    await expect(sample('x')).rejects.toMatchObject({ code: 'not_granted' });
  });

  it('turns a 429 into rate_limited, with or without a code', async () => {
    refuse(429, { code: 'rate_limited', message: 'Wait a minute' });
    await expect(sample('x')).rejects.toMatchObject({ code: 'rate_limited', message: 'Wait a minute' });
    refuse(429, 'slow down');
    await expect(sample('x')).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('keeps a 429 with code budget as budget', async () => {
    refuse(429, { code: 'budget', message: "Today's allowance is used up" });
    await expect(sample('x')).rejects.toMatchObject({ code: 'budget' });
  });

  it('uses the server code for other refusals, and a generic code when there is none', async () => {
    refuse(400, { code: 'bad_request', message: 'A prompt is required.' });
    await expect(sample('x')).rejects.toMatchObject({ code: 'bad_request', message: 'A prompt is required.' });
    refuse(500, '<html>oops</html>');
    await expect(sample('x')).rejects.toMatchObject({ code: 'error', message: 'the model service answered 500' });
  });

  it('reports a network failure as network, not as the browser error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))),
    );
    await expect(sample('x')).rejects.toMatchObject({ code: 'network' });
  });

  it('rethrows the error of a request that was aborted', async () => {
    const controller = new AbortController();
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        controller.abort();
        throw abort;
      }),
    );
    const error = await sample('x', { signal: controller.signal }).catch((e: unknown) => e);
    expect(error).toBe(abort);
    expect(error).not.toBeInstanceOf(ModelError);
  });
});

describe('health', () => {
  it('returns what /api/health says', async () => {
    fakeFetch(() => Response.json({ ok: true, live: true, provider: 'mock' }));
    await expect(health()).resolves.toEqual({ ok: true, live: true, provider: 'mock' });
  });
  it('returns null when the answer is not ok or cannot be reached', async () => {
    fakeFetch(() => new Response('down', { status: 500 }));
    await expect(health()).resolves.toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    await expect(health()).resolves.toBeNull();
  });
});

describe('createHost', () => {
  it('offers sample when the server has a model configured', async () => {
    fakeFetch(() => Response.json({ ok: true, live: true }));
    const sampleFn = await createHost().use('sample');
    expect(sampleFn).toBe(sample);
  });

  it('offers nothing when the server says no model is configured', async () => {
    fakeFetch(() => Response.json({ ok: true, live: false }));
    await expect(createHost().use('sample')).resolves.toBeNull();
  });

  it('offers sample anyway when health cannot be reached, so the calls say what is wrong', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    await expect(createHost().use('sample')).resolves.toBe(sample);
  });

  it('checks health once per host, however often sample is asked for', async () => {
    const calls = fakeFetch(() => Response.json({ ok: true, live: true }));
    const host = createHost();
    await host.use('sample');
    await host.use('sample');
    expect(calls.filter((c) => c.url === '/api/health')).toHaveLength(1);
  });

  it('offers downloads as an object with save, and nothing for other capabilities', async () => {
    const host = createHost();
    await expect(host.use('downloads')).resolves.toEqual({ save: expect.any(Function) });
    await expect(host.use('something-else')).resolves.toBeNull();
  });
});

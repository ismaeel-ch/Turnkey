import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHost, health, ModelError, sample } from '@/platform/model-client';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

// The answer stream itself (drafts, checks, repairs, errors in the stream) is covered in live-step.test.ts, through the
// real route and on scripted AG-UI streams. Here: what sample() sends.
describe('sample: the request', () => {
  it('runs the step agent with the prompt, the tier (careful by default) and one attempt', async () => {
    const calls = fakeFetch(() => new Response('', { status: 500 }));
    await sample('build it', { modelTier: 'quick' }).catch(() => undefined);
    await sample('build it').catch(() => undefined);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const bodies = calls.map((c) => JSON.parse(String(c.init.body)) as { forwardedProps?: Record<string, unknown> });
    expect(calls[0].url).toContain('/api/copilotkit');
    expect(calls[0].init.method).toBe('POST');
    expect(bodies[0].forwardedProps).toMatchObject({ prompt: 'build it', tier: 'quick', maxAttempts: 1 });
    expect(bodies[bodies.length - 1].forwardedProps).toMatchObject({ prompt: 'build it', tier: 'default', maxAttempts: 1 });
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
    expect(error).toMatchObject({ name: 'AbortError' });
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

describe('saveFile', () => {
  it('saves through a hidden link with the file name and a type from its ending, then lets go of the address', async () => {
    const { saveFile } = await import('@/platform/model-client');
    const created: Blob[] = [];
    const revoked: string[] = [];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: (b: Blob) => (created.push(b), 'blob:made-up'),
        revokeObjectURL: (u: string) => revoked.push(u),
      }),
    );
    const clicks: Array<{ href: string; download: string }> = [];
    const link = {
      href: '',
      download: '',
      style: {},
      click() {
        clicks.push({ href: link.href, download: link.download });
      },
      remove() {},
    };
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild() {} } });
    vi.useFakeTimers();
    await saveFile({ filename: 'Notes.CSV', data: 'a,b' });
    await saveFile({ filename: 'plain', data: new Uint8Array([1]) });
    await saveFile({ filename: 'x.json', data: new Blob(['{}']) });
    expect(clicks).toEqual([
      { href: 'blob:made-up', download: 'Notes.CSV' },
      { href: 'blob:made-up', download: 'plain' },
      { href: 'blob:made-up', download: 'x.json' },
    ]);
    expect(created[0].type).toBe('text/csv');
    expect(created[1].type).toBe('application/octet-stream');
    vi.advanceTimersByTime(15000);
    expect(revoked).toHaveLength(3);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe('createHost and modelHost', () => {
  it('offers downloads, and nothing for a capability it does not know', async () => {
    const { createHost } = await import('@/platform/model-client');
    const host = createHost();
    expect(await host.use('downloads')).toHaveProperty('save');
    expect(await host.use('camera')).toBeNull();
  });

  it('uses a host that the page already has, and otherwise makes one and keeps it', async () => {
    vi.resetModules();
    const { modelHost } = await import('@/platform/model-client');
    const fake = { use: async () => 'x' };
    vi.stubGlobal('window', { claude: fake });
    expect(modelHost()).toBe(fake);
    vi.stubGlobal('window', {});
    const mine = modelHost();
    expect(mine).not.toBe(fake);
    expect(modelHost()).toBe(mine);
    vi.unstubAllGlobals();
  });
});

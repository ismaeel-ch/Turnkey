import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wikipedia } from '@/server/connectors/wikipedia';
import { backoffMs, clearConnectorCache, MAX_TRIES, setConnectorRetry, TIMEOUT_MS, TOTAL_BUDGET_MS } from '@/server/connectors/shared';
import { fakeFetch, fixture, jsonResponse } from './connectors.helpers';

const f = fixture<{ search: unknown; summary: unknown }>('wikipedia');
const good = (url: string) => jsonResponse(url.includes('list=search') ? f.search : f.summary);
const searches = (calls: { url: string }[]) => calls.filter((c) => c.url.includes('list=search')).length;

let waits: number[];
let undo: () => void;
beforeEach(() => {
  clearConnectorCache();
  waits = [];
  undo = setConnectorRetry({ baseMs: 400, pause: async (ms) => void waits.push(ms) });
});
afterEach(() => {
  undo();
  vi.useRealTimers();
});

describe('connector retries', () => {
  it('tries again after a server error and returns the answer', async () => {
    let n = 0;
    const { doFetch, calls } = fakeFetch((url) =>
      url.includes('list=search') && n++ === 0 ? new Response('busy', { status: 503 }) : good(url),
    );
    const r = await wikipedia.search('electron', { fetch: doFetch });
    expect(r.ok).toBe(true);
    expect(searches(calls)).toBe(2);
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThanOrEqual(300);
    expect(waits[0]).toBeLessThanOrEqual(500);
  });

  it('tries again after a timeout or a dropped connection', async () => {
    let n = 0;
    const { doFetch } = fakeFetch((url) => {
      if (url.includes('list=search')) {
        n++;
        if (n === 1) throw new DOMException('The operation timed out.', 'TimeoutError');
        if (n === 2) throw new TypeError('fetch failed');
      }
      return good(url);
    });
    expect((await wikipedia.search('electron', { fetch: doFetch })).ok).toBe(true);
    expect(n).toBe(3);
    expect(waits[1]).toBeGreaterThan(waits[0]); // backs off
  });

  it(`stops after ${MAX_TRIES} tries and says how many it made`, async () => {
    const { doFetch, calls } = fakeFetch(() => new Response('down', { status: 500 }));
    const r = await wikipedia.search('electron', { fetch: doFetch });
    expect(r).toEqual({ ok: false, code: 'upstream', message: `The source answered with status 500 (tried ${MAX_TRIES} times).` });
    expect(calls).toHaveLength(MAX_TRIES);
  });

  it('does not retry a request the source refused as wrong', async () => {
    const { doFetch, calls } = fakeFetch(() => new Response('no', { status: 404 }));
    expect(await wikipedia.search('electron', { fetch: doFetch })).toMatchObject({ ok: false, code: 'upstream' });
    expect(calls).toHaveLength(1);
    expect(waits).toHaveLength(0);
  });

  it('waits as long as Retry-After asks after a 429, up to 3 seconds', async () => {
    let n = 0;
    const { doFetch } = fakeFetch((url) =>
      url.includes('list=search') && n++ < 2
        ? new Response('slow down', { status: 429, headers: { 'retry-after': n === 1 ? '1' : '30' } })
        : good(url),
    );
    expect((await wikipedia.search('electron', { fetch: doFetch })).ok).toBe(true);
    expect(waits).toEqual([1000, 3000]);
  });

  it('starts no new try once the whole request would pass its time budget', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    undo();
    undo = setConnectorRetry({ baseMs: 400, pause: async (ms) => void waits.push(ms) });
    const { doFetch, calls } = fakeFetch(() => {
      vi.setSystemTime(Date.now() + TOTAL_BUDGET_MS); // each try takes the whole budget
      return new Response('down', { status: 502 });
    });
    const r = await wikipedia.search('electron', { fetch: doFetch });
    expect(r).toEqual({ ok: false, code: 'upstream', message: 'The source answered with status 502.' });
    expect(calls).toHaveLength(1);
  });

  it('a source that never answers is given up on within the time budget: a later try gets only the time left', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const started = Date.now();
    const gaveUpAt: number[] = [];
    // a source that holds every request open until the caller stops waiting
    const { doFetch, calls } = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            gaveUpAt.push(Date.now() - started);
            reject(init.signal?.reason);
          });
        }),
    );
    const pending = wikipedia.search('electron', { fetch: doFetch });
    await vi.advanceTimersByTimeAsync(TOTAL_BUDGET_MS + TIMEOUT_MS);
    const r = await pending;
    expect(r).toEqual({ ok: false, code: 'timeout', message: 'The source did not answer in time (tried 2 times).' });
    expect(calls).toHaveLength(2);
    // the first try waits its full limit; the second only what is left, so the request ends at the budget, not past it
    expect(gaveUpAt).toEqual([TIMEOUT_MS, TOTAL_BUDGET_MS]);
  });

  it('a slow body is held to the same limit as the answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { doFetch } = fakeFetch(
      (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"query":'));
              init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    const pending = wikipedia.search('electron', { fetch: doFetch });
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    expect(await pending).toMatchObject({ ok: false, code: 'bad_response' });
  });

  it('a failure is not cached, so the next lookup tries the source again', async () => {
    const down = fakeFetch(() => new Response('down', { status: 500 }));
    await wikipedia.search('electron', { fetch: down.doFetch });
    const up = fakeFetch(good);
    expect((await wikipedia.search('electron', { fetch: up.doFetch })).ok).toBe(true);
  });
});

describe('backoffMs', () => {
  it('grows about threefold with some spread, and honours Retry-After', () => {
    expect(backoffMs(1, null, 400, () => 0.5)).toBe(400);
    expect(backoffMs(2, null, 400, () => 0.5)).toBe(1200);
    expect(backoffMs(1, null, 400, () => 0)).toBe(300);
    expect(backoffMs(1, null, 400, () => 1)).toBe(500);
    expect(backoffMs(1, '2', 400)).toBe(2000);
    expect(backoffMs(1, '120', 400)).toBe(3000);
    expect(backoffMs(1, 'soon', 400, () => 0.5)).toBe(400); // a date or junk falls back to the backoff
  });
});

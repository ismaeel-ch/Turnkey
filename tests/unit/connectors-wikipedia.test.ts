/**
 * Wikipedia connector. Answers come from tests/unit/fixtures/connectors/wikipedia.json, which was hand-written from
 * the public API documentation, not recorded live. No network is used.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { wikipedia } from '@/server/connectors/wikipedia';
import { clearConnectorCache } from '@/server/connectors/shared';
import { fakeFetch, fixture, jsonResponse } from './connectors.helpers';

const f = fixture<{ search: unknown; summary: unknown }>('wikipedia');
const answer = (url: string) =>
  url.includes('/w/api.php')
    ? jsonResponse(f.search)
    : url.includes('/rest_v1/page/summary/')
      ? jsonResponse(f.summary)
      : jsonResponse({}, 404);

beforeEach(() => clearConnectorCache());

describe('wikipedia connector', () => {
  it('returns the article with its summary and link', async () => {
    const { doFetch, calls } = fakeFetch((url) => answer(url));
    const r = await wikipedia.search('Lahore', { fetch: doFetch });
    expect(r).toEqual({
      ok: true,
      items: [
        {
          title: 'Lahore',
          url: 'https://en.wikipedia.org/wiki/Lahore',
          text: expect.stringContaining('capital of the Pakistani province of Punjab'),
          source: 'Wikipedia',
        },
      ],
    });
    expect(calls[0].url).toContain('srsearch=Lahore');
    expect(calls[1].url).toContain('/api/rest_v1/page/summary/Lahore');
  });

  it('sends a User-Agent and no visitor headers', async () => {
    const { doFetch, calls } = fakeFetch((url) => answer(url));
    await wikipedia.search('Lahore', { fetch: doFetch });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['user-agent']).toMatch(/^Turnkey/);
    expect(Object.keys(headers).sort()).toEqual(['accept', 'user-agent']);
  });

  it('keeps the text to a few hundred characters', async () => {
    const long = { ...(f.summary as object), extract: 'word '.repeat(300) };
    const { doFetch } = fakeFetch((url) => (url.includes('/w/api.php') ? jsonResponse(f.search) : jsonResponse(long)));
    const r = await wikipedia.search('Lahore', { fetch: doFetch });
    expect(r.ok && r.items[0].text.length).toBeLessThanOrEqual(401);
  });

  it('says so when nothing matches', async () => {
    const { doFetch } = fakeFetch(() => jsonResponse({ query: { search: [] } }));
    expect(await wikipedia.search('zzzz', { fetch: doFetch })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('refuses an empty query without calling the source', async () => {
    const { doFetch, calls } = fakeFetch(() => jsonResponse({}));
    expect(await wikipedia.search('   ', { fetch: doFetch })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(calls).toHaveLength(0);
  });

  it('reports a timeout as a timeout, not a thrown error', async () => {
    const { doFetch } = fakeFetch(() => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    expect(await wikipedia.search('Lahore', { fetch: doFetch })).toMatchObject({ ok: false, code: 'timeout' });
  });

  it('reports an unexpected answer as bad_response', async () => {
    const { doFetch } = fakeFetch(() => jsonResponse({ unexpected: true }));
    expect(await wikipedia.search('Lahore', { fetch: doFetch })).toMatchObject({ ok: false, code: 'bad_response' });
  });

  it('caches an identical request for ten minutes', async () => {
    const { doFetch, calls } = fakeFetch((url) => answer(url));
    await wikipedia.search('Lahore', { fetch: doFetch });
    const before = calls.length;
    await wikipedia.search('Lahore', { fetch: doFetch });
    expect(calls.length).toBe(before);
  });

  it('describes itself for the team graph', () => {
    expect(wikipedia.describe.name).toBe('search_wikipedia');
    expect(wikipedia.describe.inputSchema).toHaveProperty('required', ['query']);
  });
});

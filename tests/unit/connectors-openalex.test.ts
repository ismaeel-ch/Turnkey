/**
 * OpenAlex connector. Answers come from tests/unit/fixtures/connectors/openalex.json, which was hand-written from the
 * public API documentation, not recorded live. No network is used.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { abstractFromIndex, openAlex } from '@/server/connectors/openalex';
import { clearConnectorCache } from '@/server/connectors/shared';
import { fakeFetch, fixture, jsonResponse } from './connectors.helpers';

const body = fixture('openalex');

beforeEach(() => clearConnectorCache());

describe('openalex connector', () => {
  it('returns works with authors, year, citations and a rebuilt abstract', async () => {
    const { doFetch, calls } = fakeFetch(() => jsonResponse(body));
    const r = await openAlex.search('machine learning', { fetch: doFetch, limit: 2 });
    expect(calls[0].url).toContain('search=machine%20learning');
    expect(calls[0].url).toContain('per_page=2');
    expect(r).toEqual({
      ok: true,
      items: [
        {
          title: 'Machine learning and deep learning',
          url: 'https://doi.org/10.1000/example.one',
          text: 'Christian Janiesch, Patrick Zschech · 2021 · cited 3578 times. Machine learning is a method that improves with data. learning',
          source: 'OpenAlex',
        },
        {
          title: 'A Note on Sample Data',
          url: 'https://example.org/landing/two',
          text: 'cited 0 times',
          source: 'OpenAlex',
        },
      ],
    });
  });

  it('rebuilds abstracts from the inverted index in order', () => {
    expect(abstractFromIndex({ world: [1], hello: [0] })).toBe('hello world');
    expect(abstractFromIndex(null)).toBe('');
  });

  it('says so when there are no works', async () => {
    const { doFetch } = fakeFetch(() => jsonResponse({ results: [] }));
    expect(await openAlex.search('zzzz', { fetch: doFetch })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('reports a network failure without throwing', async () => {
    const { doFetch } = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    expect(await openAlex.search('machine learning', { fetch: doFetch })).toMatchObject({ ok: false, code: 'upstream' });
  });

  it('describes itself for the team graph', () => {
    expect(openAlex.describe.name).toBe('search_scholarly_works');
  });
});

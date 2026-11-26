/**
 * World Bank connector. Answers come from tests/unit/fixtures/connectors/worldbank.json, which was hand-written from
 * the public API documentation, not recorded live. No network is used.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { worldBank } from '@/server/connectors/worldbank';
import { clearConnectorCache } from '@/server/connectors/shared';
import { fakeFetch, fixture, jsonResponse } from './connectors.helpers';

const body = fixture<{ response: unknown }>('worldbank').response;

beforeEach(() => clearConnectorCache());

describe('world bank connector', () => {
  it('returns the published values and skips years with no value', async () => {
    const { doFetch, calls } = fakeFetch(() => jsonResponse(body));
    const r = await worldBank.search('pak NY.GDP.MKTP.CD', { fetch: doFetch });
    expect(r).toEqual({
      ok: true,
      items: [
        {
          title: 'GDP (current US$), Pakistan, 2025',
          url: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD?locations=PK',
          text: 'GDP (current US$) for Pakistan in 2025: 407307214476.222.',
          source: 'World Bank',
        },
      ],
    });
    expect(calls[0].url).toBe('https://api.worldbank.org/v2/country/PAK/indicator/NY.GDP.MKTP.CD?format=json&per_page=3');
  });

  it('refuses a query that is not a country and an indicator', async () => {
    const { doFetch, calls } = fakeFetch(() => jsonResponse(body));
    expect(await worldBank.search('GDP please', { fetch: doFetch })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(calls).toHaveLength(0);
  });

  it('says so when the source has no values', async () => {
    const empty = [{ page: 1, pages: 1, per_page: 1, total: 0 }, null];
    const { doFetch } = fakeFetch(() => jsonResponse(empty));
    expect(await worldBank.search('PAK NY.GDP.MKTP.CD', { fetch: doFetch })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('reports an unknown indicator as not_found', async () => {
    const message = [{ message: [{ id: '120', key: 'Invalid value', value: 'The provided parameter value is not valid' }] }];
    const { doFetch } = fakeFetch(() => jsonResponse(message));
    expect(await worldBank.search('PAK NOPE.CODE', { fetch: doFetch })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('reports an upstream failure cleanly', async () => {
    const { doFetch } = fakeFetch(() => new Response('oops', { status: 500 }));
    expect(await worldBank.search('PAK NY.GDP.MKTP.CD', { fetch: doFetch })).toMatchObject({ ok: false, code: 'upstream' });
  });

  it('describes itself for the team graph', () => {
    expect(worldBank.describe.name).toBe('get_world_bank_indicator');
  });
});

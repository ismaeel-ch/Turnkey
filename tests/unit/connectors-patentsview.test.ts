/**
 * PatentsView connector. Answers come from tests/unit/fixtures/connectors/patentsview.json, which was hand-written from
 * the PatentsView API reference (the array name is unverified against a live response). No network is used.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { patentsView } from '@/server/connectors/patentsview';
import { clearConnectorCache } from '@/server/connectors/shared';
import { fakeFetch, fixture, jsonResponse } from './connectors.helpers';

const body = fixture('patentsview');
const KEY = 'test-key-not-real';
const savedKey = process.env.PATENTSVIEW_API_KEY;

beforeEach(() => clearConnectorCache());
afterEach(() => {
  if (savedKey === undefined) delete process.env.PATENTSVIEW_API_KEY;
  else process.env.PATENTSVIEW_API_KEY = savedKey;
});

describe('patentsview connector', () => {
  it('answers not_configured and sends nothing when the key is missing', async () => {
    delete process.env.PATENTSVIEW_API_KEY;
    const { doFetch, calls } = fakeFetch(() => jsonResponse(body));
    expect(await patentsView.search('sensor', { fetch: doFetch })).toMatchObject({ ok: false, code: 'not_configured' });
    expect(calls).toHaveLength(0);
  });

  it('posts the search with the key in a header and returns the patents', async () => {
    process.env.PATENTSVIEW_API_KEY = KEY;
    const { doFetch, calls } = fakeFetch(() => jsonResponse(body));
    const r = await patentsView.search('sensor housing', { fetch: doFetch, limit: 1 });
    expect(calls[0].url).toBe('https://search.patentsview.org/api/v1/patent/');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ o: { size: 1 } });
    expect(r).toEqual({
      ok: true,
      items: [
        {
          title: 'Low-power sensor housing',
          url: 'https://patents.google.com/patent/US12000001',
          text: expect.stringContaining('Granted 2026-10-14.'),
          source: 'PatentsView',
        },
      ],
    });
  });

  it('never returns the key to the caller', async () => {
    process.env.PATENTSVIEW_API_KEY = KEY;
    const { doFetch } = fakeFetch(() => new Response('bad key', { status: 403 }));
    const r = await patentsView.search('sensor', { fetch: doFetch });
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(r).toMatchObject({ ok: false, code: 'upstream' });
  });

  it('describes itself for the team graph', () => {
    expect(patentsView.describe.name).toBe('search_us_patents');
  });
});

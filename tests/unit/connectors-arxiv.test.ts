/**
 * arXiv connector. The Atom feed comes from tests/unit/fixtures/connectors/arxiv.json, which was hand-written from the
 * arXiv API manual, not recorded live. No network is used.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { arxiv, parseArxivFeed } from '@/server/connectors/arxiv';
import { clearConnectorCache } from '@/server/connectors/shared';
import { fakeFetch, fixture, xmlResponse } from './connectors.helpers';

const { xml } = fixture<{ xml: string }>('arxiv');

beforeEach(() => clearConnectorCache());

describe('arxiv connector', () => {
  it('reads each entry of the Atom feed, with entities decoded and spaces collapsed', async () => {
    const { doFetch, calls } = fakeFetch(() => xmlResponse(xml));
    const r = await arxiv.search('electron', { fetch: doFetch });
    expect(calls[0].url).toContain('search_query=all:electron');
    expect(r).toEqual({
      ok: true,
      items: [
        {
          title: 'Coupled Electron Transport in Thin Films & Wires',
          url: 'http://arxiv.org/abs/2611.00001v1',
          text: 'Ada Example, Ben Sample (2026). We study electron transport in thin films. The model uses <simple> boundary conditions.',
          source: 'arXiv',
        },
      ],
    });
  });

  it('parses the feed without a network', () => {
    const parsed = parseArxivFeed(xml);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.entries).toHaveLength(1);
    expect(parseArxivFeed('<html></html>')).toEqual({ ok: false });
  });

  it('reports arXiv error entries as upstream', async () => {
    const err = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/api/errors#bad</id><title>Error</title></entry></feed>`;
    const { doFetch } = fakeFetch(() => xmlResponse(err));
    expect(await arxiv.search('electron', { fetch: doFetch })).toMatchObject({ ok: false, code: 'upstream' });
  });

  it('answers bad_response for a page that is not a feed', async () => {
    const { doFetch } = fakeFetch(() => xmlResponse('<html>maintenance</html>'));
    expect(await arxiv.search('electron', { fetch: doFetch })).toMatchObject({ ok: false, code: 'bad_response' });
  });

  it('says so when the feed has no entries', async () => {
    const { doFetch } = fakeFetch(() => xmlResponse('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'));
    expect(await arxiv.search('zzzz', { fetch: doFetch })).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('describes itself for the team graph', () => {
    expect(arxiv.describe.name).toBe('search_preprints');
  });
});

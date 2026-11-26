import { beforeEach, describe, expect, it } from 'vitest';
import { getConnector } from '@/server/connectors';
import { clearConnectorCache } from '@/server/connectors/shared';
import { toolBoxFromConnectors, type ConnectorLookupLike } from '@/server/graph/team/connector-tools';
import { fakeFetch, fixture, jsonResponse } from '../connectors.helpers';

beforeEach(() => clearConnectorCache());

describe('the team tool box over the real connectors', () => {
  it('every tool the graph knows names a connector that exists', () => {
    const box = toolBoxFromConnectors(getConnector);
    for (const id of ['wikipedia', 'worldbank', 'openalex', 'arxiv', 'patentsview']) expect(getConnector(id)).toBeDefined();
    expect(box.info('wikipedia', 'page_summary')).not.toBeNull();
  });

  it('runs a Wikipedia lookup and gives the agent the extract and the link', async () => {
    const f = fixture<{ search: unknown; summary: unknown }>('wikipedia');
    const { doFetch, calls } = fakeFetch((url) => jsonResponse(url.includes('list=search') ? f.search : f.summary));
    const lookup: ConnectorLookupLike = (id) => {
      const c = getConnector(id);
      return c && { id, search: (q, o) => c.search(q, { ...o, fetch: doFetch }) };
    };
    const r = await toolBoxFromConnectors(lookup).run('wikipedia', 'search_pages', { q: 'electron' });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('Wikipedia');
    expect(r.url).toMatch(/^https:\/\/en\.wikipedia\.org\//);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('turns a connector failure into a plain sentence, not a throw', async () => {
    const lookup: ConnectorLookupLike = () => ({ id: 'x', search: async () => ({ ok: false, message: 'The source did not answer.' }) });
    expect(await toolBoxFromConnectors(lookup).run('wikipedia', 'search_pages', { q: 'a' })).toEqual({
      ok: false,
      text: 'The source did not answer.',
    });
  });
});

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

  it('tells the agent plainly when a source is down, and flags it for the workspace', async () => {
    for (const code of ['timeout', 'upstream', 'bad_response']) {
      const lookup: ConnectorLookupLike = () => ({
        id: 'wikipedia',
        label: 'Wikipedia',
        search: async () => ({ ok: false, code, message: 'The source did not answer in time (tried 3 times).' }),
      });
      const r = await toolBoxFromConnectors(lookup).run('wikipedia', 'search_pages', { q: 'a' });
      expect(r.ok).toBe(false);
      expect(r.unavailable).toBe(true);
      expect(r.text).toMatch(/^SOURCE UNAVAILABLE: Wikipedia cannot be used right now/);
      expect(r.text).toContain('do not guess');
    }
  });

  it('a connector that throws, or one that is missing, is unavailable rather than a crash', async () => {
    const throwing: ConnectorLookupLike = () => ({
      id: 'worldbank',
      search: async () => {
        throw new Error('boom');
      },
    });
    expect(await toolBoxFromConnectors(throwing).run('worldbank', 'get_indicator', { country: 'PK', indicator: 'x' })).toMatchObject({
      ok: false,
      unavailable: true,
    });
    expect(await toolBoxFromConnectors(() => undefined).run('arxiv', 'query', { q: 'a' })).toMatchObject({ ok: false, unavailable: true });
  });

  it('no record is a result, not a failure', async () => {
    const lookup: ConnectorLookupLike = () => ({ id: 'x', search: async () => ({ ok: false, code: 'not_found', message: 'No article.' }) });
    expect(await toolBoxFromConnectors(lookup).run('wikipedia', 'search_pages', { q: 'a' })).toEqual({
      ok: true,
      text: 'Nothing found: No article.',
    });
  });

  it('a real connector that keeps failing ends as an unavailable source after its retries', async () => {
    const { doFetch, calls } = fakeFetch(() => new Response('down', { status: 503 }));
    const lookup: ConnectorLookupLike = (id) => {
      const c = getConnector(id);
      return c && { id, label: c.label, search: (q, o) => c.search(q, { ...o, fetch: doFetch }) };
    };
    const r = await toolBoxFromConnectors(lookup).run('wikipedia', 'search_pages', { q: 'electron' });
    expect(r).toMatchObject({ ok: false, unavailable: true });
    expect(r.text).toContain('tried 3 times');
    expect(calls).toHaveLength(3);
  });
});

import { describe, expect, it } from 'vitest';
import { connectors, getConnector, listConnectorTools } from '@/server/connectors';

describe('connector registry', () => {
  it('lists the six public sources', () => {
    expect(connectors.map((c) => c.id)).toEqual(['wikipedia', 'worldbank', 'openalex', 'arxiv', 'patentsview', 'mslearn']);
  });

  it('finds a connector by id and returns undefined for an unknown one', () => {
    expect(getConnector('arxiv')?.label).toBe('arXiv');
    expect(getConnector('nope')).toBeUndefined();
  });

  it('gives each connector a unique tool name and an object input schema', () => {
    const tools = listConnectorTools();
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length);
    for (const t of tools) {
      expect(t.purpose.length).toBeGreaterThan(10);
      expect(t.inputSchema).toMatchObject({ type: 'object', required: ['query'] });
    }
  });
});

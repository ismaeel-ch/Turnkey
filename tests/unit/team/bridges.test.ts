import { describe, expect, it } from 'vitest';
import { eventSinkOver, teamWork, toolBoxFromConnectors, type AgentSinkLike, type ConnectorLike } from '@/server/graph/team';
import { factRequest, scripted } from './fixtures';

const wiki: ConnectorLike = {
  id: 'wikipedia',
  async search(q) {
    return q.includes('Wall')
      ? {
          ok: true,
          items: [
            {
              title: 'Great Wall of China',
              url: 'https://en.wikipedia.org/wiki/Great_Wall_of_China',
              text: 'Not visible from orbit.',
              source: 'Wikipedia',
            },
          ],
        }
      : { ok: false, message: 'No page.' };
  },
};
const bank: ConnectorLike = {
  id: 'worldbank',
  search: async (q) => ({ ok: true, items: [{ title: q, url: 'https://data.worldbank.org', text: 'value', source: 'World Bank' }] }),
};
const lookup = (id: string) => [wiki, bank].find((c) => c.id === id);

describe('connector tools', () => {
  it('turns an agent lookup into a connector search and the items into lines with links', async () => {
    const box = toolBoxFromConnectors(lookup);
    const r = await box.run('wikipedia', 'page_summary', { title: 'Great Wall of China' });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('https://en.wikipedia.org/wiki/Great_Wall_of_China');
    expect((await box.run('wikipedia', 'page_summary', { title: 'Nothing' })).ok).toBe(false);
    expect((await box.run('worldbank', 'get_indicator', { country: 'PK', indicator: 'SP.POP.TOTL' })).text).toContain('PK SP.POP.TOTL');
    expect((await box.run('arxiv', 'query', { search_query: 'x' })).ok).toBe(false);
  });
});

describe('AG-UI bridge', () => {
  it('reads the request from forwardedProps and passes every event on, ending with finish', async () => {
    const calls: string[] = [];
    const sink: AgentSinkLike = {
      input: { forwardedProps: factRequest() },
      signal: new AbortController().signal,
      step: (n) => void calls.push('step:' + n),
      endStep: () => void calls.push('endStep'),
      text: () => void calls.push('text'),
      endText: () => void calls.push('endText'),
      toolCall: (n, a) => (calls.push('tool:' + n + ':' + a), 't1'),
      toolResult: () => void calls.push('result'),
      state: () => void calls.push('state'),
      custom: (n) => void calls.push('custom:' + n),
      finish: (r) => void calls.push('finish:' + JSON.stringify(r)),
      fail: (c) => void calls.push('fail:' + c),
    };
    const { provider } = scripted({
      extractor: [{ say: 'ok', rows: [{ statement: 'The Great Wall', topic: 'science' }] }],
      researchers: [
        { tool: 'wikipedia.page_summary', args: { title: 'Great Wall of China' } },
        { say: 'ok', rows: [{ claim_id: 1, source: 'wikipedia', title: 'Wall', stance: 'contradicts' }] },
      ],
      verifier: [
        { say: 'ok', update: [{ row: 1, verdict: 'contradicted' }], summary: { summary: 's', accuracy: 0, checked_on: '2026-11-26' } },
      ],
    });
    await teamWork({ provider, tools: toolBoxFromConnectors(lookup) })(sink);
    expect(calls).toContain('step:researchers');
    expect(calls.find((c) => c.startsWith('tool:wikipedia.page_summary'))).toContain('Great Wall of China');
    expect(calls).toContain('result');
    expect(calls[calls.length - 1]).toBe('finish:{"status":"done"}');
    expect(calls.filter((c) => c.startsWith('finish') || c.startsWith('fail'))).toHaveLength(1);
  });

  it('maps a failure to fail()', () => {
    const calls: string[] = [];
    const s = eventSinkOver({ fail: (c: string, m: string) => void calls.push(c + ':' + m) } as unknown as AgentSinkLike);
    s.emit({ type: 'RUN_ERROR', message: 'x', code: 'bad_output' });
    expect(calls).toEqual(['bad_output:x']);
  });
});

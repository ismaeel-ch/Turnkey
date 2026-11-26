/**
 * The team runner and its tool boxes on paths the main graph tests do not take: a stop part way, an unexpected
 * failure, a pause that names no agent, and every way a connector can answer.
 */
import { describe, expect, it } from 'vitest';
import { runTeamGraph } from '@/server/graph/team';
import { queryFrom, toolBoxFromConnectors, type ConnectorLike } from '@/server/graph/team/connector-tools';
import { KNOWN_TOOLS, toolBoxFrom, type ToolBox } from '@/server/graph/team/tools';

// A tool box with nothing in it. It lived in tools.ts until #100 removed it as unused outside tests.
const noTools: ToolBox = {
  info: () => null,
  run: async () => ({ ok: false, text: 'No tools are available.' }),
};
import type { Provider } from '@/server/llm';
import { collect, factRequest, fixtureTools } from './fixtures';
import { setLogSink } from '@/server/log';

const finals = (events: { type: string }[]) => events.filter((e) => e.type === 'RUN_FINISHED' || e.type === 'RUN_ERROR');

describe('runTeamGraph edges', () => {
  it('a stop during a model call ends the run as stopped, with one final event', async () => {
    const stop = new AbortController();
    const provider: Provider = {
      id: 'x',
      model: () => 'x',
      async *stream() {
        stop.abort();
        throw new Error('the call was stopped');
      },
    };
    const { sink, events } = collect();
    const r = await runTeamGraph(factRequest({ runId: 'run_stop' }), { provider, tools: fixtureTools(), sink, signal: stop.signal });
    expect(r.status).toBe('stopped');
    expect(finals(events)).toEqual([
      { type: 'RUN_FINISHED', threadId: 'run_stop', runId: 'run_stop', result: { status: 'stopped', reason: 'The run was stopped.' } },
    ]);
  });

  it('an unexpected failure is one plain error event, and is logged on the server only', async () => {
    const provider: Provider = {
      id: 'x',
      model: () => 'x',
      stream: () => {
        throw new TypeError('secret internals at /var/task/x.js');
      },
    };
    // server logs are structured lines (src/server/log.ts), silent under vitest unless LOG_LEVEL is set
    const lines: string[] = [];
    const restoreSink = setLogSink((_level, line) => lines.push(line));
    const level = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = 'error';
    try {
      const { sink, events } = collect();
      const r = await runTeamGraph(factRequest(), { provider, tools: fixtureTools(), sink });
      expect(r).toMatchObject({ status: 'failed', reason: 'The team could not finish this run.' });
      expect(events.at(-1)).toEqual({ type: 'RUN_ERROR', message: 'The team could not finish this run.', code: 'failed' });
      expect(JSON.stringify(events)).not.toContain('/var/task');
      expect(lines.some((l) => JSON.parse(l).event === 'team_failed')).toBe(true);
    } finally {
      restoreSink();
      if (level === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = level;
    }
  });

  it('a bad definition still gets a run id when it has none', async () => {
    const { sink, events } = collect();
    await runTeamGraph('not an object', { provider: null as unknown as Provider, tools: noTools, sink });
    expect(events[0]).toMatchObject({ type: 'RUN_STARTED', runId: expect.stringMatching(/^run_/) });
    expect(events.at(-1)).toMatchObject({ type: 'RUN_ERROR', code: 'bad_request' });
  });
});

describe('team tool boxes', () => {
  it('no tools: nothing is known and a run says so', async () => {
    expect(noTools.info('wikipedia', 'search_pages')).toBeNull();
    expect(await noTools.run('wikipedia', 'search_pages', {})).toEqual({ ok: false, text: 'No tools are available.' });
  });

  it('a tool box tells only about the tools it knows', () => {
    const box = toolBoxFrom(async () => ({ ok: true, text: '' }));
    expect(box.info('arxiv', 'query')).toEqual(KNOWN_TOOLS.find((t) => t.connector === 'arxiv'));
    expect(box.info('arxiv', 'delete_everything')).toBeNull();
  });

  it('builds one query from the arguments: country and indicator for the World Bank, the first non-empty one else', () => {
    expect(queryFrom('worldbank', { country: 'PK', indicator: 'SP.POP.TOTL' })).toBe('PK SP.POP.TOTL');
    expect(queryFrom('worldbank', { indicator: 'SP.POP.TOTL' })).toBe('SP.POP.TOTL');
    expect(queryFrom('wikipedia', { q: '  ', title: ' Lahore ' })).toBe('Lahore');
    expect(queryFrom('openalex', {})).toBe('');
  });

  it('answers in plain sentences for a missing source, a failure and no results, and lists results with links', async () => {
    const searches: Array<[string, unknown]> = [];
    const answers: Record<string, Awaited<ReturnType<ConnectorLike['search']>>> = {
      openalex: { ok: false, message: 'OpenAlex did not answer.' },
      arxiv: { ok: true, items: [] },
      wikipedia: {
        ok: true,
        items: [
          { title: 'Lahore', url: 'https://en.wikipedia.org/wiki/Lahore', text: 'A city in Pakistan.', source: 'Wikipedia' },
          { title: 'Lahore Fort', url: 'https://en.wikipedia.org/wiki/Lahore_Fort', text: 'A citadel.', source: 'Wikipedia' },
        ],
      },
    };
    const box = toolBoxFromConnectors((id) =>
      id in answers ? { id, search: async (q, o) => (searches.push([q, o]), answers[id]) } : undefined,
    );
    expect(await box.run('patentsview', 'search_patents', { q: 'x' })).toEqual({
      ok: false,
      text: 'The source patentsview is not available.',
    });
    expect(await box.run('openalex', 'search_works', { search: 'x' })).toEqual({ ok: false, text: 'OpenAlex did not answer.' });
    expect(await box.run('arxiv', 'query', { search_query: 'x' })).toEqual({ ok: true, text: 'Nothing found.' });
    expect(await box.run('wikipedia', 'search_pages', { q: 'Lahore' })).toEqual({
      ok: true,
      text:
        '- Lahore (Wikipedia): A city in Pakistan. https://en.wikipedia.org/wiki/Lahore\n' +
        '- Lahore Fort (Wikipedia): A citadel. https://en.wikipedia.org/wiki/Lahore_Fort',
      url: 'https://en.wikipedia.org/wiki/Lahore',
    });
    expect(searches.at(-1)).toEqual(['Lahore', { limit: 4 }]);
  });
});

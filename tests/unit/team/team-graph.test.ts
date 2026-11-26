import { describe, expect, it } from 'vitest';
import { EventSchemas as EventSchema } from '@ag-ui/core/schemas';
import { createTeamAgent, runTeamGraph, teamGraphMermaid } from '@/server/graph/team';
import { LlmError } from '@/server/llm';
import { collect, debateRequest, factRequest, fixtureTools, priorRequest, scripted, type Script } from './fixtures';

const claims = {
  say: 'Found two claims.',
  rows: [
    { statement: 'The Great Wall of China is visible from space with the naked eye', topic: 'science' },
    { statement: 'Light from the Sun takes about eight minutes to reach Earth', topic: 'science' },
  ],
};
const lookup = (tool: string, args: object) => ({ tool, args });
const factScript = (): Script => ({
  extractor: [claims],
  researchers: [
    lookup('wikipedia.page_summary', { title: 'Great Wall of China' }),
    {
      say: 'One source per claim.',
      rows: [
        {
          claim_id: 1,
          source: 'wikipedia',
          title: 'Great Wall of China',
          finding: 'Not visible to the naked eye from orbit.',
          stance: 'contradicts',
        },
        { claim_id: 2, source: 'model_knowledge', title: 'Sunlight', finding: 'About eight minutes.', stance: 'supports' },
      ],
    },
  ],
  verifier: [
    {
      say: 'One claim fails.',
      update: [
        { row: 1, verdict: 'contradicted', confidence: 92, reason: 'The source says it is not visible.' },
        { row: 2, verdict: 'supported', confidence: 95, reason: 'Standard figure.' },
      ],
      summary: { summary: 'One of two claims holds.', accuracy: 50, checked_on: '2026-11-26' },
    },
  ],
});

const types = (events: { type: string }[]) => events.map((e) => e.type);
const finals = (events: { type: string }[]) => events.filter((e) => e.type === 'RUN_FINISHED' || e.type === 'RUN_ERROR');

describe('fact-check team', () => {
  it('runs all three agents, calls a tool, and ends with one final event', async () => {
    const { provider, prompts } = scripted(factScript());
    const { sink, events } = collect();
    const calls: string[] = [];
    const r = await runTeamGraph(factRequest(), { provider, tools: fixtureTools(calls), sink });
    expect(r.status).toBe('done');
    expect(Object.keys(r.outputs)).toEqual(['extractor', 'researchers', 'verifier']);
    expect(r.outputs.extractor.rows).toHaveLength(2);
    expect(r.outputs.extractor.rows[0].verdict).toBeUndefined(); // fixed values are added by the workspace, not asked of the model
    expect(r.outputs.verifier.summary).toEqual({ summary: 'One of two claims holds.', accuracy: 50, checked_on: '2026-11-26' });
    expect(calls).toEqual(['wikipedia.page_summary {"title":"Great Wall of China"}']);
    // the researcher saw the tool result, and the verifier saw the claims and evidence the others wrote
    expect(prompts.find((p) => p.agent === 'researchers' && p.prompt.includes('RESULTS OF YOUR LOOKUPS'))!.prompt).toContain(
      'not visible to the naked eye',
    );
    const v = prompts.find((p) => p.agent === 'verifier')!.prompt;
    expect(v).toContain('Great Wall of China is visible from space');
    expect(v).toContain('Not visible to the naked eye from orbit.');
    // events: a step per agent, one tool call with a result, rows as state deltas, one final event, last
    const t = types(events);
    expect(t[0]).toBe('RUN_STARTED');
    expect(t.filter((x) => x === 'STEP_STARTED')).toHaveLength(3);
    expect(t.filter((x) => x === 'STEP_FINISHED')).toHaveLength(3);
    expect(t.filter((x) => x === 'TOOL_CALL_START')).toHaveLength(1);
    expect(t.filter((x) => x === 'TOOL_CALL_RESULT')).toHaveLength(1);
    expect(finals(events)).toHaveLength(1);
    expect(t[t.length - 1]).toBe('RUN_FINISHED');
    expect(events.filter((e) => e.type === 'STATE_DELTA').length).toBeGreaterThanOrEqual(7);
  });

  it('emits events that AG-UI accepts', async () => {
    const { provider } = scripted(factScript());
    const { sink, events } = collect();
    await runTeamGraph(factRequest(), { provider, tools: fixtureTools(), sink });
    for (const e of events) {
      const r = EventSchema.safeParse({ ...e, timestamp: 1 });
      expect(r.success, JSON.stringify(e)).toBe(true);
    }
  });

  it('draws the compiled graph', async () => {
    const m = await teamGraphMermaid(factRequest());
    for (const n of ['agent_extractor', 'agent_researchers', 'tools_researchers', 'check_verifier', 'finish']) expect(m).toContain(n);
    expect(m).not.toContain('tools_extractor');
    if (process.env.DRAW_GRAPH) console.info(m);
  });
});

describe('prior-art team', () => {
  it('runs Search with three sources, then Analyst and Critic', async () => {
    const { provider } = scripted({
      search: [
        lookup('patentsview.search_patents', { q: 'shelf camera stock' }),
        lookup('openalex.search_works', { search: 'shelf stock detection' }),
        {
          say: 'Two close records.',
          rows: [
            { title: 'Shelf monitoring using image sensors', source: 'patentsview', overlap: 'high', year: 2018 },
            { title: 'Automated on-shelf availability monitoring', source: 'openalex', overlap: 'medium', year: 2021 },
          ],
        },
      ],
      analyst: [{ say: 'Compared.', rows: [{ point: 'Same counting method', kind: 'overlap', prior_work_id: 1 }] }],
      critic: [
        {
          say: 'Fairly new.',
          rows: [{ point: 'The warning step may be the novel part', kind: 'risk' }],
          summary: { novelty: 'medium', summary: 'Partly new.', assessed_on: '2026-11-26' },
        },
      ],
    });
    const calls: string[] = [];
    const { sink, events } = collect();
    const r = await runTeamGraph(priorRequest(), { provider, tools: fixtureTools(calls), sink });
    expect(r.status).toBe('done');
    expect(calls.map((c) => c.split(' ')[0])).toEqual(['patentsview.search_patents', 'openalex.search_works']);
    expect(r.outputs.critic.summary?.novelty).toBe('medium');
    expect(events.filter((e) => e.type === 'TOOL_CALL_START')).toHaveLength(2);
  });
});

describe('debate team and its pause', () => {
  const script = (): Script => ({
    for_side: [{ say: 'For.', rows: [{ point: 'Fewer bugs ship', detail: 'Stability first.', strength: 'strong' }] }],
    against_side: [{ say: 'Against.', rows: [{ point: 'Customers wait longer', strength: 'moderate', reply_to: 1 }] }],
    moderator: [
      {
        say: 'Summed up.',
        rows: [{ kind: 'recommendation', text: 'Freeze for one sprint' }],
        summary: { leaning: 'for', summary: 'Lean for.', debated_on: '2026-11-26' },
      },
    ],
  });

  it('stops before the Moderator, then resumes with the note in a new request', async () => {
    const first = scripted(script());
    const a = collect();
    const r1 = await runTeamGraph(debateRequest(), { provider: first.provider, tools: fixtureTools(), sink: a.sink });
    expect(r1.status).toBe('paused');
    expect(Object.keys(r1.outputs)).toEqual(['for_side', 'against_side']);
    expect(first.prompts.some((p) => p.agent === 'moderator')).toBe(false);
    const interrupt = a.events.find((e) => e.type === 'CUSTOM' && e.name === 'interrupt');
    expect(interrupt).toBeTruthy();
    expect(finals(a.events)).toHaveLength(1);
    expect(a.events[a.events.length - 1]).toMatchObject({ type: 'RUN_FINISHED', result: { status: 'paused' } });

    // a new request: nothing is kept on the server, the snapshot travels through the browser
    const snapshot = JSON.parse(JSON.stringify(r1.snapshot));
    const second = scripted(script());
    const b = collect();
    const r2 = await runTeamGraph(
      debateRequest({ resume: { snapshot, note: { who: 'Maryam', text: 'Support is already stretched thin' } } }),
      { provider: second.provider, tools: fixtureTools(), sink: b.sink },
    );
    expect(r2.status).toBe('done');
    expect(Object.keys(r2.outputs)).toEqual(['for_side', 'against_side', 'moderator']);
    expect(second.prompts.map((p) => p.agent).filter((x) => !x.startsWith('review'))).toEqual(['moderator']);
    const mod = second.prompts.find((p) => p.agent === 'moderator')!.prompt;
    expect(mod).toContain('Support is already stretched thin');
    expect(mod).toContain('Fewer bugs ship');
    expect(b.events.some((e) => e.type === 'CUSTOM' && e.name === 'resume')).toBe(true);
    expect(finals(b.events)).toHaveLength(1);
  });

  it('can pause before the first agent', async () => {
    const req = debateRequest();
    req.team.pause = { before: 'for_side', text: 'Anything to add first?' };
    const s = scripted(script());
    const a = collect();
    const r1 = await runTeamGraph(req, { provider: s.provider, tools: fixtureTools(), sink: a.sink });
    expect(r1.status).toBe('paused');
    expect(r1.modelCalls).toBe(0);
    const r2 = await runTeamGraph(
      { ...req, resume: { snapshot: JSON.parse(JSON.stringify(r1.snapshot)), note: { who: 'Sam', text: 'Mind the support rota' } } },
      { provider: scripted(script()).provider, tools: fixtureTools(), sink: collect().sink },
    );
    expect(r2.status).toBe('done');
  });
});

describe('checks that send work back', () => {
  it('sends a draft back once with the reason, and the second answer passes', async () => {
    const s = factScript();
    s.verifier = [{ say: 'Done.', update: [{ row: 1, verdict: 'contradicted' }] }, ...s.verifier]; // the first answer has no summary
    const { provider, prompts } = scripted(s);
    const { sink, events } = collect();
    const r = await runTeamGraph(factRequest(), { provider, tools: fixtureTools(), sink });
    expect(r.status).toBe('done');
    const checks = events
      .filter((e) => e.type === 'CUSTOM' && e.name === 'check')
      .map((e) => (e as { value: Record<string, unknown> }).value);
    const verifier = checks.filter((c) => c.agent === 'verifier');
    expect(verifier).toHaveLength(2);
    expect(verifier[0]).toMatchObject({ ok: false, sentBack: true, by: 'rules' });
    expect(String(verifier[0].reason)).toContain('summary');
    expect(verifier[1]).toMatchObject({ ok: true, sentBack: false });
    const second = prompts.filter((p) => p.agent === 'verifier')[1].prompt;
    expect(second).toContain('SENT BACK');
    expect(second).toContain('summary');
    expect(r.outputs.verifier.summary?.accuracy).toBe(50);
  });

  it('lets a reviewer model send work back, once', async () => {
    const s: Script = {
      ...factScript(),
      review: [
        { ok: false, reason: 'Claim 2 has no evidence.' },
        { ok: false, reason: 'Still not good.' },
      ],
    };
    const { provider, prompts } = scripted(s);
    const { sink, events } = collect();
    const r = await runTeamGraph(factRequest(), { provider, tools: fixtureTools(), sink });
    expect(r.status).toBe('done'); // the second answer is kept even if the reviewer is still unhappy: one send-back only
    const sent = events.filter(
      (e) => e.type === 'CUSTOM' && e.name === 'check' && (e as unknown as { value: { sentBack: boolean } }).value.sentBack,
    );
    expect(sent).toHaveLength(3); // once per agent, never twice for the same agent
    expect(prompts.filter((p) => p.agent === 'extractor')).toHaveLength(2);
    expect(prompts.find((p) => p.prompt.includes('Claim 2 has no evidence.'))).toBeTruthy();
  });

  it('drops a choice outside its options and says so', async () => {
    const s = factScript();
    s.extractor = [{ say: 'x', rows: [{ statement: 'A', topic: 'astrology' }] }, claims];
    const { provider } = scripted(s);
    const { sink, events } = collect();
    const r = await runTeamGraph(factRequest(), { provider, tools: fixtureTools(), sink });
    expect(r.status).toBe('done');
    expect(r.outputs.extractor.rows).toHaveLength(2);
    expect(JSON.stringify(events)).toContain('must be exactly one of');
  });
});

describe('caps', () => {
  it('never runs more tools than the cap, even if the model keeps asking', async () => {
    const s = factScript();
    s.researchers = [lookup('wikipedia.page_summary', { title: 'a' })]; // always asks, never answers
    const { provider } = scripted(s);
    const calls: string[] = [];
    const { sink, events } = collect();
    const r = await runTeamGraph(factRequest({ limits: { toolCallsPerAgent: 2 } }), { provider, tools: fixtureTools(calls), sink });
    expect(calls).toHaveLength(2);
    expect(r.status).toBe('failed');
    expect(finals(events)).toHaveLength(1);
    expect(events[events.length - 1].type).toBe('RUN_ERROR');
  });

  it('ends a run that uses up its model calls, with what is done so far', async () => {
    const { provider } = scripted(factScript());
    const { sink, events } = collect();
    const r = await runTeamGraph(factRequest({ limits: { maxModelCalls: 4 } }), { provider, tools: fixtureTools(), sink });
    expect(r.status).toBe('capped');
    expect(r.modelCalls).toBeLessThanOrEqual(4);
    expect(Object.keys(r.outputs)).toContain('extractor');
    expect(events.some((e) => e.type === 'CUSTOM' && e.name === 'cap')).toBe(true);
    expect(events[events.length - 1]).toMatchObject({ type: 'RUN_FINISHED', result: { status: 'capped' } });
  });

  it('ends a run that uses up its steps', async () => {
    const s = factScript();
    s.verifier = [{ say: 'x', update: [] }]; // always sent back first, then accepted
    const { provider } = scripted(s);
    const r = await runTeamGraph(factRequest({ limits: { maxSteps: 4 } }), { provider, tools: fixtureTools(), sink: collect().sink });
    expect(r.status).toBe('capped');
    expect(r.steps).toBeLessThanOrEqual(6);
  });

  it('ends a run that passes its time limit', async () => {
    let t = 0;
    const { provider } = scripted(factScript());
    const r = await runTeamGraph(factRequest({ limits: { maxMillis: 5000 } }), {
      provider,
      tools: fixtureTools(),
      sink: collect().sink,
      now: () => (t += 3000),
    });
    expect(r.status).toBe('capped');
  });

  it('gives up after three unusable answers, with one error event', async () => {
    const { provider } = scripted({ extractor: ['I think there are two claims.'] });
    const { sink, events } = collect();
    const r = await runTeamGraph(factRequest(), { provider, tools: fixtureTools(), sink });
    expect(r.status).toBe('failed');
    expect(r.modelCalls).toBe(3);
    expect(finals(events)).toHaveLength(1);
    expect(events[events.length - 1]).toMatchObject({ type: 'RUN_ERROR', code: 'bad_output' });
  });

  it('turns a model failure into one plain error event', async () => {
    const provider = {
      id: 'x',
      model: () => 'x',
      stream: () => {
        throw new LlmError('rate_limited', 'Too many model calls in one minute.', 429);
      },
    };
    const { sink, events } = collect();
    const r = await runTeamGraph(factRequest(), { provider, tools: fixtureTools(), sink });
    expect(r.status).toBe('failed');
    expect(events[events.length - 1]).toMatchObject({ type: 'RUN_ERROR', code: 'rate_limited' });
  });

  it('rejects a team definition that is not valid, still ending with a final event', async () => {
    const { sink, events } = collect();
    const r = await runTeamGraph({ team: { agents: [] } }, { provider: scripted({}).provider, tools: fixtureTools(), sink });
    expect(r.status).toBe('failed');
    expect(finals(events)).toHaveLength(1);
  });
});

describe('createTeamAgent', () => {
  it('says plainly when no model is configured', async () => {
    const { sink, events } = collect();
    const agent = createTeamAgent({ provider: null });
    expect(agent.id).toBe('team');
    const r = await agent.run(factRequest(), sink);
    expect(r.status).toBe('failed');
    expect(events[events.length - 1]).toMatchObject({ type: 'RUN_ERROR', code: 'not_configured' });
  });

  it('runs with the guard called before every model call', async () => {
    let n = 0;
    const agent = createTeamAgent({ provider: scripted(factScript()).provider, tools: fixtureTools(), beforeModelCall: () => void n++ });
    const r = await agent.run(factRequest(), collect().sink);
    expect(r.status).toBe('done');
    expect(n).toBe(r.modelCalls);
  });
});

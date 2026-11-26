/** Made-up teams and recorded tool results for the team graph tests. No real client or customer data. */
import { mockProvider } from '@/server/llm/providers/mock';
import type { ChatRequest, Provider } from '@/server/llm';
import { TeamRequestSchema, type EventSink, type TeamEvent, type TeamRequest } from '@/server/graph/team/types';
import { KNOWN_TOOLS, toolBoxFrom, type ToolBox } from '@/server/graph/team/tools';

const sel = (name: string, ...options: string[]) => ({ name, type: 'select' as const, options });
const col = (name: string, type: 'text' | 'longtext' | 'number' | 'date' | 'ref', ref?: string) => ({
  name,
  type,
  ...(ref ? { ref } : {}),
});

export const factTables = [
  {
    name: 'checks',
    one: 'Check',
    columns: [
      col('title', 'text'),
      col('text', 'longtext'),
      sel('status', 'queued', 'checking', 'checked', 'published'),
      col('summary', 'longtext'),
      col('accuracy', 'number'),
      col('checked_on', 'date'),
    ],
  },
  {
    name: 'claims',
    one: 'Claim',
    columns: [
      col('check_id', 'ref', 'checks'),
      col('statement', 'text'),
      sel('topic', 'science', 'health', 'geography', 'other'),
      sel('verdict', 'unverified', 'contradicted', 'supported', 'mixed', 'unverifiable'),
      col('confidence', 'number'),
      col('reason', 'longtext'),
    ],
  },
  {
    name: 'evidence',
    one: 'Piece of evidence',
    columns: [
      col('claim_id', 'ref', 'claims'),
      sel('source', 'wikipedia', 'world_bank', 'model_knowledge'),
      col('title', 'text'),
      col('finding', 'longtext'),
      sel('stance', 'neutral', 'contradicts', 'supports'),
      col('url', 'text'),
    ],
  },
];
const factText =
  'The Great Wall of China is visible from space with the naked eye. Light from the Sun takes about eight minutes to reach Earth.';
export const factRequest = (over: Record<string, unknown> = {}): TeamRequest =>
  TeamRequestSchema.parse({
    appName: 'Fact Desk',
    team: {
      title: 'Fact-check team',
      about: 'Three agents work on one text, one after another.',
      agents: [
        {
          id: 'extractor',
          name: 'Extractor',
          job: 'Splits the text into separate factual claims.',
          writes: 'claims',
          fixed: { verdict: 'unverified' },
        },
        {
          id: 'researchers',
          name: 'Researchers',
          job: 'Look for evidence, one researcher per claim.',
          writes: 'evidence',
          tools: [
            { connector: 'wikipedia', tool: 'page_summary' },
            { connector: 'worldbank', tool: 'get_indicator' },
          ],
        },
        {
          id: 'verifier',
          name: 'Verifier',
          job: 'Weighs the evidence and gives every claim a verdict.',
          updates: 'claims',
          sets: ['summary', 'accuracy', 'checked_on'],
        },
      ],
    },
    input: { table: 'checks', column: 'text', text: factText },
    tables: factTables,
    ...over,
  });

export const priorTables = [
  {
    name: 'ideas',
    one: 'Idea',
    columns: [
      col('title', 'text'),
      col('description', 'longtext'),
      sel('novelty', 'unknown', 'high', 'medium', 'low'),
      col('summary', 'longtext'),
      col('assessed_on', 'date'),
    ],
  },
  {
    name: 'prior_work',
    one: 'Piece of prior work',
    columns: [
      col('idea_id', 'ref', 'ideas'),
      col('title', 'text'),
      sel('source', 'patentsview', 'openalex', 'arxiv', 'model_knowledge'),
      sel('overlap', 'high', 'medium', 'low'),
      col('year', 'number'),
      col('note', 'longtext'),
    ],
  },
  {
    name: 'findings',
    one: 'Finding',
    columns: [
      col('idea_id', 'ref', 'ideas'),
      col('point', 'text'),
      sel('kind', 'overlap', 'difference', 'risk', 'next_step'),
      col('prior_work_id', 'ref', 'prior_work'),
      col('detail', 'longtext'),
    ],
  },
];
export const priorRequest = (over: Record<string, unknown> = {}): TeamRequest =>
  TeamRequestSchema.parse({
    appName: 'Prior Art Scout',
    team: {
      title: 'Prior-art team',
      about: 'Three agents weigh one idea against earlier work.',
      agents: [
        {
          id: 'search',
          name: 'Search',
          job: 'Searches patents, papers and preprints.',
          writes: 'prior_work',
          tools: [
            { connector: 'patentsview', tool: 'search_patents' },
            { connector: 'openalex', tool: 'search_works' },
            { connector: 'arxiv', tool: 'query' },
          ],
        },
        { id: 'analyst', name: 'Analyst', job: 'Compares the idea with each piece of prior work.', writes: 'findings' },
        {
          id: 'critic',
          name: 'Critic',
          job: 'Challenges the analysis and rates how new the idea is.',
          writes: 'findings',
          sets: ['novelty', 'summary', 'assessed_on'],
        },
      ],
    },
    input: { table: 'ideas', column: 'description', text: 'A shelf camera that counts stock and warns when a product runs low.' },
    tables: priorTables,
    ...over,
  });

export const debateTables = [
  {
    name: 'debates',
    one: 'Debate',
    columns: [
      col('motion', 'text'),
      sel('leaning', 'undecided', 'for', 'against', 'split'),
      col('summary', 'longtext'),
      col('debated_on', 'date'),
    ],
  },
  {
    name: 'arguments',
    one: 'Argument',
    columns: [
      col('debate_id', 'ref', 'debates'),
      sel('side', 'for', 'against', 'floor'),
      col('point', 'text'),
      col('detail', 'longtext'),
      sel('strength', 'strong', 'moderate', 'weak'),
      col('reply_to', 'ref', 'arguments'),
    ],
  },
  {
    name: 'takeaways',
    one: 'Takeaway',
    columns: [col('debate_id', 'ref', 'debates'), sel('kind', 'agreed', 'recommendation', 'risk', 'open_question'), col('text', 'text')],
  },
];
export const debateRequest = (over: Record<string, unknown> = {}): TeamRequest =>
  TeamRequestSchema.parse({
    appName: 'Second Opinion',
    team: {
      title: 'Debate team',
      about: 'Two agents argue one motion and a third sums up.',
      agents: [
        {
          id: 'for_side',
          name: 'For',
          job: 'Makes the strongest honest case for the motion.',
          writes: 'arguments',
          fixed: { side: 'for' },
        },
        {
          id: 'against_side',
          name: 'Against',
          job: 'Makes the strongest honest case against the motion.',
          writes: 'arguments',
          fixed: { side: 'against' },
        },
        {
          id: 'moderator',
          name: 'Moderator',
          job: 'Weighs both sides and records what is agreed and open.',
          writes: 'takeaways',
          sets: ['leaning', 'summary', 'debated_on'],
        },
      ],
      pause: { before: 'moderator', text: 'Both sides have spoken. Add a point of your own before the Moderator sums up, or continue.' },
    },
    input: { table: 'debates', column: 'motion', text: 'Freeze new features for one sprint to pay down bugs' },
    tables: debateTables,
    ...over,
  });

/** Recorded results of the public sources, trimmed. */
export const recorded: Record<string, string> = {
  'wikipedia.page_summary':
    'Great Wall of China: a series of fortifications. Contrary to a popular myth, it is generally not visible to the naked eye from low Earth orbit.',
  'worldbank.get_indicator': 'SP.POP.TOTL PK 2022: 235,824,862',
  'patentsview.search_patents':
    'US 10,000,001 "Shelf monitoring using image sensors" (2018); US 10,000,002 "Inventory counting from camera frames" (2019)',
  'openalex.search_works': 'Retail shelf stock detection with deep learning (2020); Automated on-shelf availability monitoring (2021)',
  'arxiv.query': 'arXiv:2001.00001 Counting products on shelves from a single camera (2020)',
};
export function fixtureTools(calls: string[] = []): ToolBox {
  return toolBoxFrom(async (connector, tool, args) => {
    calls.push(`${connector}.${tool} ${JSON.stringify(args)}`);
    const text = recorded[`${connector}.${tool}`];
    return text ? { ok: true, text } : { ok: false, text: 'No result.' };
  }, KNOWN_TOOLS);
}

/** Replies for a team, by agent id; the reviewer is its own list. The last reply of a list repeats. */
export type Script = Record<string, (string | object)[]> & { review?: (string | object)[] };
export function scripted(script: Script): { provider: Provider; prompts: { agent: string; prompt: string }[] } {
  const used: Record<string, number> = {};
  const prompts: { agent: string; prompt: string }[] = [];
  const provider = mockProvider((req: ChatRequest) => {
    const prompt = req.messages[req.messages.length - 1].content;
    const reviewer = prompt.startsWith('You check the work of the agent ');
    const name = reviewer ? /agent (.+?) in the app/.exec(prompt)![1] : /^You are (.+?), one of/.exec(prompt)![1];
    const key = reviewer
      ? 'review:' + name
      : (Object.keys(script).find((k) => k !== 'review' && script[k] && agentName(k) === name) ?? name);
    prompts.push({ agent: reviewer ? 'review:' + name : key, prompt });
    const list = (reviewer ? script.review : script[key]) ?? (reviewer ? [{ ok: true }] : []);
    const i = used[key] ?? 0;
    used[key] = i + 1;
    const r = list[Math.min(i, list.length - 1)] ?? '{}';
    return typeof r === 'string' ? r : JSON.stringify(r);
  });
  return { provider, prompts };
}
const names: Record<string, string> = {
  extractor: 'Extractor',
  researchers: 'Researchers',
  verifier: 'Verifier',
  search: 'Search',
  analyst: 'Analyst',
  critic: 'Critic',
  for_side: 'For',
  against_side: 'Against',
  moderator: 'Moderator',
};
const agentName = (id: string) => names[id] ?? id;

export function collect(): { sink: EventSink; events: TeamEvent[] } {
  const events: TeamEvent[] = [];
  return { sink: { emit: (e) => void events.push(e) }, events };
}

/** The words each agent and the checker are given. Server only. A port of `teamPrompt` in src/workspace/team.tsx. */
import type { AgentOutput, AgentSpec, Note, TableSpec, TeamRequest } from './types';
import type { ToolInfo } from './tools';

export type Lookup = { label: string; ok: boolean; text: string };

export type PromptContext = {
  req: TeamRequest;
  agent: AgentSpec;
  /** rows written so far in this run, by table, in order. Row numbers in the prompt are positions in these lists. */
  work: Record<string, Record<string, unknown>[]>;
  notes: Note[];
  tools: ToolInfo[];
  /** lookups this agent has already made in this turn */
  lookups: Lookup[];
  lookupsLeft: number;
  feedback: string;
};

export const SYSTEM =
  'You are one agent in a small team inside a business app. Do your own job and nothing else. ' +
  'Answer with exactly one JSON object and nothing around it: no prose, no code fences.';

const colText = (t: TableSpec, skip: Set<string>, made: Record<string, unknown[]>, inputTable: string) =>
  t.columns
    .filter(
      (c) =>
        !skip.has(c.name) && c.type !== 'user' && !(c.type === 'ref' && (c.ref === inputTable || (!made[c.ref ?? ''] && c.ref !== t.name))),
    )
    .map(
      (c) =>
        c.name +
        ':' +
        c.type +
        (c.type === 'select'
          ? '[' + (c.options ?? []).join('|') + ']'
          : c.type === 'ref'
            ? ` (the number of a ${c.ref} row under WORK SO FAR)`
            : ''),
    )
    .join(', ');

export function agentPrompt(p: PromptContext): string {
  const { req, agent } = p;
  const { team, tables, input } = req;
  const table = (n: string | null | undefined) => tables.find((t) => t.name === n);
  const fmt = ['"say":"one sentence on what you did"'];
  const wt = table(agent.writes);
  if (wt)
    fmt.push(
      `"rows":[{...}] where each row has these columns of ${wt.name}: ` +
        colText(wt, new Set(Object.keys(agent.fixed)), p.work, input.table),
    );
  const ut = table(agent.updates);
  if (ut)
    fmt.push(
      `"update":[{"row":the number of a ${ut.name} row, ...}] with any of these columns: ` + colText(ut, new Set(), p.work, input.table),
    );
  const it = table(input.table);
  if (agent.sets.length && it)
    fmt.push(
      '"summary":{...} with these columns of the ' +
        (it.one ?? it.name).toLowerCase() +
        ': ' +
        agent.sets
          .map((k) => {
            const c = it.columns.find((x) => x.name === k);
            return c ? k + ':' + c.type + (c.type === 'select' ? '[' + (c.options ?? []).join('|') + ']' : '') : k;
          })
          .join(', '),
    );

  const work =
    Object.entries(p.work)
      .map(([tn, rows]) => tn + ':\n' + rows.map((r, i) => `${i + 1}. ${JSON.stringify(r)}`).join('\n'))
      .join('\n\n') || '(nothing yet)';

  const row = Object.keys(input.row).length ? input.row : { [input.column]: input.text };
  const parts = [
    `You are ${agent.name}, one of ${team.agents.length} agents inside the app "${req.appName}". ${team.about}`,
    `YOUR JOB: ${agent.job}${agent.hint ? ' ' + agent.hint : ''}`,
    `THE ${(it?.one ?? 'item').toUpperCase()} YOU ARE WORKING ON:\n${JSON.stringify(row)}`,
    `WORK SO FAR:\n${work}`,
  ];
  if (p.notes.length)
    parts.push('ADDED BY PEOPLE DURING THIS RUN (take these into account):\n' + p.notes.map((n) => `- ${n.who}: ${n.text}`).join('\n'));

  if (p.tools.length) {
    const list = p.tools.map((t) => `- ${t.connector}.${t.tool}: ${t.description}. args: ${JSON.stringify(t.args)}`).join('\n');
    parts.push(
      p.lookupsLeft > 0
        ? `TOOLS you may use to look things up (${p.lookupsLeft} lookup${p.lookupsLeft === 1 ? '' : 's'} left):\n${list}\nTo use one, reply with ONLY {"tool":"connector.tool","args":{...}} and you will be given the result. When you have what you need, reply with your final answer.`
        : 'You have used all your lookups. Give your final answer now, from the results below.',
    );
  } else parts.push('You have no tools. Work from what you know. Do not invent citations, links or statistics.');
  if (p.lookups.length)
    parts.push('RESULTS OF YOUR LOOKUPS:\n' + p.lookups.map((l) => `[${l.label}] ${l.ok ? '' : '(failed) '}${l.text}`).join('\n\n'));
  if (p.feedback) parts.push(`YOUR LAST ANSWER WAS SENT BACK. Reason: ${p.feedback}\nFix exactly this and answer again.`);
  parts.push(
    `Final answer: ONE JSON object {${fmt.join(', ')}}\nRules: at most 6 rows. Keep every text under 280 characters. A choice column takes exactly one of its listed options. Dates are YYYY-MM-DD. Only use evidence from the lookups above; if there is none, say so and do not make up sources, links or numbers. If a column is a "source" or "url", copy it from a lookup.`,
  );
  return parts.join('\n\n');
}

export function reviewPrompt(req: TeamRequest, agent: AgentSpec, output: AgentOutput): string {
  return [
    `You check the work of the agent ${agent.name} in the app "${req.appName}".`,
    `Its job: ${agent.job}${agent.hint ? ' ' + agent.hint : ''}`,
    `The text it worked on:\n${req.input.text.slice(0, 2000)}`,
    `Its work:\n${JSON.stringify(output).slice(0, 4000)}`,
    'Is the work on the job, specific, and free of made-up facts? Reply with ONE JSON object: {"ok":true} or {"ok":false,"reason":"one sentence on what to fix"}. Only send it back for a real problem.',
  ].join('\n\n');
}

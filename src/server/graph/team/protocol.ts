/**
 * Reading what a model sends back. Server only.
 *
 * An agent answers in one of two shapes, always as one JSON object:
 *   a lookup    {"tool":"wikipedia.page_summary","args":{"title":"Photosynthesis"}}
 *   an answer   {"say":"...","rows":[...],"update":[...],"summary":{...}}
 * Native tool calling is not used: the gateway may not support it, and this works on any model.
 */
import type { AgentOutput, AgentSpec, TableSpec } from './types';

/** Finds the first complete JSON object in a reply, ignoring prose and code fences around it. */
export function extractJson(raw: string): unknown {
  const s = raw.replace(/```(?:json)?/gi, '');
  for (let start = s.indexOf('{'); start !== -1; start = s.indexOf('{', start + 1)) {
    let depth = 0;
    let inStr = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error('The reply had no JSON object in it.');
}

export type Turn =
  { kind: 'tool'; connector: string; tool: string; args: Record<string, string> } | { kind: 'answer'; raw: Record<string, unknown> };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseTurn(raw: string): Turn {
  const o = extractJson(raw);
  if (!isObj(o)) throw new Error('The reply was not a JSON object.');
  const t = o.tool;
  if (typeof t === 'string' && t.trim()) {
    const [connector, tool] = t.trim().split('.');
    if (!connector || !tool) throw new Error('A tool is written as "connector.tool", for example "wikipedia.page_summary".');
    const args: Record<string, string> = {};
    if (isObj(o.args))
      for (const [k, v] of Object.entries(o.args)) if (typeof v === 'string' || typeof v === 'number') args[k] = String(v).slice(0, 300);
    return { kind: 'tool', connector, tool, args };
  }
  return { kind: 'answer', raw: o };
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Turns a model's answer into the shape the workspace applies. Unknown columns are dropped, text is clipped, a choice
 * outside its options is dropped. Everything dropped or missing is reported in `problems`, which the check reads.
 */
export function normalizeOutput(
  raw: Record<string, unknown>,
  agent: AgentSpec,
  tables: TableSpec[],
  inputTable: string,
): { output: AgentOutput; problems: string[] } {
  const problems: string[] = [];
  const table = (n: string | null | undefined) => tables.find((t) => t.name === n);
  const clean = (t: TableSpec, row: unknown, label: string, skip: Set<string>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (!isObj(row)) {
      problems.push(label + ' is not an object.');
      return out;
    }
    for (const c of t.columns) {
      const v = row[c.name];
      if (v === undefined || v === null || v === '' || skip.has(c.name)) continue;
      if (c.type === 'user') continue;
      if (c.type === 'select') {
        const opts = c.options ?? [];
        if (typeof v === 'string' && opts.includes(v)) out[c.name] = v;
        else problems.push(`${label}: "${c.name}" must be exactly one of ${opts.join(', ')}, not ${JSON.stringify(v).slice(0, 40)}.`);
      } else if (c.type === 'number' || c.type === 'money' || c.type === 'ref') {
        const n = Number(v);
        if (Number.isFinite(n)) out[c.name] = n;
        else problems.push(`${label}: "${c.name}" must be a number.`);
      } else if (c.type === 'bool') out[c.name] = v === true || v === 'true' || v === 1;
      else out[c.name] = clip(String(v), c.type === 'longtext' ? 1500 : 280);
    }
    return out;
  };

  const say = typeof raw.say === 'string' && raw.say.trim() ? clip(raw.say.trim(), 280) : agent.name + ' finished.';
  const out: AgentOutput = { say, rows: [], update: [], summary: null };
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);

  const wt = table(agent.writes);
  if (agent.writes) {
    if (!wt) problems.push(`The table ${agent.writes} is not known.`);
    else {
      const fixed = new Set(Object.keys(agent.fixed));
      // a column that points at the run's own input row is filled in by the workspace
      const own = new Set(wt.columns.filter((c) => c.type === 'ref' && c.ref === inputTable).map((c) => c.name));
      arr(raw.rows)
        .slice(0, 6)
        .forEach((r, i) => out.rows.push(clean(wt, r, `row ${i + 1}`, new Set([...fixed, ...own]))));
      if (arr(raw.rows).length > 6) problems.push('Only the first 6 rows are kept.');
    }
  }
  const ut = table(agent.updates);
  if (agent.updates && ut) {
    arr(raw.update)
      .slice(0, 12)
      .forEach((u, i) => {
        const row = isObj(u) ? Number(u.row) : NaN;
        if (!Number.isInteger(row) || row < 1) return void problems.push(`update ${i + 1}: "row" must be the number of a ${ut.name} row.`);
        out.update.push({ ...clean(ut, u, `update ${i + 1}`, new Set(['row'])), row });
      });
  }
  if (agent.sets.length) {
    const it = table(inputTable);
    const pick: Record<string, unknown> = {};
    if (isObj(raw.summary) && it) {
      const sub = clean({ ...it, columns: it.columns.filter((c) => agent.sets.includes(c.name)) }, raw.summary, 'summary', new Set());
      Object.assign(pick, sub);
    }
    out.summary = Object.keys(pick).length ? pick : null;
  }
  return { output: out, problems };
}

/** Rules every agent's work must meet before the next agent starts. Returns what is wrong, in plain words. */
export function ruleCheck(agent: AgentSpec, output: AgentOutput, problems: string[], hasRowsToUpdate: boolean): string[] {
  const bad = [...problems];
  if (agent.writes && output.rows.length === 0) bad.push(`You wrote no rows to ${agent.writes}. Write at least one.`);
  if (agent.updates && hasRowsToUpdate && output.update.length === 0)
    bad.push(`You updated no ${agent.updates} rows. Give each one a verdict or change.`);
  if (agent.sets.length && !output.summary) bad.push(`The "summary" object is missing or empty. It needs: ${agent.sets.join(', ')}.`);
  return bad;
}

/**
 * What the team definition may say. Server only.
 *
 * The team (names, jobs, hints, the about text, the pause text) comes from the browser and goes into prompts this
 * server builds, so it is checked before any model call. The person's own text (the input and their notes) is data:
 * it goes into the prompt as JSON and is not checked here. The schema in types.ts already caps every length.
 *
 *   one-line fields   app name, team title, agent ids and names, table and tool names: no line breaks or control characters
 *   text fields       about, job, hint, pause text: no control characters, no text that tries to give the model new orders
 */
import type { TeamRequest } from './types';

export type TeamPolicyVerdict = { ok: true } | { ok: false; field: string; message: string };

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/;
const CONTROL_OR_BREAK = /[\u0000-\u001f\u007f\u2028\u2029]/;

/** Phrases that address the model instead of describing an agent's job. Matched case-insensitively. */
const ORDERS: RegExp[] = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|other|all|any|system)\b[^.\n]{0,20}\b(instructions?|rules?|prompts?|messages?|text)\b/i,
  /\bsystem\s+prompt\b/i,
  /\b(new|updated|real|hidden)\s+instructions?\b/i,
  /\byou\s+are\s+now\b/i,
  /\b(act|behave|respond)\s+as\s+(if|an?|the)\b/i,
  /\b(reveal|print|repeat|show|output)\b[^.\n]{0,30}\b(prompt|instructions|api\s*key|secret|password|environment)\b/i,
  /\bdo\s+not\s+(follow|obey)\b/i,
  /^\s*(system|assistant|user|developer)\s*:/im,
  /<\/?\s*(system|assistant|user|developer|instructions?)\s*>/i,
  /```/,
];

function oneLine(field: string, v: string | null | undefined): TeamPolicyVerdict | null {
  if (v == null) return null;
  if (CONTROL_OR_BREAK.test(v)) return { ok: false, field, message: `${field} must be one line of plain text.` };
  if (v.includes('"') && field !== 'team.title') return { ok: false, field, message: `${field} may not contain quotes.` };
  return null;
}

function prose(field: string, v: string | null | undefined): TeamPolicyVerdict | null {
  if (v == null || v === '') return null;
  if (CONTROL.test(v)) return { ok: false, field, message: `${field} contains control characters.` };
  if (ORDERS.some((re) => re.test(v)))
    return { ok: false, field, message: `${field} reads like instructions to the model, not a description of the job.` };
  return null;
}

/** The first problem with the team definition, or ok. */
export function checkTeamPolicy(req: TeamRequest): TeamPolicyVerdict {
  const checks: (TeamPolicyVerdict | null)[] = [
    oneLine('appName', req.appName),
    oneLine('team.title', req.team.title),
    prose('team.title', req.team.title),
    prose('team.about', req.team.about),
    prose('team.pause.text', req.team.pause?.text),
    oneLine('input.table', req.input.table),
    oneLine('input.column', req.input.column),
  ];
  req.team.agents.forEach((a, i) => {
    const at = `team.agents.${i}`;
    checks.push(
      oneLine(`${at}.id`, a.id),
      oneLine(`${at}.name`, a.name),
      prose(`${at}.name`, a.name),
      prose(`${at}.job`, a.job),
      prose(`${at}.hint`, a.hint),
      oneLine(`${at}.writes`, a.writes),
      oneLine(`${at}.updates`, a.updates),
      ...a.sets.map((s, k) => oneLine(`${at}.sets.${k}`, s)),
      ...a.tools.flatMap((t, k) => [oneLine(`${at}.tools.${k}.connector`, t.connector), oneLine(`${at}.tools.${k}.tool`, t.tool)]),
    );
  });
  req.tables.forEach((t, i) => {
    checks.push(oneLine(`tables.${i}.name`, t.name), oneLine(`tables.${i}.one`, t.one));
    t.columns.forEach((c, k) => checks.push(oneLine(`tables.${i}.columns.${k}.name`, c.name)));
  });
  return checks.find((c): c is TeamPolicyVerdict => c !== null) ?? { ok: true };
}

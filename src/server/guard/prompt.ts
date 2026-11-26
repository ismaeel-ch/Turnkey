/**
 * Prompt policy: the model route relays only prompts that Turnkey's own agents write.
 *
 * The workspace builds every prompt itself. Two shapes exist (see src/workspace):
 *
 *   1. Builder agents, review steps, the tester, the repair step and the change-from-chat step all begin with the
 *      text that HEAD() builds in src/workspace/line.ts: "You are the <Name> agent on Turnkey, a line of agents that
 *      builds small record-keeping web apps ... Reply with ONE JSON object and nothing else: no prose, no code
 *      fences." followed by a blank line.
 *   2. An app's own team agents begin: You are <name>, one of <n> agents inside the app "<app>". <about>
 *
 * Anything else is refused, so the public route cannot be used as a free general-purpose chat. The shapes are matched
 * on the fixed wording, not on a loose keyword, and tests/unit/guard-prompt.test.ts reads src/workspace to prove that
 * every prompt builder there starts with one of them. If the wording in src/workspace changes, that test fails.
 */

/** The fixed text of HEAD() in src/workspace/line.ts, after the agent's name. */
const LINE_TAIL =
  ' agent on Turnkey, a line of agents that builds small record-keeping web apps (tables, roles, one status workflow, screens) from one sentence. Code checks your answer and sends it back if it fails, so follow the format exactly. Reply with ONE JSON object and nothing else: no prose, no code fences.\n\n';
const LINE_HEAD = 'You are the ';
/** An agent's display name: one short line, no quotes or control characters. */
const NAME_MAX = 60;

/** Team agents: the number of agents is 1 to 99, the app name is one line. */
const TEAM_HEAD = /^You are ([^\n"]{1,80}), one of (\d{1,2}) agents inside the app "([^\n"]{0,120})"\. /;

export type PromptKind = 'line' | 'team';
export type PromptVerdict = { ok: true; kind: PromptKind } | { ok: false; code: 'bad_request'; message: string };

const refused: PromptVerdict = {
  ok: false,
  code: 'bad_request',
  message: "This route only relays the prompts of Turnkey's own agents.",
};

export function checkPrompt(prompt: unknown): PromptVerdict {
  if (typeof prompt !== 'string') return refused;
  if (prompt.startsWith(LINE_HEAD)) {
    const end = prompt.indexOf(LINE_TAIL, LINE_HEAD.length);
    if (end > LINE_HEAD.length && end - LINE_HEAD.length <= NAME_MAX) {
      const name = prompt.slice(LINE_HEAD.length, end);
      if (!/[\n\r"\u0000-\u001f]/.test(name) && name.trim() === name) return { ok: true, kind: 'line' };
    }
    return refused;
  }
  const team = TEAM_HEAD.exec(prompt);
  if (team && Number(team[2]) >= 1) return { ok: true, kind: 'team' };
  return refused;
}

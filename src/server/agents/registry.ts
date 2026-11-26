/** How to recognise which agent a Turnkey prompt belongs to, so the right schema is applied. */
import type { StepRole } from '@/shared/agent-contract';

/**
 * Looks at the prompt the browser builds (PROMPTS in src/workspace/line.ts, testerPrompt, repairPrompt, the review and
 * change prompts, teamPrompt) and names the role. Anything unrecognised is `any`: it still has to be one JSON object.
 */
export function detectRole(prompt: string): StepRole {
  const head = /^You are the ([\w ]+?) agent on Turnkey/.exec(prompt);
  if (head) {
    const who = head[1].trim();
    if (who === 'Researcher') return 'research';
    if (who === 'Database') return 'database';
    if (who === 'View advisor') return 'views';
    if (who === 'Tester') return 'tester';
    if (who === 'Backend') return /FAILING TESTS:/.test(prompt) && /"fixes"/.test(prompt) ? 'qa_repair' : 'backend';
    if (who === 'UI') return /FORMAT: \{"tour":\[\]\}/.test(prompt) ? 'walkthrough' : 'screens';
    if (who === 'Orchestrator') return 'change';
    if (/reviewer$/i.test(who) || /"findings"/.test(prompt)) return 'review';
  }
  if (/^You are [^,]+, one of \d+ agents inside the app/.test(prompt)) return 'team';
  return 'any';
}

/** What the model is told when its answer failed. Mirrors the browser's own wording (`fbText` in line.js). */
export function repairNote(issues: string[]): string {
  return (
    'YOUR LAST ANSWER FAILED THESE CHECKS. Fix them and return the full JSON again. Reply with ONE JSON object and nothing else: no prose, no code fences.\n- ' +
    issues.join('\n- ')
  );
}

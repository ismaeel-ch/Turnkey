/**
 * Which model tier answers each builder role.
 *
 * The browser asks for `default` (Sonnet) or `quick` (Haiku) for a whole build. On `default`, the roles that design
 * the app (brief, tables, rules) stay on Sonnet, and the roles that follow a design already made (views, screens, the
 * tour, test cases, repairs, reviews, chat changes) go to Haiku, which costs about a twentieth as much. Measured on
 * real builds: docs/hackathon/budget.md.
 *
 *   LLM_QUICK_ROLES   comma-separated roles sent to the quick tier on a default build (default below);
 *                     `none` keeps every role on the default tier.
 */
import { STEP_ROLES, type StepRole } from '@/shared/agent-contract';

type Env = Record<string, string | undefined>;
type Tier = 'default' | 'quick';

export const QUICK_ROLES_DEFAULT: readonly StepRole[] = ['views', 'screens', 'walkthrough', 'tester', 'qa_repair', 'review', 'change'];

export function quickRoles(env: Env = process.env): Set<StepRole> {
  const raw = env.LLM_QUICK_ROLES?.trim().toLowerCase();
  if (!raw) return new Set(QUICK_ROLES_DEFAULT);
  if (raw === 'none') return new Set();
  const known = new Set<string>(STEP_ROLES);
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is StepRole => known.has(s)),
  );
}

/** The tier one call runs on: what the browser asked, lowered to `quick` for the roles above. */
export function tierFor(role: StepRole, asked: Tier, env: Env = process.env): Tier {
  return asked === 'quick' || quickRoles(env).has(role) ? 'quick' : 'default';
}

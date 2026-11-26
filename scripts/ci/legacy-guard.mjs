// Fails a pull request that changes src/legacy/** unless its title starts with "WP-16" or contains "[legacy]".
// CLAUDE.md rule 5: the workspace modules are kept byte for byte; only the integration work package may change them.
// Run by the legacy-guard job in .github/workflows/ci.yml. On a push (for example to main) there is no pull request
// title to check, so the script passes: the pull request that landed the change was already checked.
//
// Environment (set by the workflow):
//   GITHUB_EVENT_NAME      "pull_request" for a pull request
//   PR_TITLE               the pull request title (passed through env, never interpolated into the script)
//   BASE_SHA, HEAD_SHA     the base commit and the head commit of the pull request
import { execFileSync } from 'node:child_process';

const LEGACY = /^src\/legacy\//;
const ALLOWED_PREFIX = 'WP-16';
const ALLOWED_TAG = '[legacy]';

export function titleAllows(title) {
  return title.startsWith(ALLOWED_PREFIX) || title.includes(ALLOWED_TAG);
}

export function legacyFiles(changed) {
  return changed.filter((file) => LEGACY.test(file));
}

function changedFiles(base, head) {
  // Three dots: the diff from the merge base to the head, so only the pull request's own changes count.
  const out = execFileSync('git', ['diff', '--name-only', '-z', `${base}...${head}`], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function main() {
  const event = process.env.GITHUB_EVENT_NAME ?? '';
  if (event !== 'pull_request') {
    console.log(`legacy-guard: event "${event}" is not a pull request; nothing to check.`);
    return 0;
  }
  const title = process.env.PR_TITLE ?? '';
  const base = process.env.BASE_SHA ?? '';
  const head = process.env.HEAD_SHA ?? '';
  if (!base || !head) {
    console.error('legacy-guard: BASE_SHA and HEAD_SHA must be set for a pull request.');
    return 1;
  }
  const touched = legacyFiles(changedFiles(base, head));
  if (touched.length === 0) {
    console.log('legacy-guard: no changes under src/legacy/. Pass.');
    return 0;
  }
  if (titleAllows(title)) {
    console.log(`legacy-guard: ${touched.length} file(s) under src/legacy/ changed, and the title allows it. Pass.`);
    return 0;
  }
  console.error(`legacy-guard: this pull request changes ${touched.length} file(s) under src/legacy/:`);
  for (const file of touched) console.error(`  ${file}`);
  console.error(`The title must start with "${ALLOWED_PREFIX}" or contain "${ALLOWED_TAG}" to change them.`);
  console.error('See CLAUDE.md rule 5. Only the integration work package (WP-16) changes src/legacy.');
  return 1;
}

// Run only when executed directly, so the helpers can be imported by a test.
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}

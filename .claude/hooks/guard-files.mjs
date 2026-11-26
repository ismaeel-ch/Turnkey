#!/usr/bin/env node
// PreToolUse hook for Edit and Write. Blocks changes to files that must not be edited by hand:
// environment files, generated output, vendored engines and the lockfile.
// Exit 2 blocks the edit and shows the reason to Claude. Any error lets the edit through.
import path from 'node:path';

const RULES = [
  [/(^|\/)\.env(\.(?!example$)[\w.-]+)?$/, 'environment files hold keys. Put names and placeholders in .env.example instead.'],
  [/(^|\/)src\/platform\/generated\//, 'this file is generated. Change src/legacy or scripts/build-legacy.mjs and run npm run build:legacy.'],
  [/(^|\/)public\/vendor\//, 'this file is copied in by scripts/build-legacy.mjs.'],
  [/(^|\/)package-lock\.json$/, 'the lockfile is written by npm. Run npm install <package> instead of editing it.'],
  [/(^|\/)\.git\//, 'the .git directory is not edited by hand.'],
];

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input || '{}');
    const file = String(event?.tool_input?.file_path || '');
    const rel = path.relative(event?.cwd || process.cwd(), file).split(path.sep).join('/');
    for (const [re, reason] of RULES) {
      if (re.test(rel) || re.test(file)) {
        process.stderr.write('Blocked by .claude/hooks/guard-files.mjs: ' + reason + '\n');
        process.exit(2);
      }
    }
  } catch {
    // no decision
  }
  process.exit(0);
});

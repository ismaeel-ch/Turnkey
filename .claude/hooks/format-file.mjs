#!/usr/bin/env node
// PostToolUse hook for Edit and Write. Formats the file that was just changed with Prettier, if it is one of the
// files this project formats. Never fails and never blocks: formatting is a convenience, CI is the check.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input || '{}');
    const file = String(event?.tool_input?.file_path || '');
    if (!file || !fs.existsSync(file)) process.exit(0);
    // Find the checkout this file belongs to (agents work in separate worktrees).
    let root = path.dirname(file);
    while (root !== path.dirname(root) && !fs.existsSync(path.join(root, 'package.json'))) root = path.dirname(root);
    const bin = path.join(root, 'node_modules', '.bin', 'prettier');
    const rel = path.relative(root, file).split(path.sep).join('/');
    const formatted = /^(src\/(app|platform|server|shared)|tests\/unit|scripts|docs)\/.*\.(ts|tsx|css|mjs|md|json)$/.test(rel) || /^[^/]+\.(json|md|mjs|ts)$/.test(rel);
    const skipped = /^(src\/legacy|src\/platform\/generated|public\/vendor|tests\/e2e)\//.test(rel) || rel === 'package-lock.json' || rel === 'AGENTS.md';
    if (formatted && !skipped && fs.existsSync(bin)) execFileSync(bin, ['--write', '--log-level', 'silent', file], { cwd: root, stdio: 'ignore', timeout: 20000 });
  } catch {
    // ignore
  }
  process.exit(0);
});

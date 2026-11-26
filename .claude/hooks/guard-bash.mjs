#!/usr/bin/env node
// PreToolUse hook for Bash. Blocks the few commands this project never allows, whoever asks:
//   pushing to main, force pushes, committing on main, and printing or copying an environment file.
// Exit 2 blocks the command and shows the reason to Claude. Anything else lets the normal permission flow decide.
// Any error in this script lets the command through: a broken hook must never stop the work.
import { execFileSync } from 'node:child_process';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input || '{}');
    const command = String(event?.tool_input?.command || '');
    const cwd = event?.cwd || process.cwd();
    const reason = check(command, cwd);
    if (reason) {
      process.stderr.write('Blocked by .claude/hooks/guard-bash.mjs: ' + reason + '\n');
      process.exit(2);
    }
  } catch {
    // fall through: no decision
  }
  process.exit(0);
});

export function check(command, cwd) {
  // Look at each command in a chain (a && b ; c | d) on its own.
  const parts = command.split(/&&|\|\||;|\n/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const words = part.replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, '');
    if (/^git\b/.test(words) && /\bpush\b/.test(words)) {
      if (/(^|\s)(--force|-f)(\s|$)/.test(words)) return 'force pushes are not allowed. Use --force-with-lease on your own branch if you must rewrite it.';
      if (/(^|\s)(--delete|-d)\s+\S*\s*\b(main|master)\b/.test(words) || /\s:(main|master)(\s|$)/.test(words)) return 'main cannot be deleted.';
      if (/\s(\S*:)?(refs\/heads\/)?(main|master)(\s|$)/.test(words.replace(/^git\s+(-C\s+\S+\s+)?(-c\s+\S+\s+)*push/, ' ')))
        return 'no direct pushes to main. Push your branch and open a pull request.';
      const target = words.replace(/^git\s+(-C\s+\S+\s+)?(-c\s+\S+\s+)*push(\s+-\S+)*/, ' ');
      if ((!/\s\S+\s+\S+/.test(target) || /\sHEAD(\s|$)/.test(target)) && onMain(dirOf(words, cwd)))
        return 'you are on main. Create a branch, then push that.';
    }
    if (/^git\b/.test(words) && /\bcommit\b/.test(words) && onMain(dirOf(words, cwd))) return 'no commits on main. Create a branch first: git switch -c <type>/<name>.';
    if (/(^|[\s"'=/])\.env(\.[\w.-]+)?(\s|$|["'])/.test(words) && !/\.env\.example/.test(words) && /^(cat|less|more|head|tail|cp|mv|scp|curl|base64|xxd|grep|rg|awk|sed|printenv|source|\.)\b/.test(words))
      return 'environment files hold keys and are not read, copied or sent anywhere.';
  }
  return null;
}

function dirOf(words, cwd) {
  const m = words.match(/^git\s+-C\s+(\S+)/);
  return m ? m[1] : cwd;
}

function onMain(dir) {
  try {
    const branch = execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return branch === 'main' || branch === 'master';
  } catch {
    return false;
  }
}

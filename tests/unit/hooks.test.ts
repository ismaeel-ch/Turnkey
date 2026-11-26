import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The Claude Code hooks, run the way Claude Code runs them: the event as JSON on stdin, exit 2 to block.
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const hook = (name: string) => path.join(ROOT, '.claude', 'hooks', name);

function run(name: string, input: string | object) {
  const res = spawnSync(process.execPath, [hook(name)], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    timeout: 10_000,
  });
  return { status: res.status, stderr: res.stderr };
}
const bash = (command: string, cwd: string) => run('guard-bash.mjs', { tool_input: { command }, cwd });
const edit = (file_path: string, cwd = ROOT) => run('guard-files.mjs', { tool_input: { file_path }, cwd });

let repo: string;
const git = (...args: string[]) => {
  const res = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { cwd: repo, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
};

beforeEach(() => {
  // A repository on main with one commit, for the branch rules. Nothing is pushed anywhere.
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'turnkey-hooks-'));
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'start');
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('guard-bash: git', () => {
  it('blocks a push to main, whatever the form', () => {
    expect(bash('git push origin main', repo).status).toBe(2);
    expect(bash('git push origin HEAD:main', repo).status).toBe(2);
    expect(bash('git push origin feature/x:refs/heads/main', repo).status).toBe(2);
  });

  it('blocks a force push, and deleting main', () => {
    expect(bash('git push --force origin test/x', repo).status).toBe(2);
    expect(bash('git push -f origin test/x', repo).status).toBe(2);
    expect(bash('git push origin --delete main', repo).status).toBe(2);
  });

  it('blocks a commit while main is checked out', () => {
    const res = bash('git commit -m "change"', repo);
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('no commits on main');
  });

  it('blocks a push without a branch name while main is checked out', () => {
    expect(bash('git push -u origin', repo).status).toBe(2);
  });

  it('allows a commit and a push of a feature branch', () => {
    git('switch', '-q', '-c', 'test/feature');
    expect(bash('git commit -m "change"', repo).status).toBe(0);
    expect(bash('git push -u origin test/feature', repo).status).toBe(0);
    expect(bash('git push origin test/feature', repo).status).toBe(0);
  });

  it('lets ordinary commands through, and fails open on input it cannot read', () => {
    expect(bash('npm run check', repo).status).toBe(0);
    expect(bash('git status', repo).status).toBe(0);
    expect(run('guard-bash.mjs', 'this is not json').status).toBe(0);
  });
});

describe('guard-bash: environment files', () => {
  it('blocks reading or copying the local environment file', () => {
    for (const command of ['cat .env.local', 'cp .env.local /tmp/x', 'grep KEY .env', 'head -n 3 .env.production.local', 'base64 .env.local']) {
      expect(bash(command, ROOT).status, command).toBe(2);
    }
  });
  it('allows the example file and unrelated commands that name it', () => {
    expect(bash('cat .env.example', ROOT).status).toBe(0);
    expect(bash('echo "see .env.local docs"', ROOT).status).toBe(0);
  });
});

describe('guard-files', () => {
  it('blocks edits to environment files, but not the example', () => {
    expect(edit(path.join(ROOT, '.env')).status).toBe(2);
    expect(edit(path.join(ROOT, '.env.local')).status).toBe(2);
    expect(edit(path.join(ROOT, '.env.production')).status).toBe(2);
    expect(edit(path.join(ROOT, '.env.example')).status).toBe(0);
  });

  it('blocks edits to generated code, vendored files, the lockfile and git internals', () => {
    expect(edit(path.join(ROOT, 'src/platform/generated/legacy.js')).status).toBe(2);
    expect(edit(path.join(ROOT, 'public/vendor/htm.js')).status).toBe(2);
    expect(edit(path.join(ROOT, 'package-lock.json')).status).toBe(2);
    expect(edit(path.join(ROOT, '.git/config')).status).toBe(2);
  });

  it('allows ordinary source files, and explains why a block happened', () => {
    expect(edit(path.join(ROOT, 'src/app/api/health/route.ts')).status).toBe(0);
    expect(edit(path.join(ROOT, 'tests/unit/hooks.test.ts')).status).toBe(0);
    const blocked = edit(path.join(ROOT, 'package-lock.json'));
    expect(blocked.stderr).toContain('npm install <package>');
  });
});

describe('format-file', () => {
  it('never fails, even for a file that does not exist', () => {
    expect(run('format-file.mjs', { tool_input: { file_path: path.join(ROOT, 'no-such-file.ts') }, cwd: ROOT }).status).toBe(0);
    expect(run('format-file.mjs', 'not json').status).toBe(0);
  });
});

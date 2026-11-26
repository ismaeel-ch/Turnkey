import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Runs the real scan inside a throwaway git repository. Every key below is made up, and each one is built from two
// pieces so that this file itself does not look like a key to the scan that runs on the repository.
const SCRIPT = fileURLToPath(new URL('../../scripts/check-secrets.mjs', import.meta.url));
const fakeSk = 'sk-' + 'test0123456789abcdef';
const fakeLitellm = 'LITELLM_API_KEY=' + 'made' + 'up0123456789';
const fakePrivateKeyHeader = '-----BEGIN ' + 'PRIVATE KEY-----';

let repo: string;

function git(...args: string[]) {
  const res = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`);
}
function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
}
function scan() {
  const res = spawnSync(process.execPath, [SCRIPT], { cwd: repo, encoding: 'utf8' });
  return { status: res.status, out: res.stdout + res.stderr };
}

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'turnkey-secrets-'));
  git('init', '-q');
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('check-secrets', () => {
  it('passes a repository with nothing secret in it', () => {
    write('src/app/page.tsx', 'export default function Page() { return null; }\n');
    write('.env.example', 'LITELLM_API_KEY=\n');
    git('add', '-A');
    const res = scan();
    expect(res.status).toBe(0);
    expect(res.out).toContain('nothing found');
  });

  it('fails on something shaped like an API key', () => {
    write('src/server/config.ts', `export const key = "${fakeSk}";\n`);
    git('add', '-A');
    const res = scan();
    expect(res.status).toBe(1);
    expect(res.out).toContain('src/server/config.ts:1: something shaped like an API key');
  });

  it('fails on a key assigned a value, on the line it is on', () => {
    write('notes.txt', 'first line\n' + fakeLitellm + '\n');
    git('add', '-A');
    const res = scan();
    expect(res.status).toBe(1);
    expect(res.out).toContain('notes.txt:2: a key assigned a value');
  });

  it('fails on a private key and on a public variable that holds a secret', () => {
    write('a.txt', fakePrivateKeyHeader + '\n');
    write('b.ts', 'const v = process.env.NEXT_PUBLIC_' + 'API_TOKEN;\n');
    git('add', '-A');
    const res = scan();
    expect(res.status).toBe(1);
    expect(res.out).toContain('a.txt:1: a private key');
    expect(res.out).toContain('b.ts:1: a public environment variable that holds a secret');
  });

  it('fails when an environment file is tracked, but not the example', () => {
    write('.env.example', 'LITELLM_API_KEY=\n');
    write('.env.local', 'OPENAI_MODEL=model-a\n');
    git('add', '-A');
    const res = scan();
    expect(res.status).toBe(1);
    expect(res.out).toContain('.env.local: an environment file is tracked');
    expect(res.out).not.toContain('.env.example:');
  });

  it('ignores a line that is marked as allowed, and files that are not tracked', () => {
    write('doc.md', `example: ${fakeSk} check-secrets: allow\n`);
    write('untracked.ts', `export const k = "${fakeSk}";\n`);
    git('add', 'doc.md');
    const res = scan();
    expect(res.status).toBe(0);
  });

  it('skips binary and lockfile names by pattern', () => {
    write('package-lock.json', `{"integrity":"${fakeSk}"}\n`);
    write('public/logo.png', `${fakeSk}\n`);
    git('add', '-A');
    expect(scan().status).toBe(0);
  });
});

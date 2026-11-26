import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanText } from '../../scripts/check-secrets.mjs';

const script = path.resolve(__dirname, '../../scripts/check-secrets.mjs');
// Fake keys are built from pieces so this file never holds a whole key-shaped string.
const fake = {
  sk: 'sk' + '-' + 'a1B2c3D4e5F6g7H8i9J0',
  ant: 'sk' + '-ant-' + 'api03' + 'AbCdEfGhIjKl',
  gh: 'gh' + 'p_' + 'A'.repeat(36),
  aws: 'AK' + 'IA' + 'ABCDEFGHIJKLMNOP',
  google: 'AI' + 'za' + 'A'.repeat(35),
  jwt: 'ey' + 'Jhbgcioijiuzi1niisinr5cci6.ey' + 'Jzdwiioixmjm0nta2nzg5.abcdefghijklmnop',
  pem: '-----BEGIN ' + 'PRIVATE KEY-----',
};

describe('scanText', () => {
  it('catches each kind of planted key', () => {
    expect(scanText('const k = "' + fake.sk + '"').length).toBe(1);
    expect(scanText(fake.ant).length).toBeGreaterThan(0);
    expect(scanText('token ' + fake.gh).length).toBe(1);
    expect(scanText(fake.aws).length).toBe(1);
    expect(scanText(fake.google).length).toBe(1);
    expect(scanText(fake.jwt).length).toBe(1);
    expect(scanText(fake.pem).length).toBe(1);
    expect(scanText('LITELLM_API_KEY=abcdef123456789').length).toBe(1); // check-secrets: allow
    expect(scanText('const url = "postgres://admin:hunter2hunter@db.example.com/app"').length).toBe(1); // check-secrets: allow
    expect(scanText('NEXT_PUBLIC_API_KEY=1').length).toBe(1); // check-secrets: allow
  });
  it('leaves ordinary text and obvious placeholders alone', () => {
    expect(scanText('Set LITELLM_API_KEY in Vercel.')).toEqual([]);
    expect(scanText("LITELLM_API_KEY: 'test-key-value', LITELLM_MODEL: 'a'")).toEqual([]);
    expect(scanText('OPENAI_API_KEY=your-key-here')).toEqual([]);
    expect(scanText('const task = "ask-me-later-please-ok"')).toEqual([]);
    expect(scanText('postgres://user:$PASSWORD@host/db')).toEqual([]);
    expect(scanText('fetch(url, { headers: { authorization: `Bearer ${token}` } })')).toEqual([]);
  });
  it('allows a line marked on purpose', () => {
    expect(scanText(fake.sk + ' // check-secrets: allow')).toEqual([]);
  });
});

describe('npm run check:secrets on a repo with a planted key', () => {
  const run = (dir: string) => spawnSync('node', [script], { cwd: dir, encoding: 'utf8' });
  const repo = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-'));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const fine = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    return dir;
  };
  it('passes a clean repo', () => {
    expect(run(repo()).status).toBe(0);
  });
  it('fails on a tracked file with a key, naming the file and line', () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, 'b.ts'), 'const a = 1;\nconst k = "' + fake.sk + '";\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('b.ts:2');
  });
  it('fails on a new file that is not added yet, and on a tracked env file', () => {
    const dir = repo();
    fs.writeFileSync(path.join(dir, 'c.md'), 'key: ' + fake.gh + '\n');
    expect(run(dir).status).toBe(1);
    fs.rmSync(path.join(dir, 'c.md'));
    fs.writeFileSync(path.join(dir, '.env.local'), 'A=1\n');
    execFileSync('git', ['add', '-f', '.env.local'], { cwd: dir });
    expect(run(dir).stderr).toContain('environment file');
  });
});

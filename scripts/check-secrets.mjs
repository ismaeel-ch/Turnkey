// Fails if anything that looks like a key is in the repo, or an env file is. Run by `npm run check` and CI.
// The hackathon rule: the key is never in the code, the README, a screenshot or the git history.
//
//   node scripts/check-secrets.mjs            scan every tracked file and every file git would add (not ignored)
//   node scripts/check-secrets.mjs --history  also scan every line ever added on this branch's history
//
// A line that must contain something key-shaped on purpose (a fake key in a test) ends with: check-secrets: allow
// Better still: build the fake value in the test from pieces, so the file never contains the whole shape.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SKIP = /^(package-lock\.json|src\/legacy\/icons\.js|public\/vendor\/|.*\.(png|ico|jpg|jpeg|gif|wasm|woff2?|pdf|zip))$/;
const KEY_NAMES =
  '(?:LITELLM|OPENAI|ANTHROPIC|PATENTSVIEW|GITHUB|VERCEL|GOOGLE|AWS|AZURE|SLACK|STRIPE|HF|HUGGINGFACE|GROQ|MISTRAL|COHERE)[A-Z0-9_]*(?:KEY|TOKEN|SECRET)';
export const PATTERNS = [
  [/\bsk-[A-Za-z0-9_\-]{16,}/, 'something shaped like an API key (sk-…)'],
  [/\bsk-ant-[A-Za-z0-9_\-]{10,}/, 'an Anthropic key'],
  [
    new RegExp(
      '\\b' +
        KEY_NAMES +
        '\\s*[=:]\\s*["\']?(?!(?:test|fake|dummy|example|sample|placeholder|your|changeme|xxx|none|mock)[-_A-Za-z0-9]*(?:["\']|\\s|[,;})]|$))[A-Za-z0-9_\\-./+]{12,}',
    ),
    'a key or token assigned a value',
  ],
  [/\bNEXT_PUBLIC_[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)/, 'a public environment variable that holds a secret'],
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/, 'a private key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{30,}/, 'a GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key id'],
  [/\bAIza[0-9A-Za-z_\-]{35}\b/, 'a Google API key'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/, 'a Stripe key'],
  [/\bhf_[A-Za-z0-9]{30,}/, 'a Hugging Face token'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'a signed token (JWT)'],
  [/\bauthorization["']?\s*[:=]\s*["']?bearer\s+(?!\$|<|\{|x{3}|your|token|\*)[A-Za-z0-9._~+/=-]{20,}/i, 'a bearer token'],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"']+:(?!\$|<|\{|x{3}|password|pass\b|\*)[^\s/@"']{6,}@[^\s/"']+/i, 'a URL with a password in it'],
  [/\bvc[pirak]_[A-Za-z0-9]{20,}/, 'a Vercel token'],
];

/** The problems in one file's text: [line number, what]. */
export function scanText(text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (/check-secrets: allow/.test(line)) return;
    for (const [re, what] of PATTERNS) if (re.test(line)) out.push([i + 1, what]);
  });
  return out;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

function main() {
  const tracked = git('ls-files', '-z').split('\0').filter(Boolean);
  const fresh = git('ls-files', '-z', '--others', '--exclude-standard').split('\0').filter(Boolean);
  const files = [...new Set([...tracked, ...fresh])];
  const problems = [];
  for (const file of files) {
    if (/(^|\/)\.env(\..*)?$/.test(file) && !/\.env\.example$/.test(file)) problems.push(file + ': an environment file is in the repo');
    if (SKIP.test(file)) continue;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const [n, what] of scanText(text)) problems.push(`${file}:${n}: ${what}`);
  }
  if (process.argv.includes('--history')) {
    const log = git('log', '--all', '-p', '--no-color', '--unified=0', '--format=commit %h');
    let commit = '',
      file = '';
    for (const line of log.split('\n')) {
      if (line.startsWith('commit ')) commit = line.slice(7);
      else if (line.startsWith('+++ b/')) file = line.slice(6);
      else if (line.startsWith('+') && !SKIP.test(file))
        for (const [, what] of scanText(line.slice(1))) problems.push(`history ${commit} ${file}: ${what}`);
    }
  }
  if (problems.length) {
    console.error('Secrets check failed:\n' + [...new Set(problems)].map((p) => '  ' + p).join('\n'));
    console.error('\nIf a key was really committed, treat it as leaked: see SECURITY.md.');
    process.exit(1);
  }
  console.log('secrets check: ' + files.length + ' files, nothing found');
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();

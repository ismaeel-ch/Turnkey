// Fails if anything that looks like a key is tracked in the repo, or an env file is. Run by `npm run check` and CI.
// The hackathon rule: the key is never in the code, the README, a screenshot or the git history.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const SKIP = /^(package-lock\.json|src\/workspace\/icons\.ts|public\/vendor\/|.*\.(png|ico|jpg|jpeg|gif|wasm|woff2?))$/;
const PATTERNS = [
  [/\bsk-[A-Za-z0-9_\-]{16,}/, 'something shaped like an API key (sk-…)'],
  [
    /\b(?:LITELLM_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|PATENTSVIEW_API_KEY)\s*[=:]\s*["']?[A-Za-z0-9_\-]{12,}/,
    'a key assigned a value',
  ],
  [/\bNEXT_PUBLIC_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)/, 'a public environment variable that holds a secret'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'a private key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
];
const problems = [];
for (const file of files) {
  if (/(^|\/)\.env(\..*)?$/.test(file) && !/\.env\.example$/.test(file)) problems.push(file + ': an environment file is tracked');
  if (SKIP.test(file)) continue;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const [re, what] of PATTERNS) if (re.test(line) && !/check-secrets: allow/.test(line)) problems.push(`${file}:${i + 1}: ${what}`);
  });
}
if (problems.length) {
  console.error('Secrets check failed:\n' + problems.map((p) => '  ' + p).join('\n'));
  process.exit(1);
}
console.log('secrets check: ' + files.length + ' tracked files, nothing found');

// Runs the browser checks against a production build of the app.
//
//   npm run test:e2e                 every flow (about 20 minutes)
//   npm run test:e2e -- demo         one flow: demo, live, misc, views, quests, new, custom, round6
//   npm run test:e2e -- demo,live    several
//   TK_URL=https://… npm run test:e2e -- demo    against a server that is already running (no build, no start)
//   PORT=3105 npm run test:e2e       pick the port (set a different one per worktree when several run at once)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const flows = process.argv[2] || 'all';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
    child.on('exit', (code) => resolve(code ?? 1));
  });

async function main() {
  let url = process.env.TK_URL;
  let server = null;
  if (!url) {
    if (!fs.existsSync(path.join(root, '.next', 'BUILD_ID'))) {
      const built = await run('npm', ['run', 'build']);
      if (built !== 0) return built;
    }
    const port = Number(process.env.PORT) || 3100 + (process.pid % 700);
    url = 'http://localhost:' + port;
    // No model is configured for the checks: Live is exercised with a stand-in the checks inject into the page.
    const env = { ...process.env, PORT: String(port), LLM_PROVIDER: '', LITELLM_API_KEY: '', OPENAI_API_KEY: '' };
    server = spawn(path.join(root, 'node_modules', '.bin', 'next'), ['start', '-p', String(port)], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] });
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      await sleep(250);
      try {
        up = (await fetch(url + '/api/health')).ok;
      } catch {
        // not listening yet
      }
    }
    if (!up) {
      server.kill();
      console.error('The app did not start on ' + url);
      return 1;
    }
  }
  const code = await run('node', [path.join(root, 'tests', 'e2e', 'flows.cjs'), flows], { env: { ...process.env, TK_URL: url } });
  if (server) server.kill();
  return code;
}

main().then((code) => process.exit(code));

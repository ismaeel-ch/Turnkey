// Runs the browser checks against a production build of the app.
//
//   npm run test:e2e                 every flow (about 20 minutes)
//   npm run test:e2e -- demo         one flow: demo, live, misc, views, quests, new, custom, round6, react, sizes
//   npm run test:e2e -- demo,live    several
//   npm run test:e2e -- offline      install and offline (tests/e2e/offline.cjs, a fresh browser with a service worker)
//   npm run test:e2e -- a11y         accessibility: axe on every main screen, light and dark, plus keyboard checks (tests/e2e/a11y.cjs)
//   TK_URL=https://… npm run test:e2e -- demo    against a server that is already running (no build, no start)
//   PORT=3105 npm run test:e2e       pick the port (set a different one per worktree when several run at once)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

/** True if something already answers on this address. A leftover server would serve an old build to the checks. */
async function answers(url) {
  try {
    await fetch(url + '/api/health', { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let url = process.env.TK_URL;
  let server = null;
  // `next start` runs the real server as a child process. Stop the whole group, or that child lives on,
  // keeps the port, and the next run would test whatever build it was started with.
  const stop = () => {
    if (!server) return;
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // already gone
    }
    server = null;
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      stop();
      process.exit(130);
    });
  }
  process.on('exit', stop);

  if (!url) {
    if (!fs.existsSync(path.join(root, '.next', 'BUILD_ID'))) {
      const built = await run('npm', ['run', 'build']);
      if (built !== 0) return built;
    }
    const port = Number(process.env.PORT) || 3100 + (process.pid % 700);
    url = 'http://localhost:' + port;
    if (await answers(url)) {
      console.error('Port ' + port + ' is already in use. Stop what is running there, or pick another: PORT=<number> npm run test:e2e');
      return 1;
    }
    // No model is configured for the checks: Live is exercised with a stand-in the checks inject into the page.
    // Short links are kept in a fresh folder for each run, never in a real Blob store.
    const shares = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-e2e-shares-'));
    const env = {
      ...process.env,
      PORT: String(port),
      LLM_PROVIDER: '',
      LITELLM_API_KEY: '',
      OPENAI_API_KEY: '',
      BLOB_READ_WRITE_TOKEN: '',
      BLOB_STORE_ID: '',
      SHARE_STORE_DIR: shares,
    };
    server = spawn(path.join(root, 'node_modules', '.bin', 'next'), ['start', '-p', String(port)], {
      cwd: root,
      env,
      stdio: ['ignore', 'ignore', 'inherit'],
      detached: true,
    });
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      await sleep(250);
      up = await answers(url);
    }
    if (!up) {
      stop();
      console.error('The app did not start on ' + url);
      return 1;
    }
  }
  // The offline check runs on its own: it needs a service worker and a browser that has never seen the app.
  const names = flows === 'all' ? ['all', 'offline', 'a11y'] : flows.split(',');
  const offline = names.includes('offline');
  const a11y = names.includes('a11y');
  const rest = names.filter((n) => n !== 'offline' && n !== 'a11y');
  let code = 0;
  if (rest.length) code = await run('node', [path.join(root, 'tests', 'e2e', 'flows.cjs'), rest.join(',')], { env: { ...process.env, TK_URL: url } });
  if (offline) code = (await run('node', [path.join(root, 'tests', 'e2e', 'offline.cjs')], { env: { ...process.env, TK_URL: url } })) || code;
  if (a11y) code = (await run('node', [path.join(root, 'tests', 'e2e', 'a11y.cjs')], { env: { ...process.env, TK_URL: url } })) || code;
  stop();
  return code;
}

main().then((code) => process.exit(code));

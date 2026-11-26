/**
 * Runs the workspace's build line (src/legacy, read only) in plain Node, with the model answering through a function
 * the test gives it. No browser: the modules that draw the screen are left out and the page is a stand-in. This is
 * how the mock's saved answers are checked against the real checks a model's answers must pass.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = path.resolve(__dirname, '../../../src/legacy');
const ORDER = [
  'icons.js',
  'core.js',
  'db.js',
  'engine.js',
  'viewspec.js',
  'builds.js',
  'quests.js',
  'team.js',
  'room.js',
  'tests.js',
  'flow.js',
  'line.js',
  'changes.js',
  'custom.js',
  'tester.js',
  'ui.js',
  'mobile.js',
  'runtime.js',
  'views-a.js',
  'views-b.js',
  'share.js',
  'release.js',
  'guide.js',
];

export type LineApp = {
  status: string;
  name: string;
  line: Record<string, { status: string }>;
  def: { tables: { name: string; columns: { name: string }[] }[]; tour: unknown[]; cases?: unknown[] } & Record<string, unknown>;
  chat: { from: string; text: string }[];
  last?: unknown;
} & Record<string, unknown>;

export type LineWorld = {
  /** Starts a Live build from a sentence and waits for it to finish. */
  build(request: string): Promise<LineApp>;
  /** Sends a chat message to a built app (a change request) and waits. */
  say(app: LineApp, text: string): Promise<void>;
  calls: string[];
};

export async function startLine(respond: (prompt: string) => Promise<string>): Promise<LineWorld> {
  const require = createRequire(import.meta.url);
  const initSqlJs = require('sql.js');
  const stub = (): object =>
    new Proxy(function () {}, {
      get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub()),
      apply: () => stub(),
      construct: () => stub() as object,
    });
  const store: Record<string, string> = {};
  const win: Record<string, unknown> = {
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => (store[k] = String(v)),
      removeItem: (k: string) => delete store[k],
      key: (i: number) => Object.keys(store)[i],
      get length() {
        return Object.keys(store).length;
      },
    },
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    location: { hash: '', search: '', href: 'http://localhost/' },
    navigator: { onLine: true, userAgent: 'node' },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    performance,
    AbortController,
    crypto: globalThis.crypto,
    document: new Proxy(
      { createElement: () => ({ querySelectorAll: () => ({ length: 1 }), querySelector: () => stub() }) } as Record<string, unknown>,
      { get: (t, k) => (k in t ? t[k as string] : stub()) },
    ),
    htmPreact: {
      html: stub(),
      render: stub(),
      useState: (v: unknown) => [v, () => {}],
      useEffect() {},
      useLayoutEffect() {},
      useRef: (v: unknown) => ({ current: v }),
      useReducer: (_r: unknown, i: unknown) => [i, () => {}],
    },
    initSqlJs,
  };
  win.window = win;
  win.self = win;
  const ctx = vm.createContext(
    new Proxy(win, {
      has: () => true,
      get: (t, k) =>
        k in t ? t[k as string] : typeof k === 'string' && k in globalThis ? (globalThis as Record<string, unknown>)[k] : undefined,
    }),
  );
  const calls: string[] = [];
  win.__fn = async (input: string) => {
    calls.push((/^You are the ([\w ]+?) agent/.exec(input) || /^You are (\w+), one of/.exec(input) || [])[1] || '?');
    return { text: await respond(input), truncated: false };
  };
  vm.runInContext(
    ORDER.map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n;\n') +
      '\n;LIVE.fn = window.__fn; U.live = "ready"; S.settings.demo = false; S.settings.speed = "instant";',
    ctx,
    { filename: 'legacy' },
  );
  await vm.runInContext('initSqlite()', ctx);
  return {
    calls,
    build: (request) =>
      vm.runInContext(
        `(async () => { const app = newApp({ request: ${JSON.stringify(request)}, mode: 'live' }); await runBuild(app); return app; })()`,
        ctx,
      ),
    say: (app, text) => vm.runInContext(`(async (app) => { await handleChat(app, ${JSON.stringify(text)}); })`, ctx)(app),
  };
}

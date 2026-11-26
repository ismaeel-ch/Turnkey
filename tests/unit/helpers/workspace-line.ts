/**
 * Runs the workspace's build line (src/workspace) in a jsdom test, with the model answering through a function the
 * test gives it. The test file must use the jsdom environment and replace `@/platform/sqlite` with sql.js loaded from
 * node_modules (see mock-roles.test.ts). This is how the mock's saved answers are checked against the real checks a
 * model's answers must pass.
 */
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
  const core = await import('@/workspace/core');
  const db = await import('@/workspace/db');
  const line = await import('@/workspace/line');
  const changes = await import('@/workspace/changes');
  const calls: string[] = [];
  line.LIVE.fn = async (input: string) => {
    calls.push((/^You are the ([\w ]+?) agent/.exec(input) || /^You are (\w+), one of/.exec(input) || [])[1] || '?');
    return { text: await respond(input), truncated: false };
  };
  core.U.live = 'ready';
  core.S.settings.demo = false;
  core.S.settings.speed = 'instant';
  await db.initSqlite();
  return {
    calls,
    build: async (request) => {
      const app = line.newApp({ request, mode: 'live' });
      await line.runBuild(app);
      return app as LineApp;
    },
    say: async (app, text) => {
      await changes.handleChat(app, text);
    },
  };
}

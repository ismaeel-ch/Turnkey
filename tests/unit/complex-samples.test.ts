// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppRecord } from '@/shared/types/workspace';
import { checkPlan, logicLines } from '@/shared/plan';
import '@/workspace/saved';
import { CARDS, COMPLEX_TEMPLATES, matchTemplate } from '@/workspace/catalog';
import { planFromSaved } from '@/workspace/interview';

// The browser loads sql.js as a script from /vendor; here it comes straight from node_modules.
vi.mock('@/platform/sqlite', () => ({ loadSqlite: () => createRequire(import.meta.url)('sql.js')() }));

/* The four saved builds that work numbers out and enforce rules, built from their recordings on a real database. */

type Mods = {
  core: typeof import('@/workspace/core');
  db: typeof import('@/workspace/db');
  line: typeof import('@/workspace/line');
  engine: typeof import('@/workspace/engine');
  tests: typeof import('@/workspace/tests');
};
let M: Mods;
const APPS: Record<string, AppRecord> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function build(tpl: string): Promise<AppRecord> {
  const app = M.line.newApp({ request: tpl, tpl, mode: 'demo' });
  const done = M.line.runBuild(app as Parameters<Mods['line']['runBuild']>[0], undefined);
  for (let i = 0; i < 600 && app.status !== 'ready' && app.status !== 'failed'; i++) {
    const r = M.line.RUNS[app.id];
    if (r && r.answer) M.line.answerQuestion(app, 0);
    await sleep(10);
  }
  await done;
  return app;
}
const failedChecks = (app: AppRecord) =>
  Object.entries(app.line).flatMap(([k, st]) => (st.checks || []).filter((c) => !c.ok).map((c) => k + ': ' + c.label + ' · ' + c.detail));
const failedTests = (app: AppRecord) =>
  Object.entries(M.tests.TESTS[app.id].res)
    .filter(([, r]) => !r.ok)
    .map(([id, r]) => id + ': ' + r.actual);

beforeAll(async () => {
  M = {
    core: await import('@/workspace/core'),
    db: await import('@/workspace/db'),
    line: await import('@/workspace/line'),
    engine: await import('@/workspace/engine'),
    tests: await import('@/workspace/tests'),
  };
  M.core.S.settings.demo = true;
  M.core.S.settings.speed = 'instant';
  await M.db.initSqlite();
  for (const id of COMPLEX_TEMPLATES) APPS[id] = await build(id);
}, 120_000);

describe.each(COMPLEX_TEMPLATES)('the %s saved build', (id) => {
  it('builds with every check passed', () => {
    const app = APPS[id];
    expect(failedChecks(app)).toEqual([]);
    expect(app.status).toBe('ready');
  });
  it('passes every generated test', () => {
    M.tests.runTestsSync(APPS[id]);
    expect(failedTests(APPS[id])).toEqual([]);
  });
  it('has a plan that passes the plan checks and says what it works out', () => {
    const p = planFromSaved(id, 0);
    expect(checkPlan(p).filter((c) => !c.ok)).toEqual([]);
    const kinds = new Set(logicLines(p).map((l) => l.kind));
    expect(kinds.has('calc')).toBe(true);
    expect(kinds.has('check') || kinds.has('move')).toBe(true);
  });
  it('is what its own sentence picks, and the older samples keep theirs', () => {
    expect(matchTemplate(CARDS[id].sentence)).toBe(id);
    expect(matchTemplate(CARDS.purchasing.sentence)).toBe('purchasing');
    expect(matchTemplate(CARDS.clinic.sentence)).toBe('clinic');
  });
});

describe('changing an app that works things out', () => {
  it('refuses to rename or remove a field a formula reads, and says what reads it', async () => {
    const changes = await import('@/workspace/changes');
    const app = APPS.dispatch;
    const say = (text: string) => changes.handleChat(app as Parameters<typeof changes.handleChat>[0], text, { rules: true });
    await say('Rename the quantity field in parts_used to how_many');
    expect(app.def.tables.find((t) => t.name === 'parts_used')?.columns.map((c) => c.name)).toContain('quantity');
    expect(app.chat.map((m) => m.text || '').join(' ')).toMatch(/Quantity is used by the calculated field Amount in Parts used/);
    await say('Remove the quantity field from parts_used');
    expect(app.def.tables.find((t) => t.name === 'parts_used')?.columns.map((c) => c.name)).toContain('quantity');
    // the changes it offers never include one it would refuse
    for (const tip of changes.suggestChanges(app)) expect(tip).not.toMatch(/Remove the (quantity|amount|price each)/i);
  });
});

describe('the order desk, used through its own endpoints', () => {
  const call = (role: string, method: string, path: string, body?: Record<string, unknown>) => {
    const app = APPS.orders,
      u = M.engine.appUsers(app).find((x) => x.role === role)!;
    return M.engine.apiCall(app, u, method, '/api/' + path, body || {}, 'check');
  };
  const dept = (id: number) => call('director', 'GET', 'departments').data.find((d: { id: number }) => d.id === id);
  let order = 0,
    line = 0;

  it('totals the demo orders and what is left of each budget', () => {
    const first = call('director', 'GET', 'purchase_orders').data.find((o: { id: number }) => o.id === 1);
    expect([first.line_count, first.total]).toEqual([2, 4890]);
    // Marketing: 5,200 a year, one approved order of 4,460
    expect(dept(3)).toMatchObject({ committed: 4460, remaining: 740, budget_state: 'nearly_spent' });
  });

  it('holds an order back until it has a line and fits the budget', () => {
    const made = call('requester', 'POST', 'purchase_orders', { title: 'Flyers', department: 3, total: 1 });
    expect(made.status).toBe(201);
    order = made.data.id;
    expect(made.data.total).toBe(0); // a calculated field is never taken from what was sent
    expect(call('requester', 'POST', 'purchase_orders/' + order + '/submit')).toMatchObject({ status: 409 });

    expect(call('requester', 'POST', 'order_lines', { item: 'Flyers', purchase_order: order, quantity: 0, unit_price: 500 })).toMatchObject(
      {
        status: 400,
        error: 'The quantity must be more than zero.',
      },
    );
    const added = call('requester', 'POST', 'order_lines', { item: 'Flyers', purchase_order: order, quantity: 2, unit_price: 500 });
    expect(added.data.line_total).toBe(1000);
    line = added.data.id;
    // 1,000 is more than the 740 Marketing has left
    const held = call('requester', 'POST', 'purchase_orders/' + order + '/submit');
    expect(held.status).toBe(409);
    expect(call('requester', 'PATCH', 'order_lines/' + line, { quantity: 1 }).data.line_total).toBe(500);
    expect(call('requester', 'POST', 'purchase_orders/' + order + '/submit')).toMatchObject({ status: 200 });
  });

  it('sends approval to the right person by amount, then locks the order and counts it against the budget', () => {
    expect(call('director', 'POST', 'purchase_orders/' + order + '/approve_large_order').status).toBe(409);
    expect(call('manager', 'POST', 'purchase_orders/' + order + '/approve').status).toBe(200);
    expect(dept(3)).toMatchObject({ committed: 4960, remaining: 240 });
    expect(call('requester', 'PATCH', 'purchase_orders/' + order, { title: 'More flyers' }).status).toBe(409);
    // lines of an order that is no longer a draft cannot be added
    expect(call('requester', 'POST', 'order_lines', { item: 'Posters', purchase_order: order, quantity: 1, unit_price: 5 }).status).toBe(
      400,
    );
    expect(dept(3).committed).toBe(4960);
  });
});

describe('logic an agent got wrong', () => {
  it('two moves to the same stage on the same condition are sent back', async () => {
    const { logicIssues } = await import('@/workspace/logic');
    const def = structuredClone(APPS.orders.def);
    expect(logicIssues(def)).toEqual([]);
    def.process!.transitions.find((x) => x.id === 'approve_large_order')!.when = 'total <= 5000';
    expect(logicIssues(def).join(' ')).toMatch(/"Approve" and "Approve large order" make the same move on the same condition/);
  });
});

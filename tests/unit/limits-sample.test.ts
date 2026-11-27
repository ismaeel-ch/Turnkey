// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppRecord } from '@/shared/types/workspace';
import '@/workspace/saved';

// The browser loads sql.js as a script from /vendor; here it comes straight from node_modules.
vi.mock('@/platform/sqlite', () => ({ loadSqlite: () => createRequire(import.meta.url)('sql.js')() }));

/* The order desk sample, with its limits changed on the Settings page and then used through its own endpoints. */
let engine: typeof import('@/workspace/engine');
let admin: typeof import('@/workspace/app-admin');
let limits: typeof import('@/workspace/limits');
let app: AppRecord;

const call = (role: string, method: string, path: string, body?: Record<string, unknown>) => {
  const u = engine.appUsers(app).find((x) => x.role === role)!;
  return engine.apiCall(app, u, method, '/api/' + path, body || {}, 'check');
};
const limit = (label: string, percent = false) => limits.limitsOf(app.def).find((l) => l.label === label && l.percent === percent)!;

beforeAll(async () => {
  const core = await import('@/workspace/core'),
    db = await import('@/workspace/db'),
    line = await import('@/workspace/line');
  engine = await import('@/workspace/engine');
  admin = await import('@/workspace/app-admin');
  limits = await import('@/workspace/limits');
  core.S.settings.demo = true;
  core.S.settings.speed = 'instant';
  await db.initSqlite();
  app = line.newApp({ request: 'orders', tpl: 'orders', mode: 'demo' }) as unknown as AppRecord;
  const done = line.runBuild(app as Parameters<typeof line.runBuild>[0], undefined);
  for (let i = 0; i < 600 && app.status !== 'ready' && app.status !== 'failed'; i++) {
    const r = line.RUNS[app.id];
    if (r && r.answer) line.answerQuestion(app, 0);
    await new Promise((r2) => setTimeout(r2, 10));
  }
  await done;
  expect(app.status).toBe('ready');
}, 120_000);

describe('limits of the order desk, changed in Settings', () => {
  it('lists the amount that sends an order to the director and the share that warns about a budget', () => {
    const total = limit('Total'),
      share = limit('Yearly budget', true);
    expect(total).toMatchObject({ value: 5000, money: true });
    expect(total.uses.map((u) => u.id).sort()).toEqual(['approve', 'approve_large_order']);
    expect(share).toMatchObject({ value: 80 });
  });

  it('a lower amount sends the next order to the director, with the new number in the reason', () => {
    expect(admin.setLimit(app, limit('Total').key, 300)).toEqual({ ok: true });
    expect(limit('Total').value).toBe(300);
    expect(app.log?.at(-1)?.text).toBe('Settings: the limit on total is now 300');
    const dept = call('director', 'GET', 'departments').data.find((d: { remaining: number }) => d.remaining > 1000);
    const order = call('requester', 'POST', 'purchase_orders', { title: 'Chairs', department: dept.id }).data.id;
    expect(call('requester', 'POST', 'order_lines', { item: 'Chair', purchase_order: order, quantity: 1, unit_price: 500 }).status).toBe(201);
    expect(call('requester', 'POST', 'purchase_orders/' + order + '/submit').status).toBe(200);
    expect(call('manager', 'POST', 'purchase_orders/' + order + '/approve')).toMatchObject({ status: 409, error: 'Orders over 300 need the director.' });
    expect(call('director', 'POST', 'purchase_orders/' + order + '/approve_large_order').status).toBe(200);
  });

  it('a new share works every budget out again', () => {
    const states = () => call('director', 'GET', 'departments').data.map((d: { budget_state: string }) => d.budget_state);
    expect(states()).toContain('nearly_spent');
    expect(admin.setLimit(app, limit('Yearly budget', true).key, 99)).toEqual({ ok: true });
    expect(states()).not.toContain('nearly_spent');
    const col = app.def.tables.find((t) => t.name === 'departments')!.columns.find((c) => c.name === 'budget_state')!;
    expect(col.formula).toContain('yearly_budget * 0.99');
  });

  it('refuses a number that cannot be a limit', () => {
    const rev = app.rev;
    expect(admin.setLimit(app, limit('Total').key, -5)).toEqual({ ok: false, why: 'A limit is a number above zero.' });
    expect(admin.setLimit(app, limit('Yearly budget', true).key, 150)).toEqual({ ok: false, why: 'A share is between 1 and 99 percent.' });
    expect(app.rev).toBe(rev);
  });
});

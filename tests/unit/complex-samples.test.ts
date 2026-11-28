// @vitest-environment jsdom
import { createRequire } from 'node:module';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppRecord } from '@/shared/types/workspace';
import { checkPlan, logicLines } from '@/shared/plan';
import '@/workspace/saved';
import { CARDS, COMPLEX_TEMPLATES, SOFTWARE_NEW, matchTemplate } from '@/workspace/catalog';
import { planFromSaved } from '@/workspace/interview';

// The browser loads sql.js as a script from /vendor; here it comes straight from node_modules.
vi.mock('@/platform/sqlite', () => ({ loadSqlite: () => createRequire(import.meta.url)('sql.js')() }));

/* The saved builds that work numbers out and enforce rules (the four in complex.ts and the three a software house runs on,
   in software.ts), built from their recordings on a real database. */
const LOGIC_APPS = [...COMPLEX_TEMPLATES, ...SOFTWARE_NEW];

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
  for (const id of LOGIC_APPS) APPS[id] = await build(id);
}, 120_000);

describe.each(LOGIC_APPS)('the %s saved build', (id) => {
  it('builds with every check passed', () => {
    const app = APPS[id];
    expect(failedChecks(app)).toEqual([]);
    expect(app.status).toBe('ready');
    // no station was sent back: the recording is right the first time
    expect(
      Object.entries(app.line)
        .filter(([, st]) => (st.attempt || 1) > 1)
        .map(([k]) => k),
    ).toEqual([]);
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
  it('a renamed field is followed by every formula that reads it; a removal is refused and says what reads it', async () => {
    const changes = await import('@/workspace/changes');
    const app = APPS.dispatch;
    const say = (text: string) => changes.handleChat(app as Parameters<typeof changes.handleChat>[0], text, { rules: true });
    const col = (t: string, c: string) => app.def.tables.find((x) => x.name === t)?.columns.find((x) => x.name === c);
    const job = () => M.db.sqlRows(app.id, 'SELECT parts_cost, total FROM jobs WHERE parts_cost > 0 ORDER BY id LIMIT 1', null)[0];
    const before = job();
    await say('Rename the line_total field in parts_used to amount');
    expect(col('parts_used', 'amount')?.formula).toBe('quantity * unit_price');
    expect(col('jobs', 'parts_cost')?.formula).toBe('sum(parts_used.amount)');
    await say('Rename the quantity field in parts_used to how_many');
    expect(col('parts_used', 'amount')?.formula).toBe('how_many * unit_price');
    expect(app.def.logic?.rules.find((r) => r.table === 'parts_used')?.when).toBe('how_many > 0');
    await say('Rename the hourly_rate field in customers to rate_per_hour');
    expect(col('jobs', 'labour_cost')?.formula).toBe('labour_hours * customer.rate_per_hour');
    // the numbers are the same, and a new part still adds up
    expect(job()).toEqual(before);
    const { logicIssues } = await import('@/workspace/logic');
    expect(logicIssues(app.def)).toEqual([]);
    M.tests.runTestsSync(app);
    expect(failedTests(app)).toEqual([]);
    await say('Remove the how_many field from parts_used');
    expect(col('parts_used', 'how_many')).toBeDefined();
    expect(app.chat.map((m) => m.text || '').join(' ')).toMatch(/How many is used by the calculated field Amount in Parts used/);
    // the changes it offers never include one it would refuse
    for (const tip of changes.suggestChanges(app)) expect(tip).not.toMatch(/Remove the (how many|amount|price each)/i);
    // The first import of the workspace's change module, then two full test runs of the app: about 6 s on a CI runner,
    // over vitest's 5 s default.
  }, 20_000);
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

describe('what the real builds taught', () => {
  it('a walkthrough booking that lands on a taken time moves to the next free day', () => {
    const app = APPS.vet;
    const taken = M.db.sqlRows(app.id, "SELECT vet, starts_at, ends_at, pet, client FROM visits WHERE status = 'booked' LIMIT 1", null)[0];
    const st = { rows: {}, last: null };
    const r = M.engine.tourExec(app, st, {
      role: 'front_desk',
      do: 'create',
      table: 'visits',
      values: {
        reason: 'Same time as another visit',
        pet: 1,
        client: 1,
        vet: taken.vet,
        starts_at: taken.starts_at,
        ends_at: taken.ends_at,
      },
      say: 'Sara books a visit.',
    } as Parameters<typeof M.engine.tourExec>[2]);
    expect(r.ok).toBe(true);
    const made = M.db.sqlRows(app.id, 'SELECT starts_at FROM visits WHERE id = ?', [r.rec!.id])[0];
    expect(String(made.starts_at).slice(11)).toBe(String(taken.starts_at).slice(11));
    expect(made.starts_at).not.toBe(taken.starts_at);
  });
});

describe('a move after a line was added', () => {
  it('is a move of the order, not of the line the step before it made', () => {
    const app = APPS.orders;
    const st = { rows: {}, last: null };
    const play = (step: Record<string, unknown>) => M.engine.tourExec(app, st, step as unknown as Parameters<typeof M.engine.tourExec>[2]);
    expect(play({ role: 'requester', do: 'create', table: 'purchase_orders', values: { title: 'Pens', department: 1 } }).ok).toBe(true);
    // the line names another order by its row number; it still joins the order this walk made
    expect(
      play({
        role: 'requester',
        do: 'create',
        table: 'order_lines',
        values: { item: 'Pens', purchase_order: 1, quantity: 2, unit_price: 3 },
      }).ok,
    ).toBe(true);
    const moved = play({ role: 'requester', do: 'transition', transition: 'submit' });
    expect(moved.ok).toBe(true);
    expect(play({ role: 'requester', do: 'denied', action: 'approve' }).ok).toBe(true);
  });
});

/* ---------- the three apps a software house runs on, used through their own endpoints ---------- */
const callIn = (id: string) => (role: string, method: string, path: string, body?: Record<string, unknown>) => {
  const app = APPS[id],
    u = M.engine.appUsers(app).find((x) => x.role === role)!;
  return M.engine.apiCall(app, u, method, '/api/' + path, body || {}, 'check');
};
const one = (rows: { id: number }[], id: number) => rows.find((r) => r.id === id) as Record<string, unknown>;

describe('the sprint board', () => {
  const call = callIn('sprints');
  const sprint = (id: number) => one(call('product_owner', 'GET', 'sprints').data, id);

  it('adds up each sprint and counts the open bugs of each component', () => {
    expect(sprint(2)).toMatchObject({ planned: 31, done_points: 3, room_left: 9, open_critical: 1, health: 'critical_open' });
    const admin = one(call('product_owner', 'GET', 'components').data, 4);
    expect(admin).toMatchObject({ open_bugs: 2, critical_bugs: 1 });
  });

  it('refuses work that would take a sprint over its capacity', () => {
    const over = call('tester', 'POST', 'work_items', { title: 'Big story', kind: 'story', points: 10, sprint: 2 });
    expect(over).toMatchObject({
      status: 400,
      error: 'A sprint cannot take more story points than its capacity. Move something out first.',
    });
    expect(call('tester', 'POST', 'work_items', { title: 'Fits', kind: 'story', points: 9, sprint: 2 }).status).toBe(201);
    expect(sprint(2).room_left).toBe(0);
  });

  it('never closes a critical bug as won’t fix, and only a tester marks work done', () => {
    const critical = call('product_owner', 'POST', 'work_items/17/close_wont_fix');
    expect(critical.status).toBe(409);
    expect(critical.error).toMatch(/critical bug cannot be closed/);
    expect(call('product_owner', 'POST', 'work_items/15/close_wont_fix').status).toBe(200);
    expect(call('developer', 'POST', 'work_items/7/verify').status).toBe(403);
    expect(call('tester', 'POST', 'work_items/7/verify').status).toBe(200);
    expect(call('tester', 'PATCH', 'work_items/7', { title: 'Changed later' }).status).toBe(409);
  });
});

describe('timesheets and client billing', () => {
  const call = callIn('billing');
  const invoice = (id: number) => one(call('finance', 'GET', 'invoices').data, id);

  it('prices hours at the project rate and works out what each invoice and client is owed', () => {
    expect(invoice(1)).toMatchObject({ hours: 21, total: 945, paid: 945, balance: 0, state: 'paid' });
    expect(invoice(2)).toMatchObject({ total: 840, paid: 500, balance: 340, state: 'overdue' });
    expect(invoice(3)).toMatchObject({ hours: 14, total: 630, state: 'open' });
    expect(one(call('finance', 'GET', 'clients').data, 1)).toMatchObject({ billed: 1575, owed: 630 });
    expect(one(call('finance', 'GET', 'projects').data, 2)).toMatchObject({ used: 1080, budget_left: 220, budget_state: 'nearly_used' });
    // hours that are not billable are worth nothing
    expect(one(call('finance', 'GET', 'time_entries').data, 4).amount).toBe(0);
  });

  it('keeps developers to their own hours, at most 12 at a time, and out of the invoices', () => {
    const mine = call('developer', 'GET', 'time_entries').data as { person: number }[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((e) => e.person === mine[0].person)).toBe(true);
    expect(call('developer', 'POST', 'time_entries', { note: 'Long day', project: 1, worked_on: '2026-01-05', hours: 13 }).status).toBe(
      400,
    );
    expect(call('developer', 'GET', 'invoices').status).toBe(403);
  });

  it('bills only approved, billable hours of the same client, and never takes more than is owed', () => {
    expect(call('finance', 'PATCH', 'time_entries/8', { invoice: 3 })).toMatchObject({
      status: 400,
      error: 'An invoice only takes hours from its own client’s projects.',
    });
    expect(call('finance', 'PATCH', 'time_entries/4', { invoice: 3 }).status).toBe(200);
    expect(call('finance', 'POST', 'time_entries/4/mark_invoiced')).toMatchObject({
      status: 409,
      error: 'Hours that are not billable are never invoiced.',
    });
    expect(
      call('finance', 'POST', 'payments', { reference: 'Too much', invoice: 2, received_on: '2026-01-05', amount: 400 }),
    ).toMatchObject({
      status: 400,
      error: 'Payments cannot add up to more than the invoice.',
    });
    expect(call('finance', 'POST', 'payments', { reference: 'The rest', invoice: 2, received_on: '2026-01-05', amount: 340 }).status).toBe(
      201,
    );
    expect(invoice(2)).toMatchObject({ balance: 0, state: 'paid' });
  });
});

describe('client onboarding', () => {
  const call = callIn('onboarding');
  const onboarding = (id: number) => one(call('delivery_lead', 'GET', 'onboardings').data, id);

  it('works out the deposit due, the open required steps and the team', () => {
    expect(onboarding(2)).toMatchObject({ deposit_due: 7200, steps: 5, required_open: 1, team_size: 2 });
    expect(onboarding(4)).toMatchObject({ steps: 0, team_size: 0 });
  });

  it('holds setup back until there is a checklist and a team', () => {
    const held = call('delivery_lead', 'POST', 'onboardings/4/start_setup');
    expect(held).toMatchObject({ status: 409, error: 'Add the checklist and at least one team member first.' });
  });

  it('goes live only when every required step is done and the deposit is in, then closes the checklist', () => {
    expect(call('delivery_lead', 'POST', 'onboardings/2/go_live').status).toBe(409);
    expect(call('delivery_lead', 'PATCH', 'checklist_items/8', { done: true }).status).toBe(200);
    expect(onboarding(2).required_open).toBe(0);
    expect(call('delivery_lead', 'POST', 'onboardings/2/go_live').status).toBe(200);
    expect(call('delivery_lead', 'PATCH', 'onboardings/2', { project: 'Something else' }).status).toBe(409);
    expect(call('delivery_lead', 'POST', 'checklist_items', { step: 'Late step', onboarding: 2 })).toMatchObject({
      status: 400,
      error: 'This client is live, so its checklist is closed.',
    });
  });

  it('shows a client only their own onboarding', () => {
    const seen = call('client', 'GET', 'onboardings').data as { client_name: string }[];
    expect(seen.map((o) => o.client_name)).toEqual(['Fourth Coffee']);
    expect(call('client', 'GET', 'checklist_items').status).toBe(403);
  });
});

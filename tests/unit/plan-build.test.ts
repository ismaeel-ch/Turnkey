import { describe, expect, it } from 'vitest';
import { checkPrompt } from '@/server/guard/prompt';
import { detectRole } from '@/server/agents/registry';
import { issuesOf } from '@/server/agents/schemas';
import { roleAnswer } from '@/server/llm/providers/mock-roles';
import {
  COMPANY_EXPENSES,
  EXTRA_FIELDS,
  PERSONAL_EXPENSES,
  STAGE_FIELD,
  backendFromPlan,
  briefFromPlan,
  mendToPlan,
  outlineOf,
  outlineProblems,
  type PlanSpec,
} from '@/shared/plan';
import type { BriefedDef, ColumnDef } from '@/shared/types/app';
import { checkBackendShape, checkBrief, checkSchemaShape, hasProcess, normBackend, normSchema } from '@/workspace/engine';
import { PROMPTS, flowFromPlan, planOf, type BuildApp } from '@/workspace/line';

const copy = (plan: PlanSpec): PlanSpec => structuredClone(plan);
const failed = (checks: { ok: boolean; label: string; detail: string }[]) =>
  checks.filter((c) => !c.ok).map((c) => c.label + ': ' + c.detail);

/** The tables of a plan exactly as planned: what `mendToPlan` makes from nothing. */
const tablesOf = (plan: PlanSpec) => mendToPlan(plan, []);
const col = (name: string, type: ColumnDef['type'], more: Partial<ColumnDef> = {}): ColumnDef => ({
  name,
  label: name,
  type,
  required: false,
  ...more,
});

describe('briefFromPlan', () => {
  it('reads the roles, records and process off a plan with stages', () => {
    const b = briefFromPlan(COMPANY_EXPENSES);
    expect(b.name).toBe('Expense Desk');
    expect(b.roles.map((r) => r.id)).toEqual(['employee', 'manager', 'finance']);
    expect(b.entities.map((e) => e.name)).toEqual(['claims', 'categories', 'teams', 'payments']);
    expect(b.process).toEqual({
      entity: 'claims',
      states: ['draft', 'submitted', 'approved', 'paid', 'rejected'],
      note: COMPANY_EXPENSES.stages?.note,
    });
    expect(b.question).toBeNull();
    expect(b.planned).toBe(true);
    expect(failed(checkBrief(b))).toEqual([]);
  });

  it('names the main list and no states when records are just kept', () => {
    const b = briefFromPlan(PERSONAL_EXPENSES);
    expect(b.roles).toHaveLength(1);
    expect(b.process).toEqual({ entity: 'expenses', states: [], note: '' });
    expect(hasProcess(b)).toBe(false);
    expect(failed(checkBrief(b))).toEqual([]);
  });

  it('keeps what the owner answered as the decision, and leaves out what was assumed', () => {
    const b = briefFromPlan(PERSONAL_EXPENSES);
    expect(b.decision?.answer).toBe('Just me. Yes. Yes, add demo data');
    expect(b.decision?.text).not.toContain('currencies');
    expect(briefFromPlan({ ...copy(PERSONAL_EXPENSES), answers: [] }).decision).toBeNull();
  });

  it('is the only way one role or no process passes: a brief an agent wrote still needs two roles and a process', () => {
    const b = { ...briefFromPlan(PERSONAL_EXPENSES), planned: false };
    expect(failed(checkBrief(b)).length).toBeGreaterThanOrEqual(2);
  });
});

describe('outlineOf and outlineProblems', () => {
  it('writes one line per list in the notation of the other prompts', () => {
    const lines = outlineOf(PERSONAL_EXPENSES).split('\n');
    expect(lines).toEqual([
      'expenses (title: what_for, owner: none): what_for:text*, spent_on:date*, amount:money*, category:ref->categories, paid_with:select[cash|card|bank_transfer], note:longtext',
      'categories (title: name, owner: none): name:text*, monthly_budget:money',
    ]);
    expect(outlineOf(COMPANY_EXPENSES)).toContain('claims (title: what_for, owner: employee): what_for:text*, employee:user(employee)*');
  });

  it('finds nothing wrong with the tables of the plan itself', () => {
    for (const plan of [PERSONAL_EXPENSES, COMPANY_EXPENSES]) expect(outlineProblems(plan, tablesOf(plan))).toEqual([]);
  });

  it('says where tables leave the plan', () => {
    const tables = tablesOf(PERSONAL_EXPENSES);
    const expenses = tables[0];
    expenses.columns = expenses.columns.filter((c) => c.name !== 'amount').map((c) => (c.name === 'spent_on' ? { ...c, type: 'text' } : c));
    expenses.columns.push(col('a', 'text'), col('b', 'text'), col('c', 'text'));
    expenses.title = 'note';
    tables.push({ name: 'receipts', title: 'name', owner: null, columns: [col('name', 'text')] });
    tables.splice(1, 1);
    expect(outlineProblems(PERSONAL_EXPENSES, tables)).toEqual([
      'not in the plan: receipts. Use only the lists of the plan',
      'expenses.spent_on must be of type date, not text',
      'expenses needs the column "amount" (money)',
      'expenses has 3 columns the plan does not have (a, b, c). At most ' + EXTRA_FIELDS,
      'the title of expenses must be "what_for"',
      'the plan has a list "categories" and there is no table for it',
    ]);
  });

  it('allows a few added columns, and a link must point where the plan says', () => {
    const tables = tablesOf(PERSONAL_EXPENSES);
    tables[0].columns.push(col('receipt_link', 'text'), col('paid_on', 'date'));
    expect(outlineProblems(PERSONAL_EXPENSES, tables)).toEqual([]);
    tables[0].columns = tables[0].columns.map((c) => (c.name === 'category' ? { ...c, ref: 'expenses' } : c));
    expect(outlineProblems(PERSONAL_EXPENSES, tables)).toEqual(['expenses.category must point to categories']);
  });
});

describe('mendToPlan', () => {
  it('brings any tables back to the plan', () => {
    const mended = mendToPlan(PERSONAL_EXPENSES, [
      {
        name: 'expenses',
        title: 'note',
        owner: null,
        columns: [
          col('what_for', 'text', { required: true, label: 'Spent on what' }),
          col('amount', 'text'),
          col('x1', 'text'),
          col('x2', 'text'),
          col('x3', 'text'),
        ],
        rows: [{ what_for: 'Train ticket', amount: 'twelve', x1: 'kept', x3: 'dropped' }],
      },
      { name: 'receipts', title: 'name', owner: null, columns: [col('name', 'text')], rows: [{ name: 'A receipt' }] },
    ]);
    expect(mended.map((t) => t.name)).toEqual(['expenses', 'categories']);
    expect(outlineProblems(PERSONAL_EXPENSES, mended)).toEqual([]);
    const [expenses, categories] = mended;
    expect(expenses.columns.map((c) => c.name)).toEqual(['what_for', 'spent_on', 'amount', 'category', 'paid_with', 'note', 'x1', 'x2']);
    // the agent's own column stays where it agrees with the plan
    expect(expenses.columns[0].label).toBe('Spent on what');
    expect(expenses.title).toBe('what_for');
    // a value of the wrong type is not carried over, and a column code added cannot be required of rows written without it
    expect(expenses.rows).toEqual([{ what_for: 'Train ticket', x1: 'kept' }]);
    expect(expenses.columns.find((c) => c.name === 'amount')?.required).toBe(false);
    expect(expenses.columns.find((c) => c.name === 'what_for')?.required).toBe(true);
    expect(categories.rows).toEqual([]);
    expect(categories.columns.find((c) => c.name === 'name')?.required).toBe(true);
    expect(categories.label).toBe('Categories');
    expect(categories.one).toBe('Category');
  });

  it('takes the owner of a list from the plan', () => {
    const tables = tablesOf(COMPANY_EXPENSES);
    expect(tables[0].owner).toBe('employee');
    expect(tables[0].columns.find((c) => c.name === 'employee')).toMatchObject({ type: 'user', role: 'employee' });
    expect(tables[0].columns.find((c) => c.name === 'category')).toMatchObject({ type: 'ref', ref: 'categories' });
  });
});

describe('backendFromPlan', () => {
  it('writes the stages, the moves and who may make them', () => {
    const be = backendFromPlan(COMPANY_EXPENSES);
    expect(be.status).toMatchObject({ table: 'claims', column: STAGE_FIELD, initial: 'draft' });
    expect(be.status?.states.map((s) => s.id)).toEqual(['draft', 'submitted', 'approved', 'paid', 'rejected']);
    expect(be.status?.states.find((s) => s.id === 'rejected')?.tone).toBe('danger');
    const moves = COMPANY_EXPENSES.stages?.moves || [];
    expect(be.status?.transitions.map((t) => [t.from, t.to, t.roles])).toEqual(moves.map((m) => [m.from, m.to, m.by]));
    expect(new Set(be.status?.transitions.map((t) => t.id)).size).toBe(moves.length);
    for (const t of be.status?.transitions || []) expect(t.id).toMatch(/^[a-z0-9_]+$/);
    expect(issuesOf('backend', be)).toEqual([]);
  });

  it('gives every kind of person a line for every list, exactly as the plan has it', () => {
    const be = backendFromPlan(COMPANY_EXPENSES);
    expect(be.access).toHaveLength(COMPANY_EXPENSES.lists.length * COMPANY_EXPENSES.people.length);
    for (const a of be.access) {
      const { table, role, ...rest } = a;
      expect(rest).toEqual(COMPANY_EXPENSES.permissions[table][role]);
    }
  });

  it('has no stages for an app that only keeps records, and closes what the plan left out', () => {
    const plan = copy(PERSONAL_EXPENSES);
    delete plan.permissions.categories;
    const be = backendFromPlan(plan);
    expect(be.status).toBeNull();
    expect(be.access).toEqual([
      { table: 'expenses', role: 'owner', list: 'all', create: true, update: 'all', delete: true },
      { table: 'categories', role: 'owner', list: 'none', create: false, update: 'none', delete: false },
    ]);
    expect(issuesOf('backend', be)).toEqual([]);
  });
});

/** A Live app at the start of its build, as far as the prompts and checks read it. */
function planned(plan: PlanSpec, mode = 'live') {
  // only the fields the prompts read are set, so the test says so with a cast
  return {
    id: 'app_test',
    mode,
    plan,
    request: 'I want to build an expense management app',
    def: { brief: briefFromPlan(plan) },
  } as unknown as BuildApp;
}

describe('a build that follows its plan', () => {
  it('only a Live build follows a plan: a saved build keeps its recording', () => {
    expect(planOf(planned(COMPANY_EXPENSES))).toBe(COMPANY_EXPENSES);
    expect(planOf(planned(COMPANY_EXPENSES, 'demo'))).toBeNull();
    expect(PROMPTS.database(planned(COMPANY_EXPENSES, 'demo'))).not.toContain('LISTS OF THE PLAN');
  });

  it('sets the team the plan calls for: code for the rules of a one-person app, a pause and an access review for a company', () => {
    const solo = planned(PERSONAL_EXPENSES);
    flowFromPlan(solo);
    expect(solo.flow).toMatchObject({ by: { backend: 'rules' }, approve: {}, reviewers: [] });
    const company = planned(COMPANY_EXPENSES);
    flowFromPlan(company);
    expect(company.flow).toMatchObject({ by: {}, approve: { backend: true }, reviewers: ['security'] });
    // a saved build has no plan to follow, so its workflow is left alone
    const saved = planned(COMPANY_EXPENSES, 'demo');
    flowFromPlan(saved);
    expect(saved.flow).toBeUndefined();
  });

  for (const plan of [PERSONAL_EXPENSES, COMPANY_EXPENSES])
    it('the Database and Backend prompts carry the plan, and the stand-in model keeps to it: ' + plan.name, () => {
      const app = planned(plan);
      const brief = briefFromPlan(plan);

      const dbPrompt = PROMPTS.database(app);
      expect(dbPrompt).toContain('LISTS OF THE PLAN (name:type, * = required):\n' + outlineOf(plan));
      expect(checkPrompt(dbPrompt)).toEqual({ ok: true, kind: 'line' });
      expect(detectRole(dbPrompt)).toBe('database');
      const dbAnswer = roleAnswer(dbPrompt) as string;
      expect(issuesOf('database', JSON.parse(dbAnswer))).toEqual([]);
      const schema = normSchema(JSON.parse(dbAnswer), brief);
      expect(failed(checkSchemaShape(schema, brief))).toEqual([]);
      expect(outlineProblems(plan, schema.tables)).toEqual([]);
      expect(schema.users.map((u) => u.role).sort()).toEqual(expect.arrayContaining(plan.people.map((p) => p.id)));

      const def = { brief, tables: schema.tables, users: schema.users } as unknown as BriefedDef; // the fields the Backend step reads
      const bePrompt = PROMPTS.backend({ ...app, def } as unknown as BuildApp);
      expect(bePrompt).toContain('RULES OF THE PLAN: ' + JSON.stringify(backendFromPlan(plan)));
      expect(checkPrompt(bePrompt)).toEqual({ ok: true, kind: 'line' });
      expect(detectRole(bePrompt)).toBe('backend');
      const beAnswer = roleAnswer(bePrompt) as string;
      expect(issuesOf('backend', JSON.parse(beAnswer))).toEqual([]);
      const backend = normBackend(JSON.parse(beAnswer), def);
      expect(failed(checkBackendShape(def, backend))).toEqual([]);
      expect(backend.process.states.map((s) => s.id)).toEqual(plan.stages ? plan.stages.stages.map((s) => s.id) : []);
      for (const l of plan.lists) for (const p of plan.people) expect(backend.access[l.name][p.id]).toEqual(plan.permissions[l.name][p.id]);

      // the same rules, written by code, pass the same checks: this is the step when the plan gives it to code
      const byCode = normBackend(backendFromPlan(plan), def);
      expect(failed(checkBackendShape(def, byCode))).toEqual([]);
      expect(byCode.access).toEqual(backend.access);
    });
});

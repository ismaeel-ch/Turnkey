/**
 * One zod schema per agent role, written from the normalisers the browser applies to the same answer
 * (normBrief, normSchema, normBackend, normViews, normUI, normCases, normFindings in src/workspace).
 *
 * The rule: be as lenient as the browser. A schema may reject only what the browser's own checks would certainly
 * reject (for example a brief with one role, or a dashboard with no widgets). Everything the normalisers repair,
 * rename, clamp or fill in is accepted here: aliases, extra keys, strings where objects are expected, out-of-range
 * counts the normaliser trims. The browser still runs every check; this is an extra gate in front of it.
 */
import { z } from 'zod';
import type { StepRole } from '@/shared/agent-contract';

const obj = <T extends z.ZodRawShape>(shape: T) => z.looseObject(shape);
const text = z.string().trim().min(1);
const list = <T extends z.ZodType>(item: T, min: number, what: string) => z.array(item).min(min, `needs at least ${min} ${what}`);
const anyItem = z.unknown();
/** a name given as a plain string or as an object with a name, id or label */
const named = z.union([
  text,
  obj({}).refine((o) => ['name', 'id', 'label'].some((k) => typeof o[k] === 'string' && String(o[k]).trim()), 'needs a name'),
]);

export const research = obj({
  name: text,
  summary: text,
  roles: list(named, 2, 'roles'),
  entities: list(named, 2, 'kinds of record'),
  process: obj({ entity: text, states: list(named, 3, 'process states') }),
  stories: list(obj({ want: text }), 2, 'user stories'),
});

/**
 * The Planner's plan. Unlike the brief it may have one kind of person and no stages. The browser's `normPlan` and
 * `checkPlan` (src/shared/plan) do the real checking; this refuses only an answer with no plan in it.
 */
export const plan = obj({
  name: text,
  summary: text,
  people: list(named, 1, 'kinds of people'),
  lists: list(obj({ name: text, fields: list(named, 1, 'fields') }), 1, 'lists'),
});
/** The Planner's first answer: the cards may be empty when the request already says everything. */
export const questions = obj({ reflect: z.string().optional(), cards: z.array(anyItem).optional(), draft: plan });

export const database = obj({
  tables: list(obj({ name: text, columns: list(obj({ name: text }), 1, 'columns') }), 1, 'tables'),
  users: list(obj({ role: text }), 1, 'users'),
});

const backendStatus = obj({
  states: list(named, 1, 'workflow states'),
  transitions: list(obj({ from: z.unknown(), to: text }), 1, 'workflow transitions'),
});
// with no access rules every role gets "none" everywhere, which the browser's checks always refuse
const access = z.union([z.array(anyItem), obj({})]);
export const backend = z.union(
  [obj({ status: backendStatus, access }), obj({ workflow: backendStatus, access }), obj({ process: backendStatus, access })],
  {
    error: 'needs a "status" object with states and transitions',
  },
);

export const views = obj({
  views: z.array(obj({ table: text })),
  dashboard: obj({ widgets: list(obj({ kind: text }), 2, 'dashboard widgets (at least one number and one chart)') }),
});

export const screens = obj({
  screens: list(obj({ table: z.string().optional() }), 1, 'screens'),
  theme: obj({}).optional(),
  tour: z.array(anyItem).optional(),
});

export const walkthrough = obj({ tour: list(obj({ role: text }), 1, 'tour steps') });

export const tester = obj({ cases: z.array(obj({ steps: z.array(anyItem) })) });

export const qaRepair = obj({ fixes: z.array(anyItem).optional(), wrong: z.array(anyItem).optional(), say: z.string().optional() });

export const review = obj({ findings: z.array(anyItem) });

export const change = obj({ reply: z.string().optional(), ops: z.array(anyItem).optional() }).refine(
  (o) => typeof o.reply === 'string' || Array.isArray(o.ops),
  'needs a "reply" sentence or a list of "ops"',
);

export const team = obj({});
export const anyObject = obj({});

export const SCHEMAS: Record<StepRole, z.ZodType> = {
  questions,
  plan,
  research,
  database,
  backend,
  views,
  screens,
  walkthrough,
  tester,
  qa_repair: qaRepair,
  review,
  change,
  team,
  any: anyObject,
};

/** The problems found, each one a short plain sentence the model can act on. */
export function issuesOf(role: StepRole, value: unknown): string[] {
  const r = SCHEMAS[role].safeParse(value);
  if (r.success) return [];
  const out = new Set<string>();
  for (const i of r.error.issues) {
    const where = i.path.length ? `"${i.path.join('.')}": ` : '';
    // a union reports the problems of every branch; the first branch's list is the useful one
    const sub = i.code === 'invalid_union' ? i.errors?.[0]?.[0] : undefined;
    out.add(where + (sub ? (sub.path.length ? `"${sub.path.join('.')}": ` : '') + sub.message : i.message));
  }
  return [...out].slice(0, 6);
}

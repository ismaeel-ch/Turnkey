import { render } from '@/platform/dom';
import type { ColumnType } from '@/shared/sql/types';
import type {
  AppDef,
  AppTable,
  AppUser,
  BackedDef,
  BriefedDef,
  Brief,
  Check,
  ColumnDef,
  Permission,
  Process,
  ProcessState,
  Row,
  Scope,
  SeedUser,
  TableDef,
  Tone,
  TourStep,
  Transition,
  Untrusted,
} from '@/shared/types/app';
import type { SqlValue } from '@/shared/types/sqljs';
import type { AppRecord, Dict, ToolContext } from '@/shared/types/workspace';
import { APILOG, arr, errText, dayOffset, label, nowStamp, pad2, ring, singular, snake, str, toolCall } from './core';
import {
  SYS_SQL,
  createTableSQL,
  dbDrop,
  dbExists,
  dbRollback,
  dbSavepoint,
  lastId,
  qi,
  sqlMany,
  sqlPeek,
  sqlRows,
  sqlRun,
  topoOrder,
} from './db';
import { canRunTeam, normTeam } from './team';
import { AppPane, newPane } from './runtime';

/* ===== Turnkey prototype · engine: definitions, station checks, the role-guarded API, acceptance runner ===== */
export const TYPES: readonly string[] = ['text', 'longtext', 'number', 'money', 'date', 'datetime', 'bool', 'select', 'ref', 'user'];
export const TYPE_ALIAS: Dict<ColumnType> = {
  string: 'text',
  varchar: 'text',
  email: 'text',
  phone: 'text',
  url: 'text',
  textarea: 'longtext',
  markdown: 'longtext',
  int: 'number',
  integer: 'number',
  float: 'number',
  decimal: 'number',
  numeric: 'number',
  currency: 'money',
  price: 'money',
  amount: 'money',
  boolean: 'bool',
  checkbox: 'bool',
  enum: 'select',
  choice: 'select',
  status: 'select',
  timestamp: 'datetime',
  reference: 'ref',
  fk: 'ref',
  link: 'ref',
  person: 'user',
};
export const TYPE_LABEL: Dict<string> = {
  text: 'Text',
  longtext: 'Long text',
  number: 'Number',
  money: 'Money',
  date: 'Date',
  datetime: 'Date and time',
  bool: 'Yes / No',
  select: 'Choice',
  ref: 'Link',
  user: 'Person',
};
export const TONES: readonly Tone[] = ['neutral', 'info', 'success', 'warning', 'danger'];
export const ACCENTS = [
  'teal',
  'blue',
  'purple',
  'cranberry',
  'forest',
  'marigold',
  'pink',
  'steel',
  'pumpkin',
  'lavender',
  'royalBlue',
  'magenta',
  'navy',
  'grape',
  'seafoam',
];
export const VIEW_TYPES: readonly string[] = [
  'table',
  'board',
  'calendar',
  'timeline',
  'chart',
  'pivot',
  'tree',
  'cards',
  'dashboard',
  'form',
  'agents',
];
export const VIEW_ICON: Dict<string> = {
  table: 'table',
  board: 'board',
  calendar: 'calendar',
  timeline: 'timeline',
  chart: 'dashboard',
  pivot: 'grid',
  tree: 'branch',
  cards: 'apps',
  dashboard: 'pie',
  form: 'form',
  agents: 'bot',
};
export const VIEW_LABEL: Dict<string> = {
  table: 'Table',
  board: 'Board',
  calendar: 'Calendar',
  timeline: 'Timeline',
  chart: 'Chart',
  pivot: 'Pivot',
  tree: 'Tree',
  cards: 'Cards',
  dashboard: 'Dashboard',
  form: 'Form',
  agents: 'Agents',
};
export const LIMITS = {
  tables: 8,
  cols: 12,
  screens: 12,
  rows: 40,
};
export const tableOf = (def: Pick<AppDef, 'tables'>, name: string | null | undefined): AppTable | undefined =>
  def.tables.find((t) => t.name === name);
export const colOf = (t: TableDef | null | undefined, name: string | null | undefined): ColumnDef | null | undefined =>
  t ? t.columns.find((c) => c.name === name) : null;
export const roleName = (def: AppDef, id: string) => {
  const r = def.brief && def.brief.roles.find((x) => x.id === id);
  return r ? r.name : label(id);
};
export const accOf = (def: Pick<AppDef, 'access'>, role: string, table: string): Permission =>
  (def.access[table] || {})[role] || {
    list: 'none',
    create: false,
    update: 'none',
    delete: false,
  };
export const chk = (name: string, ok: unknown, detail?: string): Check => ({
  label: name,
  ok: !!ok,
  detail: detail || '',
});
export const issuesOf = (checks: Check[]) => checks.filter((c) => !c.ok).map((c) => c.label + (c.detail ? ': ' + c.detail : ''));
export const appUsers = (app: Pick<AppRecord, 'id'>): AppUser[] =>
  dbExists(app.id) ? (sqlPeek(app.id, 'SELECT id, name, username, role FROM "users" ORDER BY id') as unknown as AppUser[]) : [];
export function findTable(def: AppDef, q: unknown) {
  const k = snake(q);
  if (!k) return null;
  const s = singular(k);
  return (
    def.tables.find((t) => t.name === k) ||
    def.tables.find((t) => snake(t.label) === k || snake(t.one) === k || singular(t.name) === s || snake(t.one) === s) ||
    def.tables.find((t) => t.name.indexOf(s) >= 0 || s.indexOf(singular(t.name)) >= 0) ||
    null
  );
}
export function findCol(t: AppTable, q: unknown) {
  const k = snake(q);
  if (!k) return null;
  return (
    t.columns.find((c) => c.name === k) ||
    t.columns.find((c) => snake(c.label) === k) ||
    t.columns.find((c) => c.name.replace(/_(id|on|at)$/, '') === k || snake(c.label).indexOf(k) >= 0) ||
    null
  );
}
export function findRole(def: BriefedDef, q: unknown) {
  const k = singular(snake(q));
  if (!k) return null;
  return (
    def.brief.roles.find((r) => r.id === k || singular(snake(r.name)) === k) ||
    def.brief.roles.find((r) => r.id.indexOf(k) >= 0 || snake(r.name).indexOf(k) >= 0) ||
    null
  );
}

/* ---------- station 1: the brief ---------- */
export function normBrief(o: Untrusted): Brief {
  o = o || {};
  const seen: Dict<number> = {};
  const p = o.process || {};
  const q = o.question;
  const roles = arr(o.roles)
    .map((r: Untrusted) => ({
      id: snake(r && (r.id || r.name)),
      name: str(r && r.name) || label(r && r.id),
      can: str(r && (r.can || r.description)),
    }))
    .filter((r) => r.id && !seen[r.id] && (seen[r.id] = 1));
  const entities = arr(o.entities)
    .map((e: Untrusted) =>
      typeof e === 'string'
        ? {
            name: snake(e),
            what: '',
          }
        : {
            name: snake(e && e.name),
            what: str(e && (e.what || e.description)),
          },
    )
    .filter((e) => e.name && e.name !== 'users')
    .slice(0, 6);
  let ent = snake(p.entity);
  if (!entities.some((e) => e.name === ent)) {
    const near = entities.find((e) => singular(e.name) === singular(ent));
    if (near) ent = near.name;
  }
  const ids = roles.slice(0, 4).map((r) => r.id),
    all = arr(o.stories)
      .map((s: Untrusted) => ({
        role: snake(s && (s.role || s.as)),
        want: str(s && s.want),
        so: str(s && s.so),
      }))
      .filter((s) => s.want),
    known = all.filter((s) => ids.includes(s.role));
  return {
    name: str(o.name).slice(0, 40),
    summary: str(o.summary),
    roles: roles.slice(0, 4),
    entities,
    process: {
      entity: ent,
      states: arr(p.states)
        .map((s: Untrusted) => snake(typeof s === 'string' ? s : s && (s.id || s.label)))
        .filter((s: string, i: number, a: string[]) => s && a.indexOf(s) === i)
        .slice(0, 7),
      note: str(p.note),
    },
    stories: (known.length >= 2 ? known : all).slice(0, 8),
    rules: arr(o.rules).map(str).filter(Boolean).slice(0, 8),
    question:
      q && str(q.text) && arr(q.options).length >= 2
        ? {
            text: str(q.text),
            options: q.options.map(str).slice(0, 4),
            recommended: Math.min(Math.max(parseInt(q.recommended, 10) || 0, 0), Math.min(q.options.length, 4) - 1),
          }
        : null,
    decision: null,
    sources: [],
  };
}
export function checkBrief(b: Brief) {
  const ids = b.roles.map((r) => r.id);
  const bad = b.stories.filter((s) => !ids.includes(s.role));
  return [
    chk('2 to 4 roles', b.roles.length >= 2 && b.roles.length <= 4, b.roles.length + ' roles: ' + b.roles.map((r) => r.name).join(', ')),
    chk('2 to 6 kinds of record', b.entities.length >= 2 && b.entities.length <= 6, b.entities.map((e) => e.name).join(', ')),
    chk(
      'One process with 3 to 7 states',
      b.process.states.length >= 3 && b.process.states.length <= 7 && b.entities.some((e) => e.name === b.process.entity),
      b.process.entity ? b.process.entity + ': ' + b.process.states.join(' → ') : 'no process named',
    ),
    chk(
      'Every user story belongs to a known role',
      b.stories.length >= 2 && !bad.length,
      bad.length ? 'unknown role: ' + bad.map((s) => s.role).join(', ') : b.stories.length + ' stories',
    ),
    chk('The app has a name and a one-line summary', !!b.name && !!b.summary, b.name),
  ];
}

/* ---------- station 2: tables and seed data ---------- */
/** What the Database agent hands over: tables with their seed rows, and the seed users. */
export interface SchemaDraft {
  tables: (AppTable & { rows: Row[] })[];
  users: SeedUser[];
  repaired: boolean;
}
export function normSchema(o: Untrusted, brief: Brief, repair?: boolean, maxRows?: number): SchemaDraft {
  o = o || {};
  const roleIds = brief.roles.map((r) => r.id);
  const tables = arr(o.tables)
    .map((t: Untrusted) => {
      t = t || {};
      const name = snake(t.name);
      const used: Dict<number> = {};
      const columns = arr(t.columns)
        .map((c: Untrusted) => {
          c = c || {};
          let type = String(c.type || 'text').toLowerCase();
          type = TYPES.includes(type) ? type : TYPE_ALIAS[type] || 'text';
          const col: ColumnDef = {
            name: snake(c.name),
            label: str(c.label) || label(c.name),
            type: type as ColumnType,
            required: !!c.required,
          };
          if (type === 'ref') {
            col.ref = snake(c.ref);
            if (col.ref === 'users') {
              col.type = 'user';
              delete col.ref;
            }
          }
          if (col.type === 'select') {
            const options = arr(c.options).map(snake).filter(Boolean);
            col.options = options;
            if (c.labels && typeof c.labels === 'object') {
              const labels: Dict<string> = (col.labels = {});
              Object.keys(c.labels).forEach((k) => {
                if (options.includes(snake(k)) && str(c.labels[k])) labels[snake(k)] = str(c.labels[k]);
              });
            }
          }
          if (col.type === 'user') col.role = roleIds.includes(snake(c.role)) ? snake(c.role) : null;
          return col;
        })
        .filter((c) => c.name && !['id', 'created_by', 'created_at'].includes(c.name) && !used[c.name] && (used[c.name] = 1))
        .slice(0, LIMITS.cols);
      let title = snake(t.title);
      if (!columns.some((c) => c.name === title)) {
        const f = columns.find((c) => c.type === 'text') || columns[0];
        title = f ? f.name : '';
      }
      let owner: string | null = snake(t.owner);
      if (!columns.some((c) => c.name === owner && c.type === 'user')) owner = null;
      return {
        name,
        label: str(t.label) || label(name),
        one: str(t.one) || singular(label(name)),
        title,
        owner,
        columns,
        rows: arr(t.rows).slice(0, maxRows || LIMITS.rows),
      };
    })
    .filter((t) => t.name && t.name !== 'users' && t.name !== 'activity');
  const taken: Dict<number> = {};
  const users: SeedUser[] = arr(o.users)
    .map((u: Untrusted) => ({
      name: str(u && u.name),
      role: snake(u && u.role),
    }))
    .filter((u) => u.name && roleIds.includes(u.role))
    .slice(0, 12)
    .map((u) => {
      const base = snake(u.name.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, '').split(/\s+/)[0]) || 'user';
      let un = base,
        i = 2;
      while (taken[un]) un = base + i++;
      taken[un] = 1;
      return {
        name: u.name,
        role: u.role,
        username: un,
        password: 'demo',
      };
    });
  if (repair) {
    // last attempt: mend what code can mend instead of failing the build
    const names = tables.map((t) => t.name),
      pt = tables.find((t) => t.name === brief.process.entity);
    tables.forEach((t) => {
      t.columns = t.columns.filter((c) => !(c.type === 'ref' && !names.includes(c.ref as string)));
      t.columns.forEach((c) => {
        if (c.type === 'select' && !(c.options || []).length) c.type = 'text';
      });
      if (!t.columns.some((c) => c.name === t.title)) t.title = (t.columns[0] || {}).name || '';
    });
    if (pt) {
      let c: ColumnDef | undefined = pt.columns.find((x) => x.name === 'status');
      if (!c) {
        c = {
          name: 'status',
          label: 'Status',
          type: 'select',
          required: true,
          options: [],
        };
        pt.columns.push(c);
      }
      const options = brief.process.states.slice();
      c.type = 'select';
      c.required = true;
      c.options = options;
      pt.rows.forEach((r) => {
        if (r && !options.includes(snake(r.status))) r.status = options[0];
      });
    }
    brief.roles.forEach((r) => {
      if (!users.some((u) => u.role === r.id))
        users.push({
          name: r.name + ' One',
          role: r.id,
          username: snake(r.id).slice(0, 12) + '1',
          password: 'demo',
        });
    });
  }
  return {
    tables,
    users,
    repaired: !!repair,
  };
}
export function checkSchemaShape(sc: SchemaDraft, brief: Brief) {
  const names = sc.tables.map((t) => t.name);
  const out: Check[] = [];
  const missing = brief.entities.filter((e) => !names.includes(e.name)).map((e) => e.name);
  out.push(
    chk(
      'Every kind of record has a table',
      !missing.length && sc.tables.length > 0,
      missing.length ? 'no table for ' + missing.join(', ') : names.join(', '),
    ),
  );
  out.push(chk('Within limits: ' + LIMITS.tables + ' tables', sc.tables.length <= LIMITS.tables, sc.tables.length + ' tables'));
  const bad: string[] = [];
  sc.tables.forEach((t) =>
    t.columns.forEach((c) => {
      if (c.type === 'ref' && !names.includes(c.ref as string))
        bad.push(t.name + '.' + c.name + ' points to ' + (c.ref || 'nothing') + ', which does not exist');
      if (c.type === 'select' && !(c.options || []).length) bad.push(t.name + '.' + c.name + ' is a choice with no options');
    }),
  );
  out.push(chk('Every link points to a table that exists', !bad.length, bad.join('; ') || 'all links resolve'));
  const noTitle = sc.tables.filter((t) => !t.title || !t.columns.length).map((t) => t.name);
  out.push(chk('Every table has columns and a title column', !noTitle.length, noTitle.length ? 'fix: ' + noTitle.join(', ') : ''));
  const pt = sc.tables.find((t) => t.name === brief.process.entity);
  const st = pt && pt.columns.find((c) => c.name === 'status');
  const stOptions = (st && st.options) || [];
  const same =
    st &&
    st.type === 'select' &&
    stOptions.length === brief.process.states.length &&
    brief.process.states.every((s) => stOptions.includes(s));
  out.push(
    chk(
      'The status column matches the process in the brief',
      !!same,
      same
        ? brief.process.entity + '.status: ' + stOptions.join(', ')
        : brief.process.entity + '.status must be a choice with exactly: ' + brief.process.states.join(', '),
    ),
  );
  const noUser = brief.roles.filter((r) => !sc.users.some((u) => u.role === r.id)).map((r) => r.name);
  out.push(
    chk(
      'A seeded user for every role',
      !noUser.length && sc.users.length > 0,
      noUser.length ? 'no user for ' + noUser.join(', ') : sc.users.length + ' users',
    ),
  );
  return out;
}
export const DAY_WORD: Dict<number> = {
  today: 0,
  tomorrow: 1,
  yesterday: -1,
};
/** Finds a row by text: a person by name, or a record by its title. Returns its position (1, 2, 3) or 0. */
export interface SeedLookup {
  user(name: string): number;
  ref(table: string, text: string): number;
}
export function seedValue(c: ColumnDef, v: unknown, look?: SeedLookup | null): [SqlValue, string | null] {
  // agent-written seed values use day offsets and row positions; returns [value, problem]
  if (v == null || v === '') return [null, c.required ? 'is required' : null];
  switch (c.type) {
    case 'date': {
      if (typeof v === 'number') return [dayOffset(Math.round(v)), null];
      const s = String(v).trim();
      if (s.toLowerCase() in DAY_WORD) return [dayOffset(DAY_WORD[s.toLowerCase()]), null];
      if (/^[+-]?\d{1,4}$/.test(s)) return [dayOffset(parseInt(s, 10)), null];
      const m = /^\d{4}-\d{2}-\d{2}/.exec(s);
      return m ? [m[0], null] : [null, 'is not a date'];
    }
    case 'datetime': {
      if (typeof v === 'number') return [dayOffset(Math.round(v)) + 'T09:00', null];
      const s = String(v).trim();
      let m = /^(today|tomorrow|yesterday)?\s*(\d{1,2}):(\d{2})$/i.exec(s);
      if (m) return [dayOffset(DAY_WORD[(m[1] || 'today').toLowerCase()]) + 'T' + pad2(+m[2]) + ':' + m[3], null];
      m = /^([+-]?\d{1,4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(s);
      if (m) return [dayOffset(parseInt(m[1], 10)) + 'T' + pad2(+(m[2] || 9)) + ':' + (m[3] || '00'), null];
      m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(s);
      if (m) return [m[1] + 'T' + m[2] + ':' + m[3], null];
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? [s + 'T09:00', null] : [null, 'is not a date and time'];
    }
    case 'bool':
      return [v === true || v === 1 || /^(true|yes|1)$/i.test(String(v)) ? 1 : 0, null];
    case 'number':
    case 'money': {
      const x = Number(v);
      return isNaN(x) ? [null, 'is not a number'] : [x, null];
    }
    case 'select': {
      const s = snake(v);
      const options = c.options || [];
      return options.includes(s) ? [s, null] : [null, '"' + v + '" is not one of ' + options.join(', ')];
    }
    case 'ref':
    case 'user': {
      let x = parseInt(String(v), 10);
      if (!(x > 0) && look && typeof v === 'string') x = c.type === 'user' ? look.user(v) : look.ref(c.ref as string, v);
      return x > 0 ? [x, null] : [null, 'must be a row position (1, 2, 3)'];
    }
    default:
      return [String(v), null];
  }
}
export function insertSeed(
  appId: string,
  tables: TableDef[],
  rowsOf: Dict<unknown>,
  problems: string[],
  by: string,
  users: unknown,
  lenient?: boolean,
) {
  let total = 0;
  const same = (a: unknown, b: unknown) =>
    String(a == null ? '' : a)
      .trim()
      .toLowerCase() === String(b).trim().toLowerCase();
  const look: SeedLookup = {
    user: (name) => arr<SeedUser>(users).findIndex((u) => same(u.name, name)) + 1,
    ref: (tn, text) => {
      const t = tables.find((x) => x.name === tn);
      return t ? arr<Row>(rowsOf[tn]).findIndex((r) => r && same(r[t.title], text)) + 1 : 0;
    },
  };
  for (const t of topoOrder(tables)) {
    const cols = t.columns,
      rows = arr<Row | null>(rowsOf[t.name]),
      list: SqlValue[][] = [];
    rows.forEach((row, i) => {
      let bad = false;
      const vals = cols.map((c) => {
        const r = seedValue(c, row ? row[c.name] : null, look);
        if (r[1]) {
          bad = true;
          problems.push(t.name + ' row ' + (i + 1) + ': ' + c.name + ' ' + r[1]);
        }
        return r[0];
      });
      const own = t.owner
        ? vals[cols.findIndex((c) => c.name === t.owner)]
        : row && Number(row._by) > 0 && Number(row._by) <= arr(users).length
          ? Math.round(Number(row._by))
          : null;
      if (!(lenient && bad)) list.push(vals.concat([own, dayOffset(-((rows.length - i) % 9)) + 'T09:00']));
    });
    if (!list.length) continue;
    if (lenient) {
      const text =
        'INSERT INTO ' +
        qi(t.name) +
        ' (' +
        cols
          .map((c) => qi(c.name))
          .concat(['"created_by"', '"created_at"'])
          .join(', ') +
        ') VALUES (' +
        cols
          .map(() => '?')
          .concat(['?', '?'])
          .join(', ') +
        ')';
      list.forEach((p) => {
        try {
          total += sqlMany(appId, text, [p], by);
        } catch (e) {
          problems.push(t.name + ' ' + (e as Error).message);
        }
      });
      continue;
    }
    try {
      total += sqlMany(
        appId,
        'INSERT INTO ' +
          qi(t.name) +
          ' (' +
          cols
            .map((c) => qi(c.name))
            .concat(['"created_by"', '"created_at"'])
            .join(', ') +
          ') VALUES (' +
          cols
            .map(() => '?')
            .concat(['?', '?'])
            .join(', ') +
          ')',
        list,
        by,
      );
    } catch (e) {
      problems.push(t.name + ' ' + (e as Error).message);
    }
  }
  return total;
}
export function buildDatabase(app: AppRecord, sc: SchemaDraft, ctx: ToolContext) {
  // creates the SQLite file from the table definitions; every result is a check
  const out: Check[] = [],
    id = app.id;
  dbDrop(id);
  const ddl = SYS_SQL.concat(sc.tables.map(createTableSQL));
  const r1 = toolCall(
    ctx,
    'apply_schema',
    {
      statements: ddl.length,
      tables: sc.tables.map((t) => t.name),
    },
    () => {
      ddl.forEach((s) => sqlRun(id, s, null, 'database'));
      return {
        created: ddl.length,
      };
    },
  );
  out.push(chk('Tables created in SQLite', r1.ok, r1.ok ? ddl.length + ' CREATE TABLE statements ran' : r1.result.error));
  if (!r1.ok) return out;
  let total = 0;
  const rowsOf: Dict<Row[]> = {};
  sc.tables.forEach((t) => {
    rowsOf[t.name] = t.rows;
  });
  const r2 = toolCall(
    ctx,
    'run_sql',
    {
      purpose: 'seed data',
      users: sc.users.length,
      rows: sc.tables.map((t) => t.name + ': ' + t.rows.length),
    },
    () => {
      const problems: string[] = [];
      sqlMany(
        id,
        'INSERT INTO "users" ("name", "username", "password", "role") VALUES (?, ?, ?, ?)',
        sc.users.map((u) => [u.name, u.username, u.password, u.role]),
        'database',
      );
      total = insertSeed(id, sc.tables, rowsOf, problems, 'database', sc.users, sc.repaired);
      if (problems.length && !sc.repaired) throw new Error(problems.slice(0, 5).join('; '));
      return {
        users: sc.users.length,
        rows: total,
        skipped: problems.length,
      };
    },
  );
  out.push(
    chk(
      'Seed rows inserted',
      r2.ok,
      r2.ok
        ? total +
            ' rows in ' +
            sc.tables.length +
            ' tables, ' +
            sc.users.length +
            ' users' +
            (r2.result.skipped ? ', ' + r2.result.skipped + ' unusable rows left out' : '')
        : r2.result.error,
    ),
  );
  out.push(checkLinks(app, ctx));
  return out;
}
export function checkLinks(app: AppRecord, ctx: ToolContext) {
  const r = toolCall(
    ctx,
    'check_sql',
    {
      pragma: ['foreign_key_check', 'integrity_check'],
    },
    () => {
      const fk = sqlRows(app.id, 'PRAGMA foreign_key_check', null, 'check');
      const ic = sqlRows(app.id, 'PRAGMA integrity_check', null, 'check');
      if (fk.length)
        throw new Error(fk.length + ' rows point to records that do not exist (first: ' + fk[0].table + ' row ' + fk[0].rowid + ')');
      return {
        foreign_keys: 'ok',
        integrity: ic[0] ? Object.values(ic[0])[0] : 'ok',
      };
    },
  );
  return chk('Links between rows are consistent', r.ok, r.ok ? 'foreign_key_check and integrity_check passed' : r.result.error);
}
export function reseed(app: AppRecord) {
  // "Reset data": empty every table and put the original seed rows back
  const def = app.def,
    id = app.id;
  const order = topoOrder(def.tables).reverse();
  const problems: string[] = [];
  sqlRun(id, 'DELETE FROM "activity"', null, 'reset');
  order.forEach((t) => sqlRun(id, 'DELETE FROM ' + qi(t.name), null, 'reset'));
  sqlRun(id, 'DELETE FROM sqlite_sequence WHERE name <> ?', ['users'], 'reset');
  const n = insertSeed(id, def.tables, (app.seed && app.seed.rows) || {}, problems, 'reset', def.users);
  return {
    rows: n,
    problems,
  };
}

/* ---------- station 3: workflow, access rules, endpoints ---------- */
/** What the Backend agent hands over, once normalised. */
export interface BackendDraft {
  process: Process;
  access: Dict<Dict<Permission>>;
  team: ReturnType<typeof normTeam>;
}
export function normBackend(o: Untrusted, def: BriefedDef): BackendDraft {
  o = o || {};
  const b = def.brief,
    roleIds = b.roles.map((r) => r.id),
    st = o.status || o.workflow || o.process || {};
  const table = tableOf(def, snake(st.table)) ? snake(st.table) : b.process.entity;
  const t = tableOf(def, table);
  const column = t && colOf(t, snake(st.column)) ? snake(st.column) : 'status';
  const states: ProcessState[] = arr(st.states)
    .map((s: Untrusted): { id: string; label?: string; tone?: Tone } =>
      typeof s === 'string'
        ? {
            id: snake(s),
          }
        : {
            id: snake(s && (s.id || s.label)),
            label: str(s && s.label),
            tone: s && s.tone,
          },
    )
    .filter((s) => s.id)
    .map((s) => ({
      id: s.id,
      label: s.label || label(s.id),
      tone: s.tone && TONES.includes(s.tone) ? s.tone : 'neutral',
    }));
  const list1 = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]),
    yes = (v: unknown) => v === true || v === 'true' || v === 'yes';
  const transitions: Transition[] = arr(st.transitions)
    .map((x: Untrusted) => {
      x = x || {};
      const set: Dict<unknown> = {};
      if (x.set && typeof x.set === 'object')
        Object.keys(x.set).forEach((k) => {
          if (t && colOf(t, snake(k))) set[snake(k)] = x.set[k];
        });
      return {
        id: snake(x.id || x.label),
        label: str(x.label) || label(x.id),
        from: list1(x.from).map(snake).filter(Boolean),
        to: snake(x.to),
        roles: list1(x.roles)
          .map(snake)
          .filter((r) => roleIds.includes(r)),
        set,
      };
    })
    .filter((x) => x.id);
  const access: Dict<Dict<Permission>> = {};
  def.tables.forEach((tb) => {
    access[tb.name] = {};
    roleIds.forEach((r) => {
      access[tb.name][r] = {
        list: 'none',
        create: false,
        update: 'none',
        delete: false,
      };
    });
  });
  const sc = (v: unknown): Scope => (yes(v) || v === 'all' ? 'all' : v === 'own' ? 'own' : 'none');
  let rules: Untrusted = o.access;
  if (rules && !Array.isArray(rules) && typeof rules === 'object') {
    const flat: Untrusted[] = [];
    Object.keys(rules).forEach((tn) => {
      const v = rules[tn];
      if (v && typeof v === 'object')
        Object.keys(v).forEach((r) => {
          if (v[r] && typeof v[r] === 'object')
            flat.push(
              Object.assign(
                {
                  table: tn,
                  role: r,
                },
                v[r],
              ),
            );
        });
    });
    rules = flat;
  }
  arr(rules).forEach((a: Untrusted) => {
    a = a || {};
    const tn = snake(a.table),
      r = snake(a.role);
    if (!access[tn] || !roleIds.includes(r)) return;
    access[tn][r] = {
      list: sc(a.list),
      create: yes(a.create),
      update: sc(a.update),
      delete: yes(a.delete),
    };
  });
  const P: Process = {
    table,
    column,
    states,
    initial: snake(st.initial) || (states[0] ? states[0].id : ''),
    transitions,
  };
  return {
    process: P,
    access,
    team: normTeam(o.team, def, P),
  };
}
export function checkBackendShape(def: BriefedDef, be: Pick<BackendDraft, 'process' | 'access'>) {
  const P = be.process,
    t = tableOf(def, P.table),
    col = colOf(t, P.column),
    ids = P.states.map((s) => s.id),
    out: Check[] = [];
  const colOptions = (col && col.options) || [];
  const same = col && col.type === 'select' && ids.length === colOptions.length && colOptions.every((o) => ids.includes(o));
  out.push(
    chk(
      'The workflow uses the states stored in the table',
      !!same && ids.includes(P.initial),
      same
        ? P.table + '.' + P.column + ' starts at ' + P.initial
        : 'states must be exactly: ' + (col && col.options ? col.options.join(', ') : 'the status options'),
    ),
  );
  const badT = P.transitions
    .filter((x) => !x.from.length || x.from.some((f) => !ids.includes(f)) || !ids.includes(x.to) || !x.roles.length)
    .map((x) => x.id);
  out.push(
    chk(
      'Every transition moves between known states for a known role',
      P.transitions.length > 0 && !badT.length,
      badT.length ? 'fix: ' + badT.join(', ') : P.transitions.length + ' transitions',
    ),
  );
  const seen = new Set([P.initial]);
  let grew = true;
  while (grew) {
    grew = false;
    P.transitions.forEach((x) => {
      if (x.from.some((f) => seen.has(f)) && !seen.has(x.to)) {
        seen.add(x.to);
        grew = true;
      }
    });
  }
  const lost = ids.filter((s) => !seen.has(s));
  out.push(
    chk('Every state can be reached from the first one', !lost.length, lost.length ? 'no path to: ' + lost.join(', ') : ids.join(' → ')),
  );
  const idle = def.brief.roles
    .filter(
      (r) =>
        !def.tables.some((tb) => {
          const a: Partial<Permission> = (be.access[tb.name] || {})[r.id] || {};
          return a.list && a.list !== 'none';
        }),
    )
    .map((r) => r.name);
  const dark = def.tables
    .filter((tb) => !def.brief.roles.some((r) => ((be.access[tb.name] || {})[r.id] || ({} as Partial<Permission>)).list !== 'none'))
    .map((tb) => tb.name);
  out.push(
    chk(
      'Every role can open something and every table has a reader',
      !idle.length && !dark.length,
      idle.length
        ? 'nothing to open for ' + idle.join(', ')
        : dark.length
          ? 'nobody can read ' + dark.join(', ')
          : def.brief.roles.length + ' roles, ' + def.tables.length + ' tables',
    ),
  );
  return out;
}
/** One endpoint of a built app's API, and which roles may call it with which scope. */
export interface Endpoint {
  id: string;
  method: string;
  path: string;
  table: string | null;
  sys?: boolean;
  open?: boolean;
  action?: string;
  tr?: string;
  roles: Dict<string>;
  sql: string;
}
export function deriveEndpoints(def: BriefedDef): Endpoint[] {
  // the endpoint list is derived from tables + access + workflow; the router below enforces it
  const roles = def.brief.roles.map((r) => r.id),
    eps: Endpoint[] = [],
    all: Dict<string> = {};
  roles.forEach((r) => {
    all[r] = 'all';
  });
  eps.push({
    id: 'auth.login',
    method: 'POST',
    path: '/api/login',
    table: null,
    sys: true,
    roles: all,
    open: true,
    sql: 'SELECT id, name, username, role FROM users WHERE username = ? AND password = ?',
  });
  eps.push({
    id: 'users.list',
    method: 'GET',
    path: '/api/users',
    table: null,
    sys: true,
    roles: all,
    sql: 'SELECT id, name, username, role FROM users ORDER BY id',
  });
  def.tables.forEach((t) => {
    const A = def.access[t.name] || {},
      own = t.owner || 'created_by',
      n = t.name;
    const pick = (f: (a: Partial<Permission>) => string | boolean | undefined) => {
      const o: Dict<string> = {};
      roles.forEach((r) => {
        const v = f(A[r] || {});
        if (v && v !== 'none') o[r] = v === true ? 'all' : v;
      });
      return o;
    };
    const scope = ' [AND ' + own + ' = :me when the rule is "own"]';
    eps.push({
      id: n + '.list',
      method: 'GET',
      path: '/api/' + n,
      table: n,
      action: 'list',
      roles: pick((a) => a.list),
      sql: 'SELECT * FROM ' + n + ' WHERE 1 = 1' + scope + ' ORDER BY id DESC',
    });
    eps.push({
      id: n + '.get',
      method: 'GET',
      path: '/api/' + n + '/:id',
      table: n,
      action: 'get',
      roles: pick((a) => a.list),
      sql: 'SELECT * FROM ' + n + ' WHERE id = :id' + scope,
    });
    eps.push({
      id: n + '.create',
      method: 'POST',
      path: '/api/' + n,
      table: n,
      action: 'create',
      roles: pick((a) => a.create),
      sql: 'INSERT INTO ' + n + ' (' + t.columns.map((c) => c.name).join(', ') + ', created_by, created_at) VALUES (…)',
    });
    eps.push({
      id: n + '.update',
      method: 'PATCH',
      path: '/api/' + n + '/:id',
      table: n,
      action: 'update',
      roles: pick((a) => a.update),
      sql: 'UPDATE ' + n + ' SET … WHERE id = :id' + scope,
    });
    eps.push({
      id: n + '.delete',
      method: 'DELETE',
      path: '/api/' + n + '/:id',
      table: n,
      action: 'delete',
      roles: pick((a) => a.delete),
      sql: 'DELETE FROM ' + n + ' WHERE id = :id',
    });
    if (def.process && def.process.table === n)
      def.process.transitions.forEach((x) => {
        const o: Dict<string> = {};
        x.roles.forEach((r) => {
          o[r] = (A[r] || {}).list === 'own' ? 'own' : 'all';
        });
        eps.push({
          id: n + '.' + x.id,
          method: 'POST',
          path: '/api/' + n + '/:id/' + x.id,
          table: n,
          action: 'transition',
          tr: x.id,
          roles: o,
          sql:
            'UPDATE ' +
            n +
            ' SET ' +
            (def.process as Process).column +
            " = '" +
            x.to +
            "' WHERE id = :id AND " +
            (def.process as Process).column +
            ' IN (' +
            x.from.map((f) => "'" + f + "'").join(', ') +
            ')',
        });
      });
  });
  return eps;
}
/** An error the API answers with: an HTTP status, and for 400 the fields that need attention. */
export type HttpError = Error & { status?: number; fields?: Dict<string> };
/** What a call to a built app's API returns. */
export interface ApiResult {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the JSON body: a row, a list of rows or { id }, by route; callers know which
  data?: any;
  error?: string;
  fields?: Dict<string>;
  ms?: number;
}
export function httpErr(status: number, message: string, fields?: Dict<string>) {
  const e: HttpError = new Error(message);
  e.status = status;
  e.fields = fields;
  return e;
}
export function apiCall(
  app: AppRecord,
  user: AppUser | null | undefined,
  method: string,
  path: string,
  body?: Dict<unknown> | null,
  src?: string,
): ApiResult {
  // the "backend": every screen of a built app goes through here
  const t0 = performance.now();
  let res: ApiResult;
  try {
    res = apiRoute(app, user, String(method).toUpperCase(), path, body || {});
  } catch (err) {
    const e = err as HttpError | null;
    res =
      e && e.status
        ? {
            status: e.status,
            error: e.message,
            fields: e.fields,
          }
        : /constraint/i.test(String(e && e.message))
          ? {
              status: 400,
              error: 'The database refused this: ' + (e as HttpError).message,
            }
          : {
              status: 500,
              error: String((e && e.message) || e),
            };
  }
  res.ms = performance.now() - t0;
  ring(
    APILOG,
    {
      t: Date.now(),
      app: app.id,
      user: user ? user.username : '-',
      role: user ? user.role : '-',
      method: String(method).toUpperCase(),
      path,
      status: res.status,
      ms: res.ms,
      src: src || 'app',
    },
    400,
  );
  return res;
}
export function logAct(app: AppRecord, user: AppUser, table: string, rowId: SqlValue, action: string, detail?: string) {
  sqlRun(app.id, 'INSERT INTO "activity" ("at", "user_id", "table_name", "row_id", "action", "detail") VALUES (?, ?, ?, ?, ?, ?)', [
    nowStamp(),
    user.id,
    table,
    rowId,
    action,
    detail || '',
  ]);
}
export function coerceField(c: ColumnDef, v: unknown): [SqlValue | undefined, string | null] {
  if (v === undefined) return [undefined, null];
  if (v === null || v === '') return [null, null];
  switch (c.type) {
    case 'date': {
      const m = /^\d{4}-\d{2}-\d{2}/.exec(String(v));
      return m ? [m[0], null] : [null, 'Use a date'];
    }
    case 'datetime': {
      const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(v));
      return m ? [m[1] + 'T' + m[2], null] : [null, 'Use a date and time'];
    }
    case 'bool':
      return [v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0, null];
    case 'number':
    case 'money': {
      const x = Number(v);
      return isNaN(x) ? [null, 'Use a number'] : [x, null];
    }
    case 'select': {
      const options = c.options || [];
      return options.includes(String(v)) ? [String(v), null] : [null, 'Pick one of: ' + options.map(label).join(', ')];
    }
    case 'ref':
    case 'user': {
      const x = parseInt(String(v), 10);
      return x > 0 ? [x, null] : [null, 'Pick one'];
    }
    default:
      return [String(v), null];
  }
}
export function readBody(app: AppRecord, t: AppTable, user: AppUser, body: Dict<unknown>, partial: boolean) {
  const def = app.def,
    P = def.process && def.process.table === t.name ? def.process : null,
    vals: Dict<SqlValue> = {},
    fields: Dict<string> = {};
  for (const c of t.columns) {
    if (P && c.name === P.column) {
      if (partial && body[c.name] !== undefined) fields[c.name] = 'Status changes go through the workflow actions';
      continue;
    }
    const r = coerceField(c, body[c.name]);
    let v = r[0];
    if (r[1]) {
      fields[c.name] = r[1];
      continue;
    }
    if (v === undefined) {
      if (partial) continue;
      v = null;
    }
    if (v == null && !partial && c.name === t.owner && (!c.role || c.role === user.role)) v = user.id;
    if (v == null && c.required) {
      fields[c.name] = 'Required';
      continue;
    }
    if (v != null && c.type === 'ref' && !sqlRows(app.id, 'SELECT 1 AS ok FROM ' + qi(c.ref) + ' WHERE "id" = ?', [v])[0]) {
      fields[c.name] = 'That record does not exist';
      continue;
    }
    if (v != null && c.type === 'user') {
      const u = sqlRows(app.id, 'SELECT role FROM "users" WHERE "id" = ?', [v])[0];
      if (!u) {
        fields[c.name] = 'That person does not exist';
        continue;
      }
      if (c.role && u.role !== c.role) {
        fields[c.name] = 'Pick a ' + roleName(def, c.role);
        continue;
      }
    }
    vals[c.name] = v;
  }
  return {
    vals,
    fields,
  };
}
export function apiRoute(app: AppRecord, user: AppUser | null | undefined, method: string, path: string, body: Dict<unknown>): ApiResult {
  const def = app.def,
    id0 = app.id,
    seg = path
      .replace(/^\/api\/?/, '')
      .split('?')[0]
      .split('/')
      .filter(Boolean);
  if (seg[0] === 'login' && method === 'POST') {
    const u = sqlRows(id0, 'SELECT id, name, username, role FROM "users" WHERE username = ? AND password = ?', [
      str(body.username).toLowerCase(),
      String(body.password || ''),
    ])[0];
    if (!u) throw httpErr(401, 'Wrong username or password');
    return {
      status: 200,
      data: u,
    };
  }
  if (!user) throw httpErr(401, 'Sign in first');
  if (seg[0] === 'users' && method === 'GET')
    return {
      status: 200,
      data: sqlRows(id0, 'SELECT id, name, username, role FROM "users" ORDER BY id'),
    };
  const t = tableOf(def, seg[0]);
  if (!t) throw httpErr(404, 'No such resource: /' + (seg[0] || ''));
  const acc = accOf(def, user.role, t.name),
    own = t.owner || 'created_by',
    T = qi(t.name),
    P = def.process && def.process.table === t.name ? def.process : null;
  const deny = (verb: string) => httpErr(403, roleName(def, user.role) + ' cannot ' + verb + ' ' + t.label.toLowerCase());
  const id = seg[1] && /^\d+$/.test(seg[1]) ? +seg[1] : null;
  const getRow = (scope?: string) =>
    sqlRows(
      id0,
      'SELECT * FROM ' + T + ' WHERE "id" = ?' + (scope === 'own' ? ' AND ' + qi(own) + ' = ?' : ''),
      scope === 'own' ? [id, user.id] : [id],
    )[0];
  const filt = (src: unknown) => {
    const w = ['1 = 1'],
      p: SqlValue[] = [];
    if (acc.list === 'own') {
      w.push(qi(own) + ' = ?');
      p.push(user.id);
    }
    if (src && typeof src === 'object')
      Object.entries(src as Dict<SqlValue>).forEach(([k, v]) => {
        if ((colOf(t, k) || k === 'created_by') && v != null && v !== '') {
          w.push(qi(k) + ' = ?');
          p.push(v);
        }
      });
    return {
      w: w.join(' AND '),
      p,
    };
  };
  if (seg[1] === 'stats') {
    if (method !== 'GET') throw httpErr(405, 'Use GET');
    if (acc.list === 'none') throw deny('see');
    const g = typeof body.group === 'string' && colOf(t, body.group) ? body.group : null,
      sm = typeof body.sum === 'string' && colOf(t, body.sum) ? body.sum : null,
      f = filt(body.where);
    return {
      status: 200,
      data: sqlRows(
        id0,
        'SELECT ' +
          (g ? qi(g) + ' AS k, ' : '') +
          'COUNT(*) AS n' +
          (sm ? ', COALESCE(SUM(' + qi(sm) + '), 0) AS total' : '') +
          ' FROM ' +
          T +
          ' WHERE ' +
          f.w +
          (g ? ' GROUP BY ' + qi(g) + ' ORDER BY n DESC' : ''),
        f.p,
      ),
    };
  }
  if (method === 'GET' && id == null) {
    if (acc.list === 'none') throw deny('see');
    const f = filt(body.filter);
    return {
      status: 200,
      data: sqlRows(id0, 'SELECT * FROM ' + T + ' WHERE ' + f.w + ' ORDER BY "id" DESC LIMIT 500', f.p),
    };
  }
  if (method === 'GET' && id != null) {
    if (acc.list === 'none') throw deny('see');
    const row = getRow(acc.list);
    if (!row) throw httpErr(404, t.one + ' not found');
    if (seg[2] === 'activity')
      return {
        status: 200,
        data: sqlRows(
          id0,
          'SELECT a.id, a.at, a.action, a.detail, u.name AS who FROM "activity" a LEFT JOIN "users" u ON u.id = a.user_id WHERE a.table_name = ? AND a.row_id = ? ORDER BY a.id DESC LIMIT 20',
          [t.name, id],
        ),
      };
    return {
      status: 200,
      data: row,
    };
  }
  if (method === 'POST' && id == null) {
    if (!acc.create) throw deny('create');
    if (t.owner && acc.list === 'own')
      body = Object.assign({}, body, {
        [t.owner]: user.id,
      });
    const r = readBody(app, t, user, body, false);
    if (Object.keys(r.fields).length) throw httpErr(400, 'Some fields need attention', r.fields);
    if (P) r.vals[P.column] = P.initial;
    r.vals.created_by = user.id;
    r.vals.created_at = nowStamp();
    const keys = Object.keys(r.vals);
    sqlRun(
      id0,
      'INSERT INTO ' + T + ' (' + keys.map(qi).join(', ') + ') VALUES (' + keys.map(() => '?').join(', ') + ')',
      keys.map((k) => r.vals[k]),
    );
    const nid = lastId(id0);
    logAct(app, user, t.name, nid, 'created', '');
    return {
      status: 201,
      data: sqlRows(id0, 'SELECT * FROM ' + T + ' WHERE "id" = ?', [nid])[0],
    };
  }
  if (method === 'POST' && id != null && seg[2]) {
    const tr = P && P.transitions.find((x) => x.id === seg[2]);
    if (!tr) throw httpErr(404, 'No such action: ' + seg[2]);
    if (!tr.roles.includes(user.role)) throw httpErr(403, roleName(def, user.role) + ' cannot ' + tr.label.toLowerCase());
    const row = getRow(acc.list === 'own' ? 'own' : 'all');
    if (!row) throw httpErr(404, t.one + ' not found');
    const state = row[P.column] as string;
    if (!tr.from.includes(state)) throw httpErr(409, 'Cannot ' + tr.label.toLowerCase() + ' while it is ' + label(state).toLowerCase());
    const sets = [qi(P.column) + ' = ?'],
      ps: SqlValue[] = [tr.to];
    Object.keys(tr.set || {}).forEach((k) => {
      const v = tr.set[k] as SqlValue;
      sets.push(qi(k) + ' = ?');
      ps.push(v === ':me' ? user.id : v === ':today' ? dayOffset(0) : v === ':now' ? nowStamp() : v);
    });
    sqlRun(
      id0,
      'UPDATE ' + T + ' SET ' + sets.join(', ') + ' WHERE "id" = ? AND ' + qi(P.column) + ' IN (' + tr.from.map(() => '?').join(', ') + ')',
      ps.concat([id], tr.from),
    );
    logAct(app, user, t.name, id, tr.label.toLowerCase(), label(state) + ' → ' + label(tr.to));
    return {
      status: 200,
      data: getRow('all'),
    };
  }
  if (method === 'PATCH' && id != null) {
    if (acc.update === 'none') throw deny('change');
    if (!getRow(acc.update)) throw httpErr(404, t.one + ' not found');
    const r = readBody(app, t, user, body, true);
    if (Object.keys(r.fields).length) throw httpErr(400, 'Some fields need attention', r.fields);
    const keys = Object.keys(r.vals);
    if (!keys.length) throw httpErr(400, 'Nothing to change');
    sqlRun(
      id0,
      'UPDATE ' + T + ' SET ' + keys.map((k) => qi(k) + ' = ?').join(', ') + ' WHERE "id" = ?',
      keys.map((k) => r.vals[k]).concat([id]),
    );
    logAct(app, user, t.name, id, 'updated', keys.map(label).join(', '));
    return {
      status: 200,
      data: getRow('all'),
    };
  }
  if (method === 'DELETE' && id != null) {
    if (!acc.delete) throw deny('delete');
    if (!getRow(acc.list === 'own' ? 'own' : 'all')) throw httpErr(404, t.one + ' not found');
    try {
      sqlRun(id0, 'DELETE FROM ' + T + ' WHERE "id" = ?', [id]);
    } catch {
      throw httpErr(409, 'Other records still point to this ' + t.one.toLowerCase() + '. Remove those first.');
    }
    logAct(app, user, t.name, id, 'deleted', '');
    return {
      status: 200,
      data: {
        id,
      },
    };
  }
  throw httpErr(405, 'Method not allowed');
}
/** One call of the permission matrix: an endpoint called as a role, and whether it behaved as declared. */
export interface MatrixCall {
  ep: string;
  role: string;
  allowed: boolean;
  status: number;
  ok: boolean;
}
export function testMatrix(app: AppRecord & { def: BriefedDef }) {
  // call every endpoint as every role inside a savepoint, then roll back
  const def = app.def,
    eps = deriveEndpoints(def).filter((e) => !e.sys),
    users = appUsers(app),
    out: MatrixCall[] = [];
  dbSavepoint(app.id, 'mx');
  try {
    eps.forEach((ep) =>
      def.brief.roles.forEach((role) => {
        const u = users.find((x) => x.role === role.id);
        if (!u) return;
        const allowed = !!ep.roles[role.id],
          res = apiCall(app, u, ep.method, ep.path.replace(':id', '1'), {}, 'check');
        const ok = allowed ? ![401, 403, 405, 500].includes(res.status) : res.status === 403;
        out.push({
          ep: ep.id,
          role: role.id,
          allowed,
          status: res.status,
          ok,
        });
      }),
    );
  } finally {
    dbRollback(app.id, 'mx');
  }
  return out;
}
export function checkBackendLive(app: AppRecord & { def: BriefedDef }, ctx: ToolContext) {
  const def = app.def;
  let mx: MatrixCall[] = [];
  const r = toolCall(
    ctx,
    'call_as',
    {
      endpoints: deriveEndpoints(def).length - 2,
      roles: def.brief.roles.map((x) => x.id),
    },
    () => {
      mx = testMatrix(app);
      const bad = mx.filter((m) => !m.ok);
      if (bad.length)
        throw new Error(
          bad
            .slice(0, 3)
            .map(
              (m) => m.ep + ' as ' + m.role + ' returned ' + m.status + (m.allowed ? ' but should be allowed' : ' but should be refused'),
            )
            .join('; '),
        );
      return {
        calls: mx.length,
        refused: mx.filter((m) => !m.allowed).length,
      };
    },
  );
  const matrix = (app.matrix = {
    at: Date.now(),
    calls: mx.length,
    refused: mx.filter((m) => !m.allowed).length,
    failed: mx.filter((m) => !m.ok).map((m) => m.ep + '|' + m.role),
  });
  const out = [
    chk(
      'Permission matrix: every call behaved as declared',
      r.ok,
      r.ok ? mx.length + ' calls as ' + def.brief.roles.length + ' roles, ' + matrix.refused + ' refused with 403' : r.result.error,
    ),
  ];
  const users = appUsers(app),
    leaks: string[] = [];
  let n = 0;
  def.tables.forEach((t) =>
    def.brief.roles.forEach((role) => {
      if (accOf(def, role.id, t.name).list !== 'own') return;
      const u = users.find((x) => x.role === role.id);
      if (!u) return;
      n++;
      const res = apiCall(app, u, 'GET', '/api/' + t.name, {}, 'check');
      if (res.status !== 200 || res.data.some((row: Row) => row[t.owner || 'created_by'] !== u.id)) leaks.push(t.name + ' as ' + role.id);
    }),
  );
  out.push(
    chk(
      '"Own" rules return only the signed-in user\'s rows',
      !leaks.length,
      leaks.length ? 'leak in ' + leaks.join(', ') : n ? n + ' own-scope lists checked' : 'no own-scope rules',
    ),
  );
  return out;
}

/* ---------- station 4: screens, layout, tour ---------- */
export function renderTest(app: AppRecord) {
  // mount every screen for every role it is meant for, off-screen
  const users = appUsers(app),
    fails: string[] = [],
    host = document.createElement('div');
  let n = 0;
  app.def.screens.forEach((scr) =>
    scr.roles.forEach((rid) => {
      const u = users.find((x) => x.role === rid);
      if (!u) return;
      n++;
      try {
        render(
          <AppPane
            app={app}
            pane={{
              ...newPane(9),
              uid: u.id,
              screen: scr.id,
              test: true,
            }}
          />,
          host,
        );
        if (!host.querySelector('.app-main')) throw new Error('nothing rendered');
      } catch (e) {
        fails.push(scr.name + ' as ' + roleName(app.def, rid) + ': ' + errText(e));
      }
    }),
  );
  try {
    render(null, host);
  } catch {}
  return chk(
    'Every screen mounts for every role that may open it',
    !fails.length,
    fails.length ? fails.slice(0, 3).join('; ') : n + ' screen and role pairs mounted',
  );
}

/* ---------- station 5: the tour, played as an acceptance test ---------- */
export function tourValues(app: AppRecord, t: AppTable, values: Dict<unknown> | null | undefined) {
  const same = (a: unknown, b: unknown) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase(),
    out: Dict<SqlValue> = {};
  const look: SeedLookup = {
    user: (name) =>
      (
        appUsers(app).find((u) => same(u.name, name)) || {
          id: 0,
        }
      ).id,
    ref: (tn, text) => {
      const rt = tableOf(app.def, tn);
      return rt
        ? ((
            sqlPeek(app.id, 'SELECT id FROM ' + qi(tn) + ' WHERE ' + qi(rt.title) + ' = ? LIMIT 1', [String(text)])[0] || {
              id: 0,
            }
          ).id as number)
        : 0;
    },
  };
  t.columns.forEach((c) => {
    if (values && values[c.name] !== undefined) {
      const r = seedValue(c, values[c.name], look);
      if (r[0] != null) out[c.name] = r[0];
    }
  });
  return out;
}
/** What the tour remembers between steps: the last record each table got, and the last record overall. */
export interface TourState {
  rows: Dict<number>;
  last: { table: string; id: number } | null;
}
/** The outcome of one tour step. */
export interface TourResult {
  ok?: boolean;
  detail?: string;
  user?: AppUser;
  screen?: string | null;
  rec?: { table: string; id: number } | null;
}
export function tourExec(app: AppRecord, st: TourState, step: TourStep): TourResult {
  // one step against the real endpoints; the player and the headless test share this
  const def = app.def,
    users = appUsers(app);
  // a model may name the person by username, full name or first name: any of them picks that person
  const who = (step.user || '').trim().toLowerCase(),
    named = (x: AppUser) => x.username === who || x.name.toLowerCase() === who || x.name.toLowerCase().split(' ')[0] === who,
    u =
      (who && (users.find((x) => x.username === who) || users.find((x) => x.role === step.role && named(x)) || users.find(named))) ||
      users.find((x) => x.role === step.role);
  if (!u)
    return {
      ok: false,
      detail: 'No user with the role ' + step.role,
    };
  const tn = step.table || (st.last && st.last.table) || (def.process && def.process.table),
    t = tableOf(def, tn);
  const scr = step.screen
    ? def.screens.find((s) => s.name.toLowerCase() === String(step.screen).toLowerCase() && s.roles.includes(u.role))
    : def.screens.find((s) => s.table === tn && (s.type === 'table' || s.type === 'board') && s.roles.includes(u.role)) ||
      def.screens.find((s) => s.table === tn && s.type !== 'form' && s.roles.includes(u.role));
  const out: TourResult = {
      user: u,
      screen: scr ? scr.id : null,
      rec: null,
    },
    fail = (d: string) =>
      Object.assign(out, {
        ok: false,
        detail: d,
      }),
    pass = (d: string) =>
      Object.assign(out, {
        ok: true,
        detail: d,
      });
  if (step.do === 'open') {
    if (!scr) return fail('No screen called "' + step.screen + '" for ' + roleName(def, u.role));
    if (scr.type === 'dashboard' || scr.type === 'form' || scr.type === 'agents') return pass(u.name + ' opened ' + scr.name);
    const r = apiCall(app, u, 'GET', '/api/' + scr.table, {}, 'tour');
    return r.status === 200 ? pass(u.name + ' opened ' + scr.name + ' (' + r.data.length + ' rows)') : fail(r.status + ' ' + r.error);
  }
  if (!t) return fail('No table called ' + tn);
  const id = st.rows[t.name];
  if (step.do === 'create') {
    const r = apiCall(app, u, 'POST', '/api/' + tn, tourValues(app, t, step.values), 'tour');
    if (r.status !== 201)
      return fail(
        r.status +
          ' ' +
          r.error +
          (r.fields
            ? ' (' +
              Object.entries(r.fields)
                .map(([k, v]) => k + ': ' + v)
                .join(', ') +
              ')'
            : ''),
      );
    st.rows[t.name] = r.data.id;
    st.last = {
      table: t.name,
      id: r.data.id,
    };
    out.rec = st.last;
    return pass('201 Created · ' + t.one + ' #' + r.data.id);
  }
  if (step.do === 'invalid') {
    const r = apiCall(app, u, 'POST', '/api/' + tn, tourValues(app, t, step.values), 'tour');
    return r.status === 400
      ? pass('400 · ' + r.error + (r.fields ? ' (' + Object.keys(r.fields).join(', ') + ')' : ''))
      : fail('Expected it to be refused as incomplete, got ' + r.status + (r.status === 201 ? ' Created' : ' ' + str(r.error)));
  }
  if (step.do === 'denied') {
    const act = step.action || 'create',
      rid = id || 1;
    const call =
      act === 'create'
        ? ['POST', '/api/' + tn]
        : act === 'update'
          ? ['PATCH', '/api/' + tn + '/' + rid]
          : act === 'delete'
            ? ['DELETE', '/api/' + tn + '/' + rid]
            : act === 'list'
              ? ['GET', '/api/' + tn]
              : ['POST', '/api/' + tn + '/' + rid + '/' + act];
    const r = apiCall(app, u, call[0], call[1], {}, 'tour');
    if (r.status === 403) return pass('403 Forbidden · ' + r.error);
    // a transition the workflow does not allow from the record's state is refused too, with 409
    if (r.status === 409 && call[0] === 'POST' && act !== 'create') return pass('409 Conflict · ' + r.error);
    // a record this person may not even see is refused as not found; that counts, as long as the record really exists
    if (
      r.status === 404 &&
      act !== 'create' &&
      act !== 'list' &&
      sqlPeek(app.id, 'SELECT id FROM ' + qi(tn) + ' WHERE id = ?', [rid]).length
    )
      return pass('404 · hidden from ' + roleName(def, u.role).toLowerCase());
    return fail(
      'Expected a refusal, got ' +
        r.status +
        (r.status === 400
          ? ': ' +
            roleName(def, u.role) +
            ' is allowed to ' +
            (act === 'create' ? 'create' : act) +
            ' ' +
            t.label.toLowerCase() +
            '; only the empty test values were refused'
          : ''),
    );
  }
  if (!id && step.do === 'hidden') {
    // nothing made in this case: "cannot see" then means the whole table is closed to this person
    const r = apiCall(app, u, 'GET', '/api/' + tn, {}, 'tour'),
      stored = sqlPeek(app.id, 'SELECT COUNT(*) AS n FROM ' + qi(tn))[0]?.n || 0;
    if (r.status === 403) return pass('403 Forbidden · ' + u.name + ' cannot see any ' + t.label.toLowerCase());
    if (r.status === 200 && !r.data.length && stored)
      return pass('200 OK · ' + u.name + ' sees none of the ' + stored + ' ' + t.label.toLowerCase());
  }
  if (!id) return fail('Nothing was created earlier in the tour for ' + tn);
  out.rec = {
    table: t.name,
    id,
  };
  if (step.do === 'hidden') {
    const r = apiCall(app, u, 'GET', '/api/' + tn, {}, 'tour'),
      found = r.status === 200 && r.data.some((x: Row) => x.id === id);
    out.rec = null;
    return !found
      ? pass((r.status === 200 ? '200 OK' : r.status) + ' · ' + u.name + ' does not see ' + t.one.toLowerCase() + ' #' + id)
      : fail(u.name + ' can see ' + t.one.toLowerCase() + ' #' + id);
  }
  if (step.do === 'see') {
    const r = apiCall(app, u, 'GET', '/api/' + tn, {}, 'tour');
    const found = r.status === 200 && r.data.some((x: Row) => x.id === id);
    if (!found) out.rec = null;
    return found
      ? pass('200 OK · ' + u.name + ' sees ' + t.one.toLowerCase() + ' #' + id)
      : fail(r.status === 200 ? t.one + ' #' + id + ' is not in the list for ' + u.name : r.status + ' ' + r.error);
  }
  if (step.do === 'transition') {
    const r = apiCall(app, u, 'POST', '/api/' + tn + '/' + id + '/' + step.transition, {}, 'tour');
    return r.status === 200
      ? pass('200 OK · now ' + label(r.data[(def.process as Process).column]).toLowerCase())
      : fail(r.status + ' ' + r.error);
  }
  return fail('Unknown step');
}
export function runAcceptance(app: AppRecord, ctx: ToolContext) {
  const st: TourState = {
    rows: {},
    last: null,
  };
  let results: { ok?: boolean; detail?: string; who: string }[] = [];
  const r = toolCall(
    ctx,
    'play_tour',
    {
      steps: app.def.tour.length,
    },
    () => {
      dbSavepoint(app.id, 'acc');
      try {
        results = app.def.tour.map((step) => {
          const x = tourExec(app, st, step);
          return {
            ok: x.ok,
            detail: x.detail,
            who: x.user ? x.user.name : '',
          };
        });
      } finally {
        dbRollback(app.id, 'acc');
      }
      return {
        passed: results.filter((x) => x.ok).length,
        failed: results.filter((x) => !x.ok).length,
      };
    },
  );
  if (!r.ok)
    results = [
      {
        ok: false,
        detail: r.result.error,
        who: '',
      },
    ];
  const roles = new Set(app.def.tour.map((s) => s.role));
  const checks = [
    chk(
      'The tour has at least 3 steps and 2 roles',
      app.def.tour.length >= 3 && roles.size >= 2,
      app.def.tour.length + ' steps, ' + roles.size + ' roles',
    ),
  ];
  app.def.tour.forEach((s, i) =>
    checks.push(
      chk(i + 1 + '. ' + (s.say || s.do + ' ' + s.table), results[i] && results[i].ok, results[i] ? results[i].detail : 'not run'),
    ),
  );
  return {
    checks,
    results,
  };
}

/* ---------- safe defaults when an agent cannot pass after its retries ---------- */
export function fallbackBackend(def: BriefedDef) {
  const b = def.brief,
    roles = b.roles.map((r) => r.id),
    states = b.process.states;
  return {
    status: {
      table: b.process.entity,
      column: 'status',
      states: states.map((s) => ({
        id: s,
        label: label(s),
      })),
      initial: states[0],
      transitions: states.slice(1).map((s, i) => ({
        id: 'move_to_' + s,
        label: 'Move to ' + label(s).toLowerCase(),
        from: [states[i]],
        to: s,
        roles: roles.slice(0, 2),
      })),
    },
    access: ([] as Dict<unknown>[]).concat.apply(
      [],
      def.tables.map((t) =>
        roles.map((r, i) => ({
          table: t.name,
          role: r,
          list: 'all',
          create: i < 2,
          update: i < 2 ? 'all' : 'none',
          delete: i === roles.length - 1,
        })),
      ),
    ),
  };
}
export function fallbackUI(def: BackedDef) {
  const roles = def.brief.roles.map((r) => r.id),
    screens: { name: string; type: string; table: string; roles: string[]; group?: string; icon?: string }[] = [];
  def.tables.forEach((t) => {
    const rs = roles.filter((r) => accOf(def, r, t.name).list !== 'none');
    if (!rs.length) return;
    if (def.process.table === t.name)
      screens.push({
        name: t.label + ' board',
        type: 'board',
        table: t.name,
        roles: rs,
        group: def.process.column,
      });
    screens.push({
      name: t.label,
      type: 'table',
      table: t.name,
      roles: rs,
    });
  });
  return {
    theme: {
      accent: 'blue',
      nav: 'side',
      icon: 'apps',
    },
    screens: screens.concat(
      def.team
        ? [
            {
              name: def.team.title,
              type: 'agents',
              table: def.team.input.table,
              roles: roles.filter((r) => canRunTeam(def, r)),
              icon: 'bot',
            },
          ]
        : [],
    ),
    tour: roles.map((r) => ({
      role: r,
      do: 'open',
      screen: (screens.find((s) => s.roles.includes(r)) || { name: undefined }).name,
      say: roleName(def, r) + ' signs in and opens their first screen.',
    })),
  };
}

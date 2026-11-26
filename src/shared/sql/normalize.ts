import { COLUMN_TYPES, LIMITS, SYSTEM_COLUMNS, SYSTEM_TABLES, TYPE_ALIAS, type ColumnDef, type ColumnType, type TableDef } from './types';

/* The same small helpers the workspace uses (core.js), so a name means the same thing on both sides. */
const str = (x: unknown): string => (x == null ? '' : String(x).trim());
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

/** `snake()` in core.js: lower case, letters, digits and single underscores, no leading digit, at most 32 characters. */
export function snake(s: unknown): string {
  return str(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'n$1')
    .slice(0, 32);
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const label = (s: unknown) =>
  cap(
    String(s == null ? '' : s)
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
const singular = (s: string) => (/(ss|us|is)$/i.test(s) ? s : s.replace(/ies$/i, 'y').replace(/s$/i, ''));

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === 'object' ? (x as Obj) : {});

/**
 * Turns whatever a model returned for `tables` into the shape the workspace stores, the way `normSchema` in
 * engine.js does: names made safe, type words mapped, columns the runtime adds itself dropped, duplicates dropped,
 * at most 12 columns per table. It never throws and never invents a table. It does not cut the table list to 8,
 * so that `validateTables` can report it; pass `roleIds` to drop a `role` that does not exist.
 */
export function normalizeTables(input: unknown, opts: { roleIds?: string[]; maxRows?: number } = {}): TableDef[] {
  const roleIds = opts.roleIds;
  return arr(input)
    .map((t0) => {
      const t = obj(t0);
      const name = snake(t.name);
      const used: Record<string, 1> = {};
      const columns: ColumnDef[] = arr(t.columns)
        .map((c0) => {
          const c = obj(c0);
          const raw = String(c.type || 'text').toLowerCase();
          const type: ColumnType = (COLUMN_TYPES as readonly string[]).includes(raw) ? (raw as ColumnType) : TYPE_ALIAS[raw] || 'text';
          const col: ColumnDef = { name: snake(c.name), label: str(c.label) || label(c.name), type, required: !!c.required };
          if (type === 'ref') {
            col.ref = snake(c.ref);
            if (col.ref === 'users') {
              col.type = 'user';
              delete col.ref;
            }
          }
          if (col.type === 'select') {
            col.options = arr(c.options).map(snake).filter(Boolean);
            if (c.labels && typeof c.labels === 'object') {
              col.labels = {};
              for (const k of Object.keys(c.labels)) {
                const v = str((c.labels as Obj)[k]);
                if (col.options.includes(snake(k)) && v) col.labels[snake(k)] = v;
              }
            }
          }
          if (col.type === 'user') col.role = !roleIds || roleIds.includes(snake(c.role)) ? snake(c.role) || null : null;
          return col;
        })
        .filter((c) => c.name && !(SYSTEM_COLUMNS as readonly string[]).includes(c.name) && !used[c.name] && (used[c.name] = 1))
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
        rows: arr(t.rows).slice(0, opts.maxRows || LIMITS.rows) as Array<Record<string, unknown>>,
      } satisfies TableDef;
    })
    .filter((t) => t.name && !(SYSTEM_TABLES as readonly string[]).includes(t.name));
}

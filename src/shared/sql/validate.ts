import { COLUMN_TYPES, LIMITS, SYSTEM_COLUMNS, SYSTEM_TABLES, type Issue, type ValidationResult } from './types';

/** A name that is safe to put in SQL and in a URL: lower case letters, digits and underscores, starting with a letter. */
export const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]{0,31}$/;

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export interface ValidateOptions {
  /** Role ids of the brief. When given, a `user` column's `role` must be one of them. */
  roleIds?: string[];
  /** The brief's process: the entity table must have a required `status` choice with exactly these states. */
  process?: { entity: string; states: string[] };
  maxTables?: number;
  maxColumns?: number;
  maxRows?: number;
}

/**
 * Checks generated table definitions without changing them. Meant for the shape `normalizeTables` returns (and the
 * workspace stores): it does not accept type aliases or unsafe names, it reports them. Every message says what to
 * change, so it can go back to an agent as a repair hint. Same rules as `normSchema` and `checkSchemaShape` in
 * `src/legacy/engine.js`, with the limits of the design: 8 tables, 12 fields each.
 */
export function validateTables(input: unknown, opts: ValidateOptions = {}): ValidationResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const err = (code: string, path: string, message: string) => errors.push({ severity: 'error', code, path, message });
  const warn = (code: string, path: string, message: string) => warnings.push({ severity: 'warning', code, path, message });
  const maxTables = opts.maxTables ?? LIMITS.tables;
  const maxCols = opts.maxColumns ?? LIMITS.cols;
  const maxRows = opts.maxRows ?? LIMITS.rows;

  if (!Array.isArray(input)) {
    err('not_a_list', '', 'tables must be a list of table definitions.');
    return { ok: false, errors, warnings };
  }
  if (input.length === 0) err('no_tables', '', 'There must be at least one table.');
  if (input.length > maxTables)
    err('too_many_tables', '', `There are ${input.length} tables. The most allowed is ${maxTables}. Merge or drop some.`);

  const tableNames = new Set<string>();
  for (const t of input) if (isObj(t) && typeof t.name === 'string') tableNames.add(t.name);

  const seenTables = new Set<string>();
  input.forEach((t, i) => {
    if (!isObj(t)) return err('table_not_object', `tables[${i}]`, 'Each table must be an object with a name and columns.');
    const tn = typeof t.name === 'string' ? t.name : '';
    const tp = tn || `tables[${i}]`;
    if (!tn || !SAFE_IDENTIFIER.test(tn))
      err(
        'bad_table_name',
        tp,
        `Table name "${String(t.name ?? '')}" is not safe. Use lower case letters, digits and underscores, starting with a letter, at most 32 characters.`,
      );
    else {
      if ((SYSTEM_TABLES as readonly string[]).includes(tn))
        err('reserved_table', tp, `"${tn}" is a table the app creates itself. Choose another name.`);
      if (tn.startsWith('sqlite_')) err('reserved_table', tp, `Names starting with "sqlite_" are reserved by SQLite.`);
      if (seenTables.has(tn)) err('duplicate_table', tp, `There are two tables called "${tn}".`);
      seenTables.add(tn);
    }
    if (!Array.isArray(t.columns) || t.columns.length === 0) {
      err('no_columns', tp, `Table "${tn}" needs at least one column.`);
      return;
    }
    if (t.columns.length > maxCols)
      err('too_many_columns', tp, `Table "${tn}" has ${t.columns.length} columns. The most allowed is ${maxCols}.`);

    const cols = new Map<string, Record<string, unknown>>();
    t.columns.forEach((c, j) => {
      if (!isObj(c)) return err('column_not_object', `${tp}.columns[${j}]`, 'Each column must be an object with a name and a type.');
      const cn = typeof c.name === 'string' ? c.name : '';
      const cp = `${tp}.${cn || `columns[${j}]`}`;
      if (!cn || !SAFE_IDENTIFIER.test(cn))
        err(
          'bad_column_name',
          cp,
          `Column name "${String(c.name ?? '')}" is not safe. Use lower case letters, digits and underscores, starting with a letter, at most 32 characters.`,
        );
      else if ((SYSTEM_COLUMNS as readonly string[]).includes(cn))
        err('reserved_column', cp, `"${cn}" is added to every table by the app. Remove it from the list.`);
      else if (cols.has(cn)) err('duplicate_column', cp, `Table "${tn}" has two columns called "${cn}".`);
      if (cn) cols.set(cn, c);

      const type = c.type;
      if (typeof type !== 'string' || !(COLUMN_TYPES as readonly string[]).includes(type)) {
        err('unknown_type', cp, `Column type "${String(type)}" is not known. Use one of: ${COLUMN_TYPES.join(', ')}.`);
        return;
      }
      if (type === 'select') {
        const opts2 = c.options;
        if (!Array.isArray(opts2) || opts2.length === 0)
          err('select_without_options', cp, `"${cn}" is a choice with no options. List its options in snake_case.`);
        else {
          const bad = opts2.filter((o) => typeof o !== 'string' || !SAFE_IDENTIFIER.test(o));
          if (bad.length) err('bad_option', cp, `Options of "${cn}" must be snake_case words. Not valid: ${bad.map(String).join(', ')}.`);
          if (new Set(opts2).size !== opts2.length) warn('duplicate_option', cp, `"${cn}" lists an option twice.`);
        }
      } else if (c.options !== undefined && !(Array.isArray(c.options) && c.options.length === 0))
        warn('stray_options', cp, `"${cn}" is not a choice, so its options are ignored.`);
      if (type === 'ref') {
        const ref = c.ref;
        if (typeof ref !== 'string' || !ref)
          err('ref_without_target', cp, `"${cn}" is a link but does not say which table it points to. Set "ref" to a table name.`);
        else if (ref === 'users') err('ref_to_users', cp, `"${cn}" points to users. Use the type "user" for a link to a person.`);
        else if (!tableNames.has(ref))
          err(
            'ref_missing_table',
            cp,
            `"${cn}" points to "${ref}", which is not one of the tables (${[...tableNames].join(', ') || 'none'}).`,
          );
      } else if (c.ref) warn('stray_ref', cp, `"${cn}" is not a link, so its "ref" is ignored.`);
      if (type === 'user' && c.role != null && c.role !== '' && opts.roleIds && !opts.roleIds.includes(String(c.role))) {
        err(
          'unknown_role',
          cp,
          `"${cn}" is limited to the role "${String(c.role)}", which the brief does not have (${opts.roleIds.join(', ')}).`,
        );
      }
    });

    const title = typeof t.title === 'string' ? t.title : '';
    if (!title || !cols.has(title))
      err('bad_title', tp, `Table "${tn}" must name one of its columns as "title" (the column shown as the record's name).`);
    if (t.owner != null && t.owner !== '') {
      const o = cols.get(String(t.owner));
      if (!o || o.type !== 'user') err('bad_owner', tp, `"owner" of "${tn}" must be one of its "user" columns, or null.`);
    }
    if (Array.isArray(t.rows) && t.rows.length > maxRows)
      warn('too_many_rows', tp, `Table "${tn}" has ${t.rows.length} seed rows. Only the first ${maxRows} are kept.`);
  });

  // links that form a loop (other than a table pointing at itself) cannot be filled in order
  const edges = new Map<string, string[]>();
  for (const t of input) {
    if (!isObj(t) || typeof t.name !== 'string' || !Array.isArray(t.columns)) continue;
    const to = (t.columns as unknown[])
      .filter(
        (c): c is Record<string, unknown> =>
          isObj(c) && c.type === 'ref' && typeof c.ref === 'string' && c.ref !== t.name && tableNames.has(c.ref),
      )
      .map((c) => c.ref as string);
    edges.set(t.name, to);
  }
  const state = new Map<string, 1 | 2>();
  const looped = new Set<string>();
  const walk = (n: string, stack: string[]) => {
    state.set(n, 1);
    for (const m of edges.get(n) || []) {
      if (state.get(m) === 1)
        stack
          .slice(stack.indexOf(m))
          .concat(m)
          .forEach((x) => looped.add(x));
      else if (!state.has(m)) walk(m, stack.concat(m));
    }
    state.set(n, 2);
  };
  for (const n of edges.keys()) if (!state.has(n)) walk(n, [n]);
  if (looped.size)
    warn(
      'link_cycle',
      '',
      `These tables point at each other in a circle: ${[...looped].join(', ')}. Seed rows cannot be added in order. Break the circle.`,
    );

  if (opts.process) {
    const { entity, states } = opts.process;
    const pt = input.find((t) => isObj(t) && t.name === entity);
    if (!pt) err('process_entity_missing', entity, `The process runs on "${entity}", but there is no table with that name.`);
    else {
      const st = isObj(pt) && Array.isArray(pt.columns) ? (pt.columns as unknown[]).find((c) => isObj(c) && c.name === 'status') : null;
      const same =
        isObj(st) &&
        st.type === 'select' &&
        Array.isArray(st.options) &&
        st.options.length === states.length &&
        states.every((s) => (st.options as unknown[]).includes(s));
      if (!same)
        err('process_status_mismatch', `${entity}.status`, `${entity}.status must be a choice with exactly: ${states.join(', ')}.`);
      else if (isObj(st) && !st.required) warn('process_status_optional', `${entity}.status`, `${entity}.status should be required.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** The errors as lines of text, for a repair prompt. */
export const issueLines = (r: ValidationResult): string[] => r.errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message));

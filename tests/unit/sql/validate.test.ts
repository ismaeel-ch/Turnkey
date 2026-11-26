import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { LIMITS, issueLines, normalizeTables, schemaSql, snake, validateTables, type TableDef } from '@/shared/sql';
import { savedBuilds } from './saved-builds';

const col = (name: string, type: string, extra: Record<string, unknown> = {}) => ({ name, type, ...extra });
const table = (name: string, columns: unknown[], extra: Record<string, unknown> = {}) => ({
  name,
  title: (columns[0] as { name: string }).name,
  columns,
  ...extra,
});
const codes = (r: { errors: Array<{ code: string }> }) => r.errors.map((e) => e.code);

describe('validateTables', () => {
  it('accepts a small correct definition', () => {
    const r = validateTables([
      table('patients', [col('full_name', 'text', { required: true })]),
      table('visits', [col('patient_id', 'ref', { ref: 'patients' }), col('status', 'select', { options: ['open', 'done'] })], {
        title: 'status',
      }),
    ]);
    expect(r).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it('rejects unsafe names', () => {
    for (const bad of ['Patients', 'drop table', 'a"b', '1abc', 'x'.repeat(33), '', 'a-b', 'naïve']) {
      expect(codes(validateTables([table(bad, [col('a', 'text')])]))).toContain('bad_table_name');
      expect(codes(validateTables([table('t', [col(bad, 'text')], { title: 'a' })]))).toContain('bad_column_name');
    }
  });

  it('rejects names the app creates itself', () => {
    expect(codes(validateTables([table('users', [col('a', 'text')])]))).toContain('reserved_table');
    expect(codes(validateTables([table('activity', [col('a', 'text')])]))).toContain('reserved_table');
    expect(codes(validateTables([table('sqlite_x', [col('a', 'text')])]))).toContain('reserved_table');
    for (const c of ['id', 'created_by', 'created_at'])
      expect(codes(validateTables([table('t', [col('a', 'text'), col(c, 'text')])]))).toContain('reserved_column');
  });

  it('rejects unknown types and tells the agent what is allowed', () => {
    const r = validateTables([table('t', [col('a', 'varchar')])]);
    expect(codes(r)).toEqual(['unknown_type']);
    expect(r.errors[0].message).toContain('text, longtext, number');
  });

  it('checks references', () => {
    expect(codes(validateTables([table('t', [col('a', 'ref', { ref: 'nowhere' })])]))).toContain('ref_missing_table');
    expect(codes(validateTables([table('t', [col('a', 'ref')])]))).toContain('ref_without_target');
    expect(codes(validateTables([table('t', [col('a', 'ref', { ref: 'users' })])]))).toContain('ref_to_users');
    expect(validateTables([table('t', [col('name', 'text'), col('parent_id', 'ref', { ref: 't' })])]).ok).toBe(true); // a table may point at itself
  });

  it('warns about links in a circle', () => {
    const r = validateTables([table('a', [col('b_id', 'ref', { ref: 'b' })]), table('b', [col('a_id', 'ref', { ref: 'a' })])]);
    expect(r.warnings.map((w) => w.code)).toContain('link_cycle');
  });

  it('checks choices', () => {
    expect(codes(validateTables([table('t', [col('s', 'select')])]))).toContain('select_without_options');
    expect(codes(validateTables([table('t', [col('s', 'select', { options: ['Not Snake', "x'; --"] })])]))).toContain('bad_option');
  });

  it('enforces the limits of the design: 8 tables, 12 fields each', () => {
    const many = Array.from({ length: LIMITS.tables + 1 }, (_, i) => table('t' + i, [col('a', 'text')]));
    expect(codes(validateTables(many))).toContain('too_many_tables');
    expect(validateTables(many.slice(0, LIMITS.tables)).ok).toBe(true);
    const wide = (n: number) =>
      table(
        'wide',
        Array.from({ length: n }, (_, i) => col('c' + i, 'text')),
      );
    expect(validateTables([wide(12)]).ok).toBe(true);
    expect(codes(validateTables([wide(13)]))).toContain('too_many_columns');
  });

  it('checks title, owner and duplicates', () => {
    expect(codes(validateTables([table('t', [col('a', 'text')], { title: 'zzz' })]))).toContain('bad_title');
    expect(codes(validateTables([table('t', [col('a', 'text')], { owner: 'a' })]))).toContain('bad_owner');
    expect(validateTables([table('t', [col('a', 'text'), col('who', 'user')], { owner: 'who' })]).ok).toBe(true);
    expect(codes(validateTables([table('t', [col('a', 'text')]), table('t', [col('a', 'text')])]))).toContain('duplicate_table');
    expect(codes(validateTables([table('t', [col('a', 'text'), col('a', 'number')])]))).toContain('duplicate_column');
  });

  it('checks roles and the process when the brief is given', () => {
    const tables = [
      table('jobs', [col('status', 'select', { options: ['new', 'done'], required: true }), col('who', 'user', { role: 'boss' })]),
    ];
    expect(codes(validateTables(tables, { roleIds: ['clerk'] }))).toContain('unknown_role');
    expect(validateTables(tables, { roleIds: ['boss'], process: { entity: 'jobs', states: ['done', 'new'] } }).ok).toBe(true);
    expect(codes(validateTables(tables, { process: { entity: 'jobs', states: ['new', 'done', 'lost'] } }))).toContain(
      'process_status_mismatch',
    );
    expect(codes(validateTables(tables, { process: { entity: 'other', states: [] } }))).toContain('process_entity_missing');
  });

  it('never throws on rubbish', () => {
    for (const v of [null, undefined, 5, 'x', {}, [null], [1], [{}], [{ name: 'a', columns: [null] }], [{ name: 'a', columns: 'x' }]]) {
      expect(() => validateTables(v)).not.toThrow();
      expect(validateTables(v).ok).toBe(false);
    }
  });

  it('turns errors into repair lines', () => {
    expect(issueLines(validateTables([table('t', [col('a', 'ref', { ref: 'x' })])]))[0]).toMatch(/^t\.a: /);
  });
});

describe('normalizeTables agrees with the workspace normaliser (normSchema)', () => {
  it('snake matches the workspace helper on tricky input', () => {
    expect(snake('Visit Notes!')).toBe('visit_notes');
    expect(snake('  9 lives ')).toBe('n9_lives');
    expect(snake('x'.repeat(40))).toHaveLength(32);
    expect(snake(null)).toBe('');
  });

  it('maps type words, drops system columns and duplicates, caps columns, moves users links', () => {
    const out = normalizeTables([
      {
        name: 'Orders',
        columns: [
          { name: 'Name', type: 'string' },
          { name: 'id', type: 'number' },
          { name: 'Name', type: 'text' },
          { name: 'Total', type: 'currency' },
          { name: 'Who', type: 'ref', ref: 'users' },
          { name: 'Kind', type: 'enum', options: ['A B', 'c'] },
          ...Array.from({ length: 20 }, (_, i) => ({ name: 'c' + i, type: 'int' })),
        ],
      },
      { name: 'users', columns: [{ name: 'x' }] },
      { name: '' },
    ]);
    expect(out.map((t) => t.name)).toEqual(['orders']);
    const t = out[0];
    expect(t.columns).toHaveLength(LIMITS.cols);
    expect(t.columns.slice(0, 4).map((c) => [c.name, c.type])).toEqual([
      ['name', 'text'],
      ['total', 'money'],
      ['who', 'user'],
      ['kind', 'select'],
    ]);
    expect(t.columns[3].options).toEqual(['a_b', 'c']);
    expect(t.title).toBe('name');
    expect(t.owner).toBeNull();
    expect(validateTables(out).ok).toBe(true);
  });
});

describe('the saved builds of the workspace', () => {
  const builds = savedBuilds();
  it('found the clinic and the fact-check desk', () => {
    expect(builds.map((b) => b.id)).toEqual(expect.arrayContaining(['clinic', 'factcheck']));
  });
  for (const b of savedBuilds()) {
    it(`${b.id}: validates with the brief, after normalising, and keeps its tables`, () => {
      const norm = normalizeTables(b.database.tables, { roleIds: b.roles });
      expect(norm.map((t) => t.name)).toEqual((b.database.tables as Array<{ name: string }>).map((t) => t.name));
      const r = validateTables(norm, { roleIds: b.roles, process: { entity: b.entity, states: b.states } });
      expect(issueLines(r)).toEqual([]);
      expect(r.ok).toBe(true);
    });

    it(`${b.id}: the generated SQL creates real tables in SQLite`, async () => {
      const require = createRequire(import.meta.url);
      const initSqlJs = require('sql.js/dist/sql-wasm.js');
      const SQL = await initSqlJs();
      const db = new SQL.Database();
      db.run('PRAGMA foreign_keys = ON');
      for (const s of schemaSql(normalizeTables(b.database.tables) as TableDef[])) db.run(s);
      const names = db
        .exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid")[0]
        .values.flat();
      expect(names.slice(0, 2)).toEqual(['users', 'activity']);
      expect(names).toContain((b.database.tables[0] as { name: string }).name);
      db.close();
    });
  }
});

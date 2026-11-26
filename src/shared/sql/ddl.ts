import { SQL_TYPE, type ColumnDef, type TableDef } from './types';

/** Quote an identifier the way `qi` does in db.js. */
export const quoteIdent = (n: string): string => '"' + String(n).replace(/"/g, '""') + '"';
/** Quote a value the way `ql` does in db.js. */
export const quoteLiteral = (v: unknown): string =>
  v == null ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";

/** One column line of CREATE TABLE (`colSQL` in db.js). */
export function columnSql(c: ColumnDef): string {
  let s = quoteIdent(c.name) + ' ' + (SQL_TYPE[c.type] || 'TEXT');
  if (c.required) s += ' NOT NULL';
  if (c.type === 'bool') s += ' DEFAULT 0';
  if (c.type === 'select' && c.options && c.options.length)
    s += ' CHECK (' + quoteIdent(c.name) + ' IN (' + c.options.map(quoteLiteral).join(', ') + '))';
  if (c.type === 'ref') s += ' REFERENCES ' + quoteIdent(c.ref || '') + '("id")';
  if (c.type === 'user') s += ' REFERENCES "users"("id")';
  return s;
}

/** CREATE TABLE for one table (`createTableSQL` in db.js). */
export function createTableSql(t: TableDef): string {
  const lines = [
    '"id" INTEGER PRIMARY KEY AUTOINCREMENT',
    ...t.columns.map(columnSql),
    '"created_by" INTEGER REFERENCES "users"("id")',
    '"created_at" TEXT',
  ];
  return 'CREATE TABLE ' + quoteIdent(t.name) + ' (\n  ' + lines.join(',\n  ') + '\n)';
}

/** The two tables every app has (`SYS_SQL` in db.js). */
export const SYSTEM_SQL: readonly string[] = [
  'CREATE TABLE "users" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT,\n  "name" TEXT NOT NULL,\n  "username" TEXT NOT NULL UNIQUE,\n  "password" TEXT NOT NULL,\n  "role" TEXT NOT NULL\n)',
  'CREATE TABLE "activity" (\n  "id" INTEGER PRIMARY KEY AUTOINCREMENT,\n  "at" TEXT NOT NULL,\n  "user_id" INTEGER REFERENCES "users"("id"),\n  "table_name" TEXT NOT NULL,\n  "row_id" INTEGER,\n  "action" TEXT NOT NULL,\n  "detail" TEXT\n)',
];

/** Every statement that creates an app's database, in the order the workspace runs them. */
export const schemaSql = (tables: TableDef[]): string[] => [...SYSTEM_SQL, ...tables.map(createTableSql)];

/**
 * Table definitions as the Database agent produces them and the workspace stores them (`app.def.tables`).
 * Pure types and constants: usable on the server and in the browser. Mirrors `src/legacy/engine.js`.
 */

export const COLUMN_TYPES = ['text', 'longtext', 'number', 'money', 'date', 'datetime', 'bool', 'select', 'ref', 'user'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

/** Same table as `TYPE_ALIAS` in engine.js: words a model may use for a type, and the type they become. */
export const TYPE_ALIAS: Readonly<Record<string, ColumnType>> = {
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

/** The SQLite type of each column type (`SQLT` in db.js). */
export const SQL_TYPE: Readonly<Record<ColumnType, string>> = {
  text: 'TEXT',
  longtext: 'TEXT',
  select: 'TEXT',
  date: 'TEXT',
  datetime: 'TEXT',
  number: 'NUMERIC',
  money: 'REAL',
  bool: 'INTEGER',
  ref: 'INTEGER',
  user: 'INTEGER',
};

/** `LIMITS` in engine.js: the design's limits. */
export const LIMITS = { tables: 8, cols: 12, rows: 40 } as const;

/** Tables the runtime creates itself, and columns it adds to every table. */
export const SYSTEM_TABLES = ['users', 'activity'] as const;
/** The column that marks a row as demo data: 1 for a made-up row, 0 for a record someone added. */
export const DEMO_COLUMN = 'is_demo';
export const SYSTEM_COLUMNS = ['id', 'created_by', 'created_at', DEMO_COLUMN] as const;

export interface ColumnDef {
  name: string;
  label?: string;
  type: ColumnType;
  required?: boolean;
  /** type `select`: allowed values, snake_case */
  options?: string[];
  labels?: Record<string, string>;
  /** type `ref`: the table this column points to */
  ref?: string;
  /** type `user`: limit the person to one role */
  role?: string | null;
}

export interface TableDef {
  name: string;
  label?: string;
  one?: string;
  /** the column shown as the record's name */
  title: string;
  /** the `user` column that says whose record it is */
  owner?: string | null;
  columns: ColumnDef[];
  rows?: Array<Record<string, unknown>>;
}

export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  /** stable machine-readable code */
  code: string;
  /** where: `appointments`, `appointments.status` or empty for the whole list */
  path: string;
  /** plain English, fit to show an agent as a repair hint */
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
}

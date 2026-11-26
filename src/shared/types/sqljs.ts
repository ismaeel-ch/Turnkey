/**
 * The part of the sql.js API the workspace uses. sql.js ships no types and is loaded as a classic script
 * (src/platform/sqlite.ts), so these are written by hand from its documentation: https://sql.js.org/documentation/
 */

export type SqlValue = number | string | Uint8Array | null;
export type SqlParams = SqlValue[] | Record<string, SqlValue>;
export type SqlRow = Record<string, SqlValue>;

export interface SqlStatement {
  bind(params?: SqlParams): boolean;
  step(): boolean;
  getAsObject(): SqlRow;
  run(params?: SqlParams): void;
  free(): boolean;
}

export interface SqlQueryResult {
  columns: string[];
  values: SqlValue[][];
}

export interface SqlDatabase {
  run(sql: string, params?: SqlParams): SqlDatabase;
  exec(sql: string, params?: SqlParams): SqlQueryResult[];
  prepare(sql: string, params?: SqlParams): SqlStatement;
  getRowsModified(): number;
  export(): Uint8Array;
  close(): void;
}

export interface SqlJsStatic {
  Database: new (data?: ArrayLike<number> | Buffer | null) => SqlDatabase;
}

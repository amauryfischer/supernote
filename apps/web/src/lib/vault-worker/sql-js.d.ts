/**
 * Minimal type declarations for sql.js (sql-wasm.js).
 * The package does not ship its own .d.ts files, so we declare the
 * subset of the API that the vault worker actually uses.
 */

declare module "sql.js" {
  export interface QueryExecResult {
    columns: string[];
    values: Array<Array<string | number | null | Uint8Array>>;
  }

  export type SqlValue = string | number | null | Uint8Array;

  export interface Database {
    exec(sql: string, params?: SqlValue[]): QueryExecResult[];
    run(sql: string, params?: SqlValue[]): Database;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  export interface SqlJsConfig {
    locateFile?: (url: string, scriptDirectory: string) => string;
  }

  function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
  export default initSqlJs;
}

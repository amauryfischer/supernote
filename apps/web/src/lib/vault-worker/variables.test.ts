import { describe, it, expect, beforeEach } from 'vitest';
// sql.js ships a CJS default export (initSqlJs). Use dynamic import with
// default unwrapping so it works in the ESM test runner.
import sqlJsModule from 'sql.js';
import type { Database as SqlJsDatabase } from 'sql.js';
import { SCHEMA_SQL_BASE } from './db-schema.js';
import type { Database } from './sqlite-adapter.js';
import {
  insertVariable,
  listVariables,
  updateVariable,
  deleteVariable,
  resolveVariable,
} from './variables.js';

// sql.js Database matches our Database interface (exec returns QueryExecResult[])
function asSuperDb(db: SqlJsDatabase): Database {
  return db as unknown as Database;
}

let sqlJsDb: SqlJsDatabase;

beforeEach(async () => {
  // initSqlJs may be the module itself or its .default depending on bundler
  const initSqlJs =
    typeof sqlJsModule === 'function'
      ? sqlJsModule
      : (sqlJsModule as unknown as { default: typeof sqlJsModule }).default;
  const SQL = await initSqlJs({});
  sqlJsDb = new SQL.Database();
  sqlJsDb.exec(SCHEMA_SQL_BASE);
});

describe('variables worker helpers', () => {
  it('inserts and lists', () => {
    const db = asSuperDb(sqlJsDb);
    insertVariable(db, {
      id: '01',
      name: 'tauxTVA',
      type: 'number',
      value: { kind: 'literal', value: 0.2 },
    });
    const list = listVariables(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'tauxTVA', type: 'number' });
  });

  it('resolves a literal variable', () => {
    const db = asSuperDb(sqlJsDb);
    insertVariable(db, {
      id: '01',
      name: 'pi',
      type: 'number',
      value: { kind: 'literal', value: 3.14 },
    });
    expect(resolveVariable(db, 'pi')).toBe(3.14);
  });

  it('resolves a formula variable referencing another', () => {
    const db = asSuperDb(sqlJsDb);
    insertVariable(db, { id: '01', name: 'a', type: 'number', value: { kind: 'literal', value: 10 } });
    insertVariable(db, { id: '02', name: 'b', type: 'number', value: { kind: 'formula', expression: '$a * 2' } });
    expect(resolveVariable(db, 'b')).toBe(20);
  });

  it('throws on cycle', () => {
    const db = asSuperDb(sqlJsDb);
    insertVariable(db, { id: '01', name: 'a', type: 'number', value: { kind: 'formula', expression: '$b' } });
    insertVariable(db, { id: '02', name: 'b', type: 'number', value: { kind: 'formula', expression: '$a' } });
    expect(() => resolveVariable(db, 'a')).toThrow(/circular variable reference/i);
  });

  it('coerces literal date string', () => {
    const db = asSuperDb(sqlJsDb);
    insertVariable(db, {
      id: '01',
      name: 'd',
      type: 'date',
      value: { kind: 'literal', value: '2026-05-14T00:00:00.000Z' },
    });
    const r = resolveVariable(db, 'd');
    expect(r).toBeInstanceOf(Date);
  });

  it('update + delete', () => {
    const db = asSuperDb(sqlJsDb);
    insertVariable(db, { id: '01', name: 'x', type: 'number', value: { kind: 'literal', value: 1 } });
    updateVariable(db, '01', { value: { kind: 'literal', value: 2 } });
    expect(resolveVariable(db, 'x')).toBe(2);
    deleteVariable(db, '01');
    expect(listVariables(db)).toHaveLength(0);
  });
});

import type { Database } from "./sqlite-adapter";

export type SqlValue = string | number | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export function row(res: ReturnType<Database["exec"]>): SqlRow | null {
  if (!res.length || !res[0]) return null;
  const { columns, values } = res[0];
  if (!values.length || !values[0]) return null;
  return Object.fromEntries(columns.map((c, i) => [c, values[0]![i] ?? null]));
}

export function rows(res: ReturnType<Database["exec"]>): SqlRow[] {
  if (!res.length || !res[0]) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i] ?? null])));
}

/**
 * Exécute `fn` dans une transaction SQLite (BEGIN IMMEDIATE / COMMIT / ROLLBACK).
 *
 * `fn` DOIT être 100 % synchrone — aucun `await` entre BEGIN et COMMIT. Le worker
 * dispatche les RPC en parallèle (`void handleRpcRequest`), donc un `await` réel
 * (I/O FSA/OPFS) à l'intérieur laisserait une autre RPC s'intercaler dans la
 * transaction ouverte → écritures mêlées ou commit d'un état partiel. Un `fn`
 * synchrone s'exécute d'une traite dans une seule tâche : rien ne s'intercale.
 * (C'est pourquoi syncApplyOps/entitiesCreate/Delete, qui entrelacent des `await`
 * d'I/O fichier avec le SQL, ne sont PAS enveloppés ici.)
 *
 * Gains : durabilité (un kill de l'onglet entre deux statements ne peut plus
 * laisser d'état partiel sur disque — ex. un thread mail vidé de ses messages)
 * + perf (un seul commit/fsync OPFS au lieu d'un par statement ; les batchs mail
 * en faisaient des centaines).
 */
export function runInTransaction<T>(db: Database, fn: () => T): T {
  db.run("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.run("COMMIT");
    return result;
  } catch (e) {
    try {
      db.run("ROLLBACK");
    } catch {
      /* pas de transaction active (BEGIN a échoué) — rien à annuler */
    }
    throw e;
  }
}

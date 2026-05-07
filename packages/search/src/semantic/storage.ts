import type { Database } from "better-sqlite3";
import { ulid } from "@supernote/core";
import type { EmbeddingRow } from "./types.js";

/** Store or update an embedding vector for an entity. */
export function upsertEmbedding(
  db: Database,
  entityId: string,
  modelName: string,
  vector: Float32Array,
): void {
  const vectorJson = JSON.stringify(Array.from(vector));
  const existing = db
    .prepare("SELECT id FROM embedding WHERE entityId = ?")
    .get(entityId) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE embedding SET model = ?, vector = ?, dim = ?, updatedAt = ?
       WHERE entityId = ?`,
    ).run(modelName, vectorJson, vector.length, new Date().toISOString(), entityId);
  } else {
    db.prepare(
      `INSERT INTO embedding (id, entityId, model, vector, dim, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ulid(),
      entityId,
      modelName,
      vectorJson,
      vector.length,
      new Date().toISOString(),
      new Date().toISOString(),
    );
  }
}

/** Load all embeddings from the database, optionally filtered by typeId via a join. */
export function loadEmbeddings(
  db: Database,
  typeFilter?: string,
): Array<{ entityId: string; typeId: string; vector: Float32Array }> {
  let sql: string;
  let params: unknown[];

  if (typeFilter) {
    sql = `
      SELECT e.entityId, en.typeId, e.vector
      FROM embedding e
      JOIN entity en ON en.id = e.entityId
      WHERE en.typeId = ?
    `;
    params = [typeFilter];
  } else {
    sql = `
      SELECT e.entityId, en.typeId, e.vector
      FROM embedding e
      JOIN entity en ON en.id = e.entityId
    `;
    params = [];
  }

  const rows = db.prepare(sql).all(...params) as Array<{
    entityId: string;
    typeId: string;
    vector: string;
  }>;

  return rows.map((r) => ({
    entityId: r.entityId,
    typeId: r.typeId,
    vector: new Float32Array(JSON.parse(r.vector) as number[]),
  }));
}

/** Remove the embedding for an entity. */
export function deleteEmbedding(db: Database, entityId: string): void {
  db.prepare("DELETE FROM embedding WHERE entityId = ?").run(entityId);
}

export type { EmbeddingRow };

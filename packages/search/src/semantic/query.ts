import type { Database } from "better-sqlite3";
import type { EmbeddingEngine } from "./embedding-engine.js";
import { loadEmbeddings } from "./storage.js";
import { cosineSimilarity } from "./cosine.js";
import type { SemanticResult, SemanticQueryOptions } from "./types.js";

/**
 * Semantic search over all stored embeddings.
 *
 * O(n) scan — acceptable up to ~100k entities.
 * TODO: Upgrade to HNSW (hnswlib-node or sqlite-vec) when needed.
 */
export async function semanticQuery(
  db: Database,
  queryText: string,
  embedder: EmbeddingEngine,
  opts: SemanticQueryOptions = {},
): Promise<SemanticResult[]> {
  const { limit = 20, minSimilarity = 0.2, typeFilter } = opts;

  if (!queryText.trim()) return [];

  const queryVec = await embedder.embed(queryText);
  const stored = loadEmbeddings(db, typeFilter);

  const scored: SemanticResult[] = [];
  for (const row of stored) {
    const similarity = cosineSimilarity(queryVec, row.vector);
    if (similarity >= minSimilarity) {
      scored.push({ entityId: row.entityId, typeId: row.typeId, similarity });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

/**
 * Re-embed a single entity and persist the vector.
 * Call this after saving an entity.
 */
export async function reembedEntity(
  db: Database,
  entityId: string,
  text: string,
  embedder: EmbeddingEngine,
  modelName: string,
): Promise<void> {
  const { upsertEmbedding } = await import("./storage.js");
  const vector = await embedder.embed(text);
  upsertEmbedding(db, entityId, modelName, vector);
}

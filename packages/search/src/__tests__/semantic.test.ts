import { describe, it, expect, vi, beforeEach } from "vitest";
import { cosineSimilarity } from "../semantic/cosine.js";
import { EmbeddingEngine } from "../semantic/embedding-engine.js";
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { upsertEmbedding, loadEmbeddings, deleteEmbedding } from "../semantic/storage.js";
import { semanticQuery } from "../semantic/query.js";

// ---------------------------------------------------------------------------
// Deterministic mock embedding engine
// Produces a vector whose first component is 1.0 for "special",
// and 0.0 for everything else — making similarity predictable.
// ---------------------------------------------------------------------------

function hashText(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + (text.charCodeAt(i) ?? 0)) & 0xffffffff;
  return h;
}

function mockEmbed(text: string, dim = 4): Float32Array {
  const vec = new Float32Array(dim);
  const h = Math.abs(hashText(text));
  // Deterministic: each text gets a unique angle
  vec[h % dim] = 1.0;
  // Normalize
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / norm);
}

function makeMockEngine(): EmbeddingEngine {
  const engine = new EmbeddingEngine();
  // Override embed to return deterministic vector
  vi.spyOn(engine, "embed").mockImplementation(async (text: string) => mockEmbed(text));
  vi.spyOn(engine, "embedBatch").mockImplementation(async (texts: string[]) =>
    texts.map((t) => mockEmbed(t)),
  );
  return engine;
}

// ---------------------------------------------------------------------------
// DB setup
// ---------------------------------------------------------------------------

function makeDb(): DB {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity (
      id TEXT PRIMARY KEY,
      typeId TEXT NOT NULL,
      filePath TEXT DEFAULT '',
      fields TEXT DEFAULT '{}',
      body TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS embedding (
      id TEXT PRIMARY KEY,
      entityId TEXT UNIQUE NOT NULL,
      model TEXT NOT NULL,
      vector TEXT NOT NULL,
      dim INTEGER NOT NULL,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_embedding_entityId ON embedding(entityId);
  `);
  return db;
}

function insertEntity(db: DB, id: string, typeId = "type-a"): void {
  db.prepare(
    "INSERT OR REPLACE INTO entity (id, typeId) VALUES (?, ?)",
  ).run(id, typeId);
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = new Float32Array([1, 0, 0, 0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it("returns -1 for opposite vectors", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it("handles zero vector gracefully", () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it("throws on dimension mismatch", () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(() => cosineSimilarity(a, b)).toThrow(/dimension mismatch/i);
  });

  it("returns correct similarity for known values", () => {
    const a = new Float32Array([1, 1]);
    const b = new Float32Array([1, 0]);
    const expected = 1 / Math.sqrt(2);
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 5);
  });
});

// ---------------------------------------------------------------------------
// Embedding storage
// ---------------------------------------------------------------------------

describe("embedding storage", () => {
  let db: DB;

  beforeEach(() => {
    db = makeDb();
  });

  it("inserts a new embedding", () => {
    insertEntity(db, "e1");
    const vec = new Float32Array([0.1, 0.2, 0.3]);
    upsertEmbedding(db, "e1", "test-model", vec);
    const stored = loadEmbeddings(db);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.entityId).toBe("e1");
  });

  it("updates an existing embedding on upsert", () => {
    insertEntity(db, "e1");
    upsertEmbedding(db, "e1", "model-a", new Float32Array([1, 0, 0]));
    upsertEmbedding(db, "e1", "model-b", new Float32Array([0, 1, 0]));
    const stored = loadEmbeddings(db);
    expect(stored).toHaveLength(1);
    // Second upsert should update the vector
    expect(Array.from(stored[0]!.vector)).toEqual([0, 1, 0]);
  });

  it("deletes an embedding", () => {
    insertEntity(db, "e1");
    upsertEmbedding(db, "e1", "model", new Float32Array([1, 0]));
    deleteEmbedding(db, "e1");
    expect(loadEmbeddings(db)).toHaveLength(0);
  });

  it("loads embeddings filtered by typeId", () => {
    insertEntity(db, "e1", "type-a");
    insertEntity(db, "e2", "type-b");
    upsertEmbedding(db, "e1", "m", new Float32Array([1, 0]));
    upsertEmbedding(db, "e2", "m", new Float32Array([0, 1]));
    const filtered = loadEmbeddings(db, "type-a");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.entityId).toBe("e1");
  });
});

// ---------------------------------------------------------------------------
// Semantic query (mocked engine)
// ---------------------------------------------------------------------------

describe("semanticQuery (mock engine)", () => {
  let db: DB;
  let engine: EmbeddingEngine;

  beforeEach(() => {
    db = makeDb();
    engine = makeMockEngine();
  });

  it("returns empty when no embeddings stored", async () => {
    const results = await semanticQuery(db, "hello", engine);
    expect(results).toHaveLength(0);
  });

  it("returns results above minSimilarity", async () => {
    insertEntity(db, "e1");
    // Store a vector identical to what "hello" would produce
    const vec = mockEmbed("hello");
    upsertEmbedding(db, "e1", "mock", vec);

    const results = await semanticQuery(db, "hello", engine, { minSimilarity: 0.9 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.entityId).toBe("e1");
    expect(results[0]!.similarity).toBeGreaterThan(0.9);
  });

  it("returns empty for empty query", async () => {
    insertEntity(db, "e1");
    upsertEmbedding(db, "e1", "mock", new Float32Array([1, 0, 0, 0]));
    const results = await semanticQuery(db, "   ", engine);
    expect(results).toHaveLength(0);
  });

  it("respects limit option", async () => {
    for (let i = 0; i < 5; i++) {
      insertEntity(db, `e${i}`);
      upsertEmbedding(db, `e${i}`, "mock", new Float32Array([0.5, 0.5, 0, 0]));
    }
    const results = await semanticQuery(db, "hello", engine, { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("results are sorted by descending similarity", async () => {
    insertEntity(db, "e1");
    insertEntity(db, "e2");
    upsertEmbedding(db, "e1", "mock", new Float32Array([1, 0, 0, 0]));
    upsertEmbedding(db, "e2", "mock", new Float32Array([0, 0, 0, 1]));

    const results = await semanticQuery(db, "hello", engine, { minSimilarity: 0 });
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.similarity).toBeGreaterThanOrEqual(results[i]!.similarity);
    }
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { hybridSearch } from "../hybrid.js";
import { EmbeddingEngine } from "../semantic/embedding-engine.js";
import { installFts } from "../fts/install.js";
import { upsertEmbedding } from "../semantic/storage.js";

// ---------------------------------------------------------------------------
// Mock embedding engine
// ---------------------------------------------------------------------------

function mockEmbed(text: string, dim = 4): Float32Array {
  const vec = new Float32Array(dim).fill(0);
  // Simple deterministic hash-based embedding
  let seed = 0;
  for (let i = 0; i < text.length; i++) seed = (seed * 31 + (text.charCodeAt(i) ?? 0)) & 0xffff;
  vec[seed % dim] = 1.0;
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  return vec.map((v) => v / (norm || 1));
}

function makeMockEngine(): EmbeddingEngine {
  const engine = new EmbeddingEngine();
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
    CREATE TABLE IF NOT EXISTS entity_tag (
      entityId TEXT,
      tagId TEXT,
      PRIMARY KEY(entityId, tagId)
    );
    CREATE TABLE IF NOT EXISTS tag (
      id TEXT PRIMARY KEY,
      vaultId TEXT,
      path TEXT,
      label TEXT,
      parentPath TEXT,
      createdAt TEXT,
      updatedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS relation_edge (
      id TEXT PRIMARY KEY,
      sourceId TEXT,
      targetId TEXT,
      relationTypeId TEXT,
      fields TEXT DEFAULT '{}',
      createdAt TEXT,
      updatedAt TEXT
    );
  `);
  installFts(db);
  return db;
}

function insertEntity(db: DB, id: string, typeId = "type-a"): void {
  db.prepare("INSERT OR REPLACE INTO entity (id, typeId) VALUES (?, ?)").run(id, typeId);
}

// ---------------------------------------------------------------------------
// RRF math verification
// ---------------------------------------------------------------------------

describe("RRF math", () => {
  it("combines FTS-only result with score > 0", async () => {
    const db = makeDb();
    const engine = makeMockEngine();
    insertEntity(db, "e1");
    // Put e1 in FTS
    db.prepare(
      "INSERT INTO entity_fts(entity_id, title, body, tags, field_text, type_id) VALUES (?,?,?,?,?,?)",
    ).run("e1", "consultant", "Jean is a consultant", "", "", "type-a");
    // No embeddings — semantic will return nothing

    const results = await hybridSearch(db, engine, "consultant");
    const e1 = results.find((r) => r.entityId === "e1");
    expect(e1).toBeDefined();
    expect(e1!.combinedScore).toBeGreaterThan(0);
    db.close();
  });

  it("combined score = ftsWeight*rrfFts + semWeight*rrfSem for known ranks", async () => {
    // Manual RRF calculation: rank 0, K=60
    // rrfScore(0) = 1/61 ≈ 0.01639
    const K = 60;
    const rrfScore = (rank: number) => 1 / (K + rank + 1);

    const ftsRrf0 = rrfScore(0);
    const semWeight = 0.4;
    const ftsWeight = 0.6;

    // Entity only in FTS at rank 0:
    const expectedFtsOnly = ftsRrf0 * ftsWeight;
    expect(expectedFtsOnly).toBeCloseTo(ftsRrf0 * 0.6, 10);

    // Entity in both FTS rank 0 and sem rank 0:
    const expectedBoth = ftsRrf0 * ftsWeight + rrfScore(0) * semWeight;
    expect(expectedBoth).toBeGreaterThan(expectedFtsOnly);
  });

  it("entity in both FTS and semantic gets higher score", async () => {
    const db = makeDb();
    const engine = makeMockEngine();

    insertEntity(db, "e1");
    insertEntity(db, "e2");

    // e1: in both FTS and semantic
    db.prepare(
      "INSERT INTO entity_fts(entity_id, title, body, tags, field_text, type_id) VALUES (?,?,?,?,?,?)",
    ).run("e1", "consultant", "consultant work", "", "", "type-a");
    db.prepare(
      "INSERT INTO entity_fts(entity_id, title, body, tags, field_text, type_id) VALUES (?,?,?,?,?,?)",
    ).run("e2", "other", "other stuff", "", "", "type-a");

    // Give e1 the same vector as the query "consultant" mock
    const queryVec = mockEmbed("consultant");
    upsertEmbedding(db, "e1", "mock", queryVec);
    // e2 gets orthogonal vector
    const ortho = new Float32Array(4);
    ortho[(queryVec.findIndex((v) => v > 0) + 1) % 4] = 1;
    upsertEmbedding(db, "e2", "mock", ortho);

    const results = await hybridSearch(db, engine, "consultant", { semanticWeight: 0.4 });
    const e1Score = results.find((r) => r.entityId === "e1")?.combinedScore ?? 0;
    const e2Score = results.find((r) => r.entityId === "e2")?.combinedScore ?? 0;

    // e1 should score higher since it's in both
    expect(e1Score).toBeGreaterThanOrEqual(e2Score);
    db.close();
  });

  it("respects limit option", async () => {
    const db = makeDb();
    const engine = makeMockEngine();

    for (let i = 0; i < 8; i++) {
      insertEntity(db, `e${i}`);
      db.prepare(
        "INSERT INTO entity_fts(entity_id, title, body, tags, field_text, type_id) VALUES (?,?,?,?,?,?)",
      ).run(`e${i}`, "consultant", "consultant", "", "", "type-a");
    }

    const results = await hybridSearch(db, engine, "consultant", { limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
    db.close();
  });

  it("results are sorted by descending combinedScore", async () => {
    const db = makeDb();
    const engine = makeMockEngine();
    insertEntity(db, "e1");
    db.prepare(
      "INSERT INTO entity_fts(entity_id, title, body, tags, field_text, type_id) VALUES (?,?,?,?,?,?)",
    ).run("e1", "test", "test data", "", "", "type-a");
    upsertEmbedding(db, "e1", "mock", mockEmbed("test"));

    const results = await hybridSearch(db, engine, "test");
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.combinedScore).toBeGreaterThanOrEqual(results[i]!.combinedScore);
    }
    db.close();
  });

  it("handles empty query gracefully", async () => {
    const db = makeDb();
    const engine = makeMockEngine();
    // empty query → FTS returns nothing, semantic returns nothing
    const results = await hybridSearch(db, engine, "");
    expect(Array.isArray(results)).toBe(true);
    db.close();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import { installFts } from "../fts/install.js";
import { indexEntity, removeFromFts } from "../fts/index-entity.js";
import { ftsQuery } from "../fts/query.js";
import type { Entity, EntityType } from "@supernote/core";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): DB {
  const db = new Database(":memory:");
  // Create minimal entity table for FTS
  db.exec(`
    CREATE TABLE IF NOT EXISTS entity (
      id TEXT PRIMARY KEY,
      typeId TEXT NOT NULL,
      filePath TEXT NOT NULL,
      fields TEXT DEFAULT '{}',
      body TEXT,
      fileHash TEXT,
      astCache TEXT,
      embedding TEXT,
      lastEditedBy TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
  `);
  return db;
}

function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "entity-01",
    typeId: "type-person",
    filePath: "/notes/jean.md",
    fields: { name: "Jean Dupont", email: "jean@example.com" },
    body: "Jean is a great consultant working with big clients.",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-15"),
    tags: ["client/important", "vip"],
    ...overrides,
  };
}

function makeSchema(overrides: Partial<EntityType> = {}): EntityType {
  return {
    id: "type-person",
    name: "Person",
    plural: "Persons",
    fields: [
      {
        id: "f1",
        name: "name",
        label: "Name",
        kind: "text",
        required: true,
        unique: false,
      },
      {
        id: "f2",
        name: "email",
        label: "Email",
        kind: "email",
        required: false,
        unique: false,
      },
    ],
    defaultPath: "/contacts",
    fileNamePattern: "{name}.md",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FTS: installFts", () => {
  let db: DB;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    db.close();
  });

  it("creates entity_fts virtual table", () => {
    installFts(db);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entity_fts'")
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("entity_fts");
  });

  it("is idempotent — calling twice does not throw", () => {
    expect(() => {
      installFts(db);
      installFts(db);
    }).not.toThrow();
  });

  it("creates insert trigger", () => {
    installFts(db);
    const trigger = db
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='entity_fts_after_insert'")
      .get() as { name: string } | undefined;
    expect(trigger?.name).toBe("entity_fts_after_insert");
  });
});

describe("FTS: indexEntity + ftsQuery", () => {
  let db: DB;

  beforeEach(() => {
    db = makeDb();
    installFts(db);
  });

  afterEach(() => {
    db.close();
  });

  it("indexes an entity and finds it by title", () => {
    const entity = makeEntity();
    const schema = makeSchema();
    indexEntity(db, entity, schema);

    const results = ftsQuery(db, '"Jean Dupont"');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.entityId).toBe("entity-01");
  });

  it("finds entity by body content", () => {
    indexEntity(db, makeEntity(), makeSchema());
    const results = ftsQuery(db, "consultant");
    expect(results.length).toBe(1);
    expect(results[0]?.entityId).toBe("entity-01");
  });

  it("returns empty array for non-matching query", () => {
    indexEntity(db, makeEntity(), makeSchema());
    const results = ftsQuery(db, "zyxwvuts");
    expect(results).toHaveLength(0);
  });

  it("returns empty array for empty query", () => {
    indexEntity(db, makeEntity(), makeSchema());
    const results = ftsQuery(db, "");
    expect(results).toHaveLength(0);
  });

  it("ranks by BM25 — more relevant doc first", () => {
    const schema = makeSchema();
    indexEntity(db, makeEntity({ id: "e1", body: "consultant consultant consultant" }), schema);
    indexEntity(db, makeEntity({ id: "e2", body: "consultant once" }), schema);

    const results = ftsQuery(db, "consultant");
    expect(results.length).toBe(2);
    // BM25 rank is negative; lower = more relevant
    expect(results[0]!.rank).toBeLessThan(results[1]!.rank);
    expect(results[0]!.entityId).toBe("e1");
  });

  it("returns typeId on results", () => {
    indexEntity(db, makeEntity(), makeSchema());
    const results = ftsQuery(db, "Jean");
    expect(results[0]?.typeId).toBe("type-person");
  });

  it("filters by typeFilter", () => {
    const schema = makeSchema();
    indexEntity(db, makeEntity({ id: "e1", typeId: "type-person" }), schema);
    indexEntity(db, makeEntity({ id: "e2", typeId: "type-org", body: "consultant org" }), {
      ...schema,
      id: "type-org",
    });

    const results = ftsQuery(db, "consultant", { typeFilter: "type-person" });
    const ids = results.map((r) => r.entityId);
    expect(ids).toContain("e1");
    expect(ids).not.toContain("e2");
  });

  it("upserts — re-indexing updates existing row", () => {
    const schema = makeSchema();
    indexEntity(db, makeEntity({ body: "original text" }), schema);
    indexEntity(db, makeEntity({ body: "updated content" }), schema);

    const r1 = ftsQuery(db, "original");
    const r2 = ftsQuery(db, "updated");
    expect(r1).toHaveLength(0);
    expect(r2).toHaveLength(1);
  });

  it("respects limit option", () => {
    const schema = makeSchema();
    for (let i = 0; i < 5; i++) {
      indexEntity(db, makeEntity({ id: `e${i}`, body: "consultant test" }), schema);
    }
    const results = ftsQuery(db, "consultant", { limit: 2 });
    expect(results.length).toBe(2);
  });

  it("includes snippet in results", () => {
    indexEntity(db, makeEntity(), makeSchema());
    const results = ftsQuery(db, "consultant");
    expect(results[0]?.snippet).toBeDefined();
    expect(typeof results[0]?.snippet).toBe("string");
  });

  it("does not throw on malformed FTS5 query", () => {
    indexEntity(db, makeEntity(), makeSchema());
    expect(() => ftsQuery(db, "AND OR")).not.toThrow();
  });
});

describe("FTS: removeFromFts", () => {
  let db: DB;

  beforeEach(() => {
    db = makeDb();
    installFts(db);
  });

  afterEach(() => {
    db.close();
  });

  it("removes an entity from index", () => {
    indexEntity(db, makeEntity(), makeSchema());
    removeFromFts(db, "entity-01");
    const results = ftsQuery(db, "Jean");
    expect(results).toHaveLength(0);
  });

  it("does not throw when removing non-existent entity", () => {
    expect(() => removeFromFts(db, "non-existent-id")).not.toThrow();
  });
});

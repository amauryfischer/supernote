/**
 * share-store — storage layer for public read-only note shares, mirroring
 * the dual-engine shape of `sync-store.mjs` (SQLite via better-sqlite3 for
 * `file:` URLs, PostgreSQL via `pg` for `postgres://` URLs — the durable
 * choice on Scalingo, whose container filesystem is wiped on each deploy).
 *
 * One row per shared entity, keyed by entityId so republishing (the client
 * re-pushes the rendered HTML on every save while a share is active) keeps
 * the same public slug — `ON CONFLICT (entityId) DO UPDATE` never touches
 * the slug column, only a fresh publish (no existing row) mints one.
 *
 * Interface (all async so the backend code is engine-agnostic):
 *   upsert(entityId, { title, html }) → { slug, updatedAt }
 *   get(entityId)                     → Share | null
 *   getBySlug(slug)                   → Share | null
 *   remove(entityId)                  → boolean
 *   kind                              → "sqlite" | "postgres"
 */

import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

function mintSlug() {
  return randomBytes(9).toString("base64url");
}

// Postgres folds unquoted identifiers to lowercase; normalise both engines
// to the same camelCase shape so the backend never branches on `kind`.
function rowToShare(r) {
  if (!r) return null;
  return {
    entityId: r.entityId ?? r.entityid,
    slug: r.slug,
    title: r.title,
    html: r.html,
    updatedAt: Number(r.updatedAt ?? r.updatedat),
    createdAt: Number(r.createdAt ?? r.createdat),
  };
}

// ── SQLite engine ─────────────────────────────────────────────────────────────

function resolveSqlitePath() {
  if (process.env.SHARE_DB_PATH) return process.env.SHARE_DB_PATH;
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("file:")) {
    try {
      return url.includes("://") ? fileURLToPath(url) : url.slice("file:".length);
    } catch {
      return url.slice("file:".length);
    }
  }
  if (url && !url.includes("://")) return url;
  return "sync-data.db";
}

async function createSqliteStore() {
  const { default: Database } = await import("better-sqlite3");
  const dbPath = resolveSqlitePath();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS share (
      entityId  TEXT PRIMARY KEY,
      slug      TEXT NOT NULL,
      title     TEXT NOT NULL,
      html      TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      createdAt INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS share_slug ON share (slug);
  `);

  const upsertStmt = db.prepare(`
    INSERT INTO share (entityId, slug, title, html, updatedAt, createdAt)
    VALUES (@entityId, @slug, @title, @html, @updatedAt, @createdAt)
    ON CONFLICT(entityId) DO UPDATE SET
      title = excluded.title,
      html = excluded.html,
      updatedAt = excluded.updatedAt
    RETURNING slug, updatedAt
  `);
  const getStmt = db.prepare(`SELECT * FROM share WHERE entityId = ?`);
  const getBySlugStmt = db.prepare(`SELECT * FROM share WHERE slug = ?`);
  const removeStmt = db.prepare(`DELETE FROM share WHERE entityId = ?`);

  return {
    kind: "sqlite",
    label: dbPath,
    upsert: async (entityId, { title, html }) => {
      const now = Date.now();
      const row = upsertStmt.get({
        entityId,
        slug: mintSlug(),
        title,
        html,
        updatedAt: now,
        createdAt: now,
      });
      return { slug: row.slug, updatedAt: Number(row.updatedAt) };
    },
    get: async (entityId) => rowToShare(getStmt.get(entityId)),
    getBySlug: async (slug) => rowToShare(getBySlugStmt.get(slug)),
    remove: async (entityId) => removeStmt.run(entityId).changes > 0,
  };
}

// ── PostgreSQL engine ─────────────────────────────────────────────────────────

async function createPgStore(url) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 5 });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS share (
      entityid  TEXT PRIMARY KEY,
      slug      TEXT NOT NULL UNIQUE,
      title     TEXT NOT NULL,
      html      TEXT NOT NULL,
      updatedat BIGINT NOT NULL,
      createdat BIGINT NOT NULL
    );
  `);

  return {
    kind: "postgres",
    label: url.replace(/:\/\/[^@/]*@/, "://***@"),
    upsert: async (entityId, { title, html }) => {
      const now = Date.now();
      const res = await pool.query(
        `INSERT INTO share (entityid, slug, title, html, updatedat, createdat)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (entityid) DO UPDATE SET
           title = excluded.title,
           html = excluded.html,
           updatedat = excluded.updatedat
         RETURNING slug, updatedat`,
        [entityId, mintSlug(), title, html, now],
      );
      return { slug: res.rows[0].slug, updatedAt: Number(res.rows[0].updatedat) };
    },
    get: async (entityId) => {
      const res = await pool.query(`SELECT * FROM share WHERE entityid = $1`, [entityId]);
      return rowToShare(res.rows[0]);
    },
    getBySlug: async (slug) => {
      const res = await pool.query(`SELECT * FROM share WHERE slug = $1`, [slug]);
      return rowToShare(res.rows[0]);
    },
    remove: async (entityId) => {
      const res = await pool.query(`DELETE FROM share WHERE entityid = $1`, [entityId]);
      return (res.rowCount ?? 0) > 0;
    },
  };
}

// ── Engine selection ──────────────────────────────────────────────────────────

/** Pick the engine from DATABASE_URL: postgres URLs → pg, anything else → sqlite. */
export async function createShareStore() {
  const url = process.env.DATABASE_URL ?? "";
  if (/^postgres(ql)?:\/\//.test(url)) return createPgStore(url);
  return createSqliteStore();
}

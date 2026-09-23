/**
 * share-store — stockage du partage par lien (ressources, liens, états Yjs,
 * images publiées). Double moteur comme `sync-store.mjs` : SQLite pour les URL
 * `file:`, Postgres pour `postgres://` (durable sur Scalingo, dont le disque
 * est effacé à chaque déploiement).
 */

import { fileURLToPath } from "node:url";

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

async function openSqlite() {
  const { default: Database } = await import("better-sqlite3");
  const path = resolveSqlitePath();
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  return {
    kind: "sqlite",
    label: path,
    bin: "BLOB",
    exec: async (sql) => void db.exec(sql),
    get: async (sql, params = []) => db.prepare(sql).get(...params) ?? null,
    all: async (sql, params = []) => db.prepare(sql).all(...params),
    run: async (sql, params = []) => db.prepare(sql).run(...params).changes,
  };
}

async function openPg(url) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 5 });
  // Un client inactif coupé par Postgres tuerait le process sans ce listener.
  pool.on("error", (err) => console.error("[share-store] pg", err));
  // Les requêtes sont écrites une fois avec `?` ; Postgres attend `$1…$n`.
  const query = (sql, params) => {
    let i = 0;
    return pool.query(sql.replace(/\?/g, () => `$${++i}`), params);
  };
  return {
    kind: "postgres",
    label: url.replace(/:\/\/[^@/]*@/, "://***@"),
    bin: "BYTEA",
    exec: async (sql) => void (await pool.query(sql)),
    get: async (sql, params = []) => (await query(sql, params)).rows[0] ?? null,
    all: async (sql, params = []) => (await query(sql, params)).rows,
    run: async (sql, params = []) => (await query(sql, params)).rowCount ?? 0,
  };
}

// Postgres replie les identifiants non quotés en minuscules : snake_case partout.
const schema = (bin) => `
  CREATE TABLE IF NOT EXISTS share_resource (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    owner_key_hash TEXT NOT NULL,
    title TEXT NOT NULL,
    snapshot TEXT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS share_link (
    slug TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL,
    mode TEXT NOT NULL,
    password_hash TEXT,
    expires_at BIGINT,
    label TEXT,
    created_at BIGINT NOT NULL,
    revoked_at BIGINT
  );
  CREATE INDEX IF NOT EXISTS share_link_resource ON share_link (resource_id);
  CREATE TABLE IF NOT EXISTS collab_doc (
    resource_id TEXT PRIMARY KEY,
    state ${bin} NOT NULL,
    updated_at BIGINT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS share_blob (
    resource_id TEXT NOT NULL,
    path TEXT NOT NULL,
    bytes ${bin} NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (resource_id, path)
  );
  CREATE TABLE IF NOT EXISTS share_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

// Table des instantanés HTML de la v1 : lue seulement, pour que les anciens liens vivent.
const LEGACY_SQLITE = `
  CREATE TABLE IF NOT EXISTS share (
    entityId TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL, html TEXT NOT NULL,
    updatedAt INTEGER NOT NULL, createdAt INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS share_slug ON share (slug);
`;
const LEGACY_PG = `
  CREATE TABLE IF NOT EXISTS share (
    entityid TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, html TEXT NOT NULL,
    updatedat BIGINT NOT NULL, createdat BIGINT NOT NULL
  );
`;

const num = (v) => (v == null ? null : Number(v));

function toResource(r) {
  if (!r) return null;
  return {
    id: r.id,
    kind: r.kind,
    ownerKeyHash: r.owner_key_hash,
    title: r.title,
    snapshot: r.snapshot ? JSON.parse(r.snapshot) : null,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function toLink(r) {
  if (!r) return null;
  return {
    slug: r.slug,
    resourceId: r.resource_id,
    mode: r.mode,
    passwordHash: r.password_hash ?? null,
    expiresAt: num(r.expires_at),
    label: r.label ?? null,
    createdAt: num(r.created_at),
    revokedAt: num(r.revoked_at),
  };
}

const LINK_COLUMNS = [
  ["passwordHash", "password_hash"],
  ["expiresAt", "expires_at"],
  ["label", "label"],
];

export async function createShareStore() {
  const url = process.env.DATABASE_URL ?? "";
  const sql = /^postgres(ql)?:\/\//.test(url) ? await openPg(url) : await openSqlite();
  await sql.exec(schema(sql.bin));
  await sql.exec(sql.kind === "postgres" ? LEGACY_PG : LEGACY_SQLITE);

  return {
    kind: sql.kind,
    label: sql.label,

    async createResource({ id, kind, ownerKeyHash, title, snapshot }) {
      const now = Date.now();
      await sql.run(
        `INSERT INTO share_resource (id, kind, owner_key_hash, title, snapshot, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, kind, ownerKeyHash, title, snapshot == null ? null : JSON.stringify(snapshot), now, now],
      );
    },
    getResource: async (id) => toResource(await sql.get(`SELECT * FROM share_resource WHERE id = ?`, [id])),
    renameResource: async (id, title) =>
      (await sql.run(`UPDATE share_resource SET title = ?, updated_at = ? WHERE id = ?`, [title, Date.now(), id])) > 0,
    async deleteResource(id) {
      for (const table of ["share_link", "collab_doc", "share_blob"]) {
        await sql.run(`DELETE FROM ${table} WHERE resource_id = ?`, [id]);
      }
      return (await sql.run(`DELETE FROM share_resource WHERE id = ?`, [id])) > 0;
    },

    async createLink({ slug, resourceId, mode, passwordHash, expiresAt, label }) {
      await sql.run(
        `INSERT INTO share_link (slug, resource_id, mode, password_hash, expires_at, label, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
        [slug, resourceId, mode, passwordHash ?? null, expiresAt ?? null, label ?? null, Date.now()],
      );
    },
    getLink: async (slug) => toLink(await sql.get(`SELECT * FROM share_link WHERE slug = ?`, [slug])),
    listLinks: async (resourceId) =>
      (await sql.all(`SELECT * FROM share_link WHERE resource_id = ? ORDER BY created_at`, [resourceId])).map(toLink),
    async updateLink(slug, patch) {
      const sets = [];
      const params = [];
      for (const [key, column] of LINK_COLUMNS) {
        if (key in patch) {
          sets.push(`${column} = ?`);
          params.push(patch[key] ?? null);
        }
      }
      if (sets.length === 0) return false;
      return (await sql.run(`UPDATE share_link SET ${sets.join(", ")} WHERE slug = ?`, [...params, slug])) > 0;
    },
    revokeLink: async (slug) =>
      (await sql.run(`UPDATE share_link SET revoked_at = ? WHERE slug = ? AND revoked_at IS NULL`, [Date.now(), slug])) > 0,

    async getDoc(resourceId) {
      const r = await sql.get(`SELECT state FROM collab_doc WHERE resource_id = ?`, [resourceId]);
      return r ? new Uint8Array(r.state) : null;
    },
    async putDoc(resourceId, state) {
      await sql.run(
        `INSERT INTO collab_doc (resource_id, state, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (resource_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
        [resourceId, Buffer.from(state), Date.now()],
      );
    },
    seedDoc: async (resourceId, state) =>
      (await sql.run(
        `INSERT INTO collab_doc (resource_id, state, updated_at) VALUES (?, ?, ?) ON CONFLICT (resource_id) DO NOTHING`,
        [resourceId, Buffer.from(state), Date.now()],
      )) > 0,

    async putBlob(resourceId, path, bytes) {
      await sql.run(
        `INSERT INTO share_blob (resource_id, path, bytes, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (resource_id, path) DO UPDATE SET bytes = excluded.bytes`,
        [resourceId, path, bytes, Date.now()],
      );
    },
    async getBlob(resourceId, path) {
      const r = await sql.get(`SELECT bytes FROM share_blob WHERE resource_id = ? AND path = ?`, [resourceId, path]);
      return r ? Buffer.from(r.bytes) : null;
    },

    async ensureMeta(key, makeValue) {
      await sql.run(`INSERT INTO share_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING`, [key, makeValue()]);
      return (await sql.get(`SELECT value FROM share_meta WHERE key = ?`, [key])).value;
    },

    async legacyBySlug(slug) {
      const r = await sql.get(`SELECT * FROM share WHERE slug = ?`, [slug]);
      if (!r) return null;
      return { title: r.title, html: r.html, updatedAt: Number(r.updatedAt ?? r.updatedat) };
    },
  };
}

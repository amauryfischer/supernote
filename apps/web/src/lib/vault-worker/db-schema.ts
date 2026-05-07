/**
 * db-schema — SQLite schema SQL to run inside sql.js worker.
 *
 * This is the same DDL as packages/db/prisma/migrations/20260507104020_init/migration.sql
 * adapted for direct sql.js execution (no Prisma runtime needed in browser).
 *
 * All CREATE statements use IF NOT EXISTS to be idempotent.
 */

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS "vault" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "description" TEXT,
    "isActive" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS "entity_type" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plural" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "fields" TEXT NOT NULL DEFAULT '[]',
    "defaultPath" TEXT,
    "fileNamePattern" TEXT,
    "defaultView" TEXT,
    "validations" TEXT NOT NULL DEFAULT '[]',
    "workflowIds" TEXT NOT NULL DEFAULT '[]',
    "isSystem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "entity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fields" TEXT NOT NULL DEFAULT '{}',
    "body" TEXT,
    "fileHash" TEXT,
    "astCache" TEXT,
    "embedding" TEXT,
    "lastEditedBy" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("typeId") REFERENCES "entity_type" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "relation_type" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "forwardLabel" TEXT NOT NULL,
    "inverseLabel" TEXT,
    "sourceTypeId" TEXT,
    "targetTypeId" TEXT,
    "cardinality" TEXT NOT NULL DEFAULT 'MANY_TO_MANY',
    "fields" TEXT NOT NULL DEFAULT '[]',
    "isSystem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "relation_edge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relationTypeId" TEXT NOT NULL,
    "fields" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    FOREIGN KEY ("sourceId") REFERENCES "entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("targetId") REFERENCES "entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("relationTypeId") REFERENCES "relation_type" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentPath" TEXT,
    "color" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "entity_tag" (
    "entityId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    PRIMARY KEY ("entityId", "tagId"),
    FOREIGN KEY ("entityId") REFERENCES "entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("tagId") REFERENCES "tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "mention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT,
    "rawText" TEXT NOT NULL,
    "mentionType" TEXT NOT NULL,
    "offset" INTEGER,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    FOREIGN KEY ("sourceId") REFERENCES "entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("targetId") REFERENCES "entity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "view" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityTypeId" TEXT,
    "config" TEXT NOT NULL DEFAULT '{}',
    "isDefault" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "template" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityTypeId" TEXT,
    "defaultFields" TEXT NOT NULL DEFAULT '{}',
    "bodyTemplate" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "automation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'REACTIVE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "trigger" TEXT NOT NULL DEFAULT '{}',
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actions" TEXT NOT NULL DEFAULT '[]',
    "lastRunAt" TEXT,
    "nextRunAt" TEXT,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS "entity_fts" USING fts5(
    id UNINDEXED,
    body,
    content="entity",
    content_rowid="rowid"
);

-- FTS triggers to keep index up-to-date
CREATE TRIGGER IF NOT EXISTS entity_fts_ai AFTER INSERT ON "entity" BEGIN
    INSERT INTO entity_fts(rowid, id, body) VALUES (new.rowid, new.id, new.body);
END;

CREATE TRIGGER IF NOT EXISTS entity_fts_ad AFTER DELETE ON "entity" BEGIN
    INSERT INTO entity_fts(entity_fts, rowid, id, body) VALUES('delete', old.rowid, old.id, old.body);
END;

CREATE TRIGGER IF NOT EXISTS entity_fts_au AFTER UPDATE ON "entity" BEGIN
    INSERT INTO entity_fts(entity_fts, rowid, id, body) VALUES('delete', old.rowid, old.id, old.body);
    INSERT INTO entity_fts(rowid, id, body) VALUES (new.rowid, new.id, new.body);
END;

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "vault_rootPath_key" ON "vault"("rootPath");
CREATE INDEX IF NOT EXISTS "entity_type_vaultId_idx" ON "entity_type"("vaultId");
CREATE UNIQUE INDEX IF NOT EXISTS "entity_type_vaultId_name_key" ON "entity_type"("vaultId", "name");
CREATE INDEX IF NOT EXISTS "entity_vaultId_typeId_idx" ON "entity"("vaultId", "typeId");
CREATE INDEX IF NOT EXISTS "entity_vaultId_idx" ON "entity"("vaultId");
CREATE UNIQUE INDEX IF NOT EXISTS "entity_vaultId_filePath_key" ON "entity"("vaultId", "filePath");
CREATE INDEX IF NOT EXISTS "tag_vaultId_idx" ON "tag"("vaultId");
CREATE UNIQUE INDEX IF NOT EXISTS "tag_vaultId_path_key" ON "tag"("vaultId", "path");
`;

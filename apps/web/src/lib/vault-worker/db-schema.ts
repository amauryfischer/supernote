/**
 * db-schema — SQLite schema SQL applied at vault-worker boot.
 *
 * Mirrors `packages/db/prisma/migrations/20260507104020_init/migration.sql`
 * (Prisma migrations don't run in the browser — the worker drives sqlite-wasm
 * directly).
 *
 * All CREATE statements use IF NOT EXISTS to be idempotent.
 *
 * SCHEMA_SQL_BASE  — tables + indexes
 * SCHEMA_SQL_FTS5  — entity_fts virtual table + sync triggers. The official
 *                    `@sqlite.org/sqlite-wasm` build ships FTS5, so this is
 *                    applied in the browser too.
 * SCHEMA_SQL       — base + FTS5 concatenated. This is what the worker runs.
 */

export const SCHEMA_SQL_BASE = `
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
    "sourceVaultId" TEXT,
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

CREATE TABLE IF NOT EXISTS "automation_run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "automationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "triggerPayload" TEXT,
    "actionResults" TEXT NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL
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

-- Saved views of a Base (Coda/Notion-style projection of an entity_type).
-- A view is a named filtered+sorted+projected representation of all entities
-- of one typeId. Inline ad-hoc views (embedded inside a note's BlockNote
-- "databaseView" block) are NOT stored here -- they live in the note body.
CREATE TABLE IF NOT EXISTS "view" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'table',
    "filters" TEXT NOT NULL DEFAULT '[]',
    "sorts" TEXT NOT NULL DEFAULT '[]',
    "visibleFields" TEXT NOT NULL DEFAULT '[]',
    "hiddenFields" TEXT NOT NULL DEFAULT '[]',
    "groupByField" TEXT,
    "rowHeight" TEXT NOT NULL DEFAULT 'normal',
    "summarize" TEXT NOT NULL DEFAULT '{}',
    "conditionalFormats" TEXT NOT NULL DEFAULT '[]',
    "chartConfig" TEXT,
    "formConfig" TEXT,
    "timelineConfig" TEXT,
    "isSystem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY ("typeId") REFERENCES "entity_type" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "variable" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL UNIQUE,
    "type" TEXT NOT NULL CHECK ("type" IN ('number','string','boolean','date')),
    "value_kind" TEXT NOT NULL CHECK ("value_kind" IN ('literal','formula')),
    "literal_json" TEXT,
    "formula_expr" TEXT,
    "createdAt" INTEGER NOT NULL,
    "updatedAt" INTEGER NOT NULL,
    CHECK ((value_kind = 'literal' AND literal_json IS NOT NULL AND formula_expr IS NULL)
         OR (value_kind = 'formula' AND formula_expr IS NOT NULL AND literal_json IS NULL))
);

-- ── Mail mirror ────────────────────────────────────────────────────────────
-- Local-first cache of a connected Gmail account. The vault op-log peer-sync is
-- NOT involved here: Gmail itself is the cross-device source of truth, so each
-- device mirrors independently against the Gmail API (history.list deltas).
-- Everything is account-scoped (accountId = the connected email) so a future
-- multi-account inbox needs no schema change. These rows are a disposable cache:
-- a wipe just re-syncs from Gmail.

-- One row per mirrored Gmail thread (the list view reads straight from here).
CREATE TABLE IF NOT EXISTS "mail_thread" (
    "accountId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "historyId" TEXT,
    "subject" TEXT NOT NULL DEFAULT '',
    "fromName" TEXT NOT NULL DEFAULT '',
    "fromEmail" TEXT NOT NULL DEFAULT '',
    "snippet" TEXT NOT NULL DEFAULT '',
    "lastDate" TEXT NOT NULL DEFAULT '',
    "lastInternalDate" INTEGER NOT NULL DEFAULT 0,
    "labelIds" TEXT NOT NULL DEFAULT '[]',
    "messagesLoaded" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" INTEGER NOT NULL,
    PRIMARY KEY ("accountId", "id")
);

-- One row per message of a mirrored thread (populated when a thread is opened /
-- fully synced; the summary list only needs mail_thread).
CREATE TABLE IF NOT EXISTS "mail_message" (
    "accountId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "fromName" TEXT NOT NULL DEFAULT '',
    "fromEmail" TEXT NOT NULL DEFAULT '',
    "toJson" TEXT NOT NULL DEFAULT '[]',
    "date" TEXT NOT NULL DEFAULT '',
    "internalDate" INTEGER NOT NULL DEFAULT 0,
    "snippet" TEXT NOT NULL DEFAULT '',
    "bodyText" TEXT NOT NULL DEFAULT '',
    "bodyHtml" TEXT,
    "attachmentsJson" TEXT NOT NULL DEFAULT '[]',
    "messageId" TEXT,
    "refs" TEXT,
    "webLink" TEXT NOT NULL DEFAULT '',
    "labelIds" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" INTEGER NOT NULL,
    PRIMARY KEY ("accountId", "id")
);

-- Mirror of the account's Gmail labels (id, name, optional color).
CREATE TABLE IF NOT EXISTS "mail_label" (
    "accountId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "colorJson" TEXT,
    "type" TEXT,
    "updatedAt" INTEGER NOT NULL,
    PRIMARY KEY ("accountId", "id")
);

-- Per-account reconciliation cursor for incremental sync.
CREATE TABLE IF NOT EXISTS "mail_sync_state" (
    "accountId" TEXT NOT NULL PRIMARY KEY,
    "historyId" TEXT,
    "lastFullSyncAt" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" INTEGER NOT NULL
);

-- Outbox: optimistic local mutations awaiting push to Gmail. Durable so an
-- offline / killed tab retries instead of losing the change.
CREATE TABLE IF NOT EXISTS "mail_outbox" (
    "opId" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT
);

-- Tombstones for deleted entities. A delete (local or from the sync op-log)
-- removes the DB row, but the .md removal from OPFS/FSA can fail silently
-- (file locked / race) and leave an orphan whose frontmatter still carries its
-- id + type. The reindex would then re-adopt it (INSERT ... ON CONFLICT(id) DO
-- UPDATE) and resurrect the entity on the next boot. Recording the deleted id
-- here lets the reindex skip that orphan. A later (re)create / sync-upsert of
-- the same id clears its tombstone. No FK: the entity row is already gone.
CREATE TABLE IF NOT EXISTS "deleted_entity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deletedAt" TEXT NOT NULL
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "vault_rootPath_key" ON "vault"("rootPath");
CREATE INDEX IF NOT EXISTS "entity_type_vaultId_idx" ON "entity_type"("vaultId");
CREATE UNIQUE INDEX IF NOT EXISTS "entity_type_vaultId_name_key" ON "entity_type"("vaultId", "name");
CREATE INDEX IF NOT EXISTS "entity_vaultId_typeId_idx" ON "entity"("vaultId", "typeId");
CREATE INDEX IF NOT EXISTS "entity_vaultId_idx" ON "entity"("vaultId");
CREATE UNIQUE INDEX IF NOT EXISTS "entity_vaultId_filePath_key" ON "entity"("vaultId", "filePath");
CREATE INDEX IF NOT EXISTS "tag_vaultId_idx" ON "tag"("vaultId");
CREATE UNIQUE INDEX IF NOT EXISTS "tag_vaultId_path_key" ON "tag"("vaultId", "path");
CREATE INDEX IF NOT EXISTS "view_vaultId_typeId_idx" ON "view"("vaultId", "typeId");
CREATE INDEX IF NOT EXISTS "idx_entity_source" ON "entity" ("sourceVaultId");
CREATE INDEX IF NOT EXISTS "idx_variable_name" ON "variable" ("name");
CREATE INDEX IF NOT EXISTS "idx_automation_run_automationId_createdAt"
    ON "automation_run" ("automationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "mail_thread_account_date_idx"
    ON "mail_thread" ("accountId", "lastInternalDate" DESC);
CREATE INDEX IF NOT EXISTS "mail_message_thread_idx"
    ON "mail_message" ("accountId", "threadId");
CREATE INDEX IF NOT EXISTS "mail_outbox_account_status_idx"
    ON "mail_outbox" ("accountId", "status");
`;

/**
 * FTS5 schema. Apply AFTER SCHEMA_SQL_BASE.
 */
export const SCHEMA_SQL_FTS5 = `
-- External-content-free FTS5 index. The vault worker writes rows here
-- manually from worker-router.ts (ftsAdd/ftsRemove) because three of the
-- four indexed columns (title/tags/path) are *derived* — they don't exist as
-- physical columns on entity, so neither AFTER INSERT triggers nor an
-- "content=entity" link could populate them. unicode61 + remove_diacritics
-- replicates the MiniSearch behaviour of "linh" matching "Linh Dan" and
-- "lea" matching "Léa".
CREATE VIRTUAL TABLE IF NOT EXISTS "entity_fts" USING fts5(
    id UNINDEXED,
    title,
    body,
    tags,
    path,
    tokenize = "unicode61 remove_diacritics 2"
);
`;

export const SCHEMA_SQL = SCHEMA_SQL_BASE + SCHEMA_SQL_FTS5;

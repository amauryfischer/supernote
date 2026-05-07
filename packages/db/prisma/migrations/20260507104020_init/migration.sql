-- CreateTable
CREATE TABLE "vault" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rootPath" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "entity_type" (
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
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "entity_type_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "relation_type" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "forwardLabel" TEXT NOT NULL,
    "inverseLabel" TEXT,
    "sourceTypeId" TEXT,
    "targetTypeId" TEXT,
    "cardinality" TEXT NOT NULL DEFAULT 'MANY_TO_MANY',
    "fields" TEXT NOT NULL DEFAULT '[]',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "relation_type_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "relation_type_sourceTypeId_fkey" FOREIGN KEY ("sourceTypeId") REFERENCES "entity_type" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "relation_type_targetTypeId_fkey" FOREIGN KEY ("targetTypeId") REFERENCES "entity_type" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "entity" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "entity_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "entity_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "entity_type" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "relation_edge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "relationTypeId" TEXT NOT NULL,
    "fields" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "relation_edge_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "relation_edge_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "relation_edge_relationTypeId_fkey" FOREIGN KEY ("relationTypeId") REFERENCES "relation_type" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentPath" TEXT,
    "color" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "tag_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "entity_tag" (
    "entityId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("entityId", "tagId"),
    CONSTRAINT "entity_tag_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "entity_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mention" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT,
    "rawText" TEXT NOT NULL,
    "mentionType" TEXT NOT NULL,
    "offset" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "mention_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "entity" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mention_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "entity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "view" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityTypeId" TEXT,
    "config" TEXT NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "view_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "template" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "entityTypeId" TEXT,
    "defaultFields" TEXT NOT NULL DEFAULT '{}',
    "bodyTemplate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "template_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "automation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'REACTIVE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "trigger" TEXT NOT NULL DEFAULT '{}',
    "conditions" TEXT NOT NULL DEFAULT '[]',
    "actions" TEXT NOT NULL DEFAULT '[]',
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "automation_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "automation_run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "automationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "triggerPayload" TEXT NOT NULL DEFAULT '{}',
    "actionResults" TEXT NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "automation_run_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "automation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "formula" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "expression" TEXT NOT NULL,
    "typeScope" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "formula_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "workflow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "entityTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "states" TEXT NOT NULL DEFAULT '[]',
    "transitions" TEXT NOT NULL DEFAULT '[]',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "workflow_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "workflow_entityTypeId_fkey" FOREIGN KEY ("entityTypeId") REFERENCES "entity_type" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "git_commit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "entityId" TEXT,
    "sha" TEXT NOT NULL,
    "message" TEXT,
    "author" TEXT,
    "commitAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "git_commit_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "git_commit_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "plugin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "manifest" TEXT NOT NULL DEFAULT '{}',
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "plugin_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "setting" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vaultId" TEXT,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "setting_vaultId_fkey" FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "embedding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "vector" TEXT NOT NULL,
    "dim" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "vault_rootPath_key" ON "vault"("rootPath");

-- CreateIndex
CREATE INDEX "entity_type_vaultId_idx" ON "entity_type"("vaultId");

-- CreateIndex
CREATE UNIQUE INDEX "entity_type_vaultId_name_key" ON "entity_type"("vaultId", "name");

-- CreateIndex
CREATE INDEX "relation_type_vaultId_idx" ON "relation_type"("vaultId");

-- CreateIndex
CREATE INDEX "relation_type_sourceTypeId_idx" ON "relation_type"("sourceTypeId");

-- CreateIndex
CREATE INDEX "relation_type_targetTypeId_idx" ON "relation_type"("targetTypeId");

-- CreateIndex
CREATE INDEX "entity_vaultId_typeId_idx" ON "entity"("vaultId", "typeId");

-- CreateIndex
CREATE INDEX "entity_vaultId_idx" ON "entity"("vaultId");

-- CreateIndex
CREATE INDEX "entity_typeId_idx" ON "entity"("typeId");

-- CreateIndex
CREATE UNIQUE INDEX "entity_vaultId_filePath_key" ON "entity"("vaultId", "filePath");

-- CreateIndex
CREATE INDEX "relation_edge_sourceId_idx" ON "relation_edge"("sourceId");

-- CreateIndex
CREATE INDEX "relation_edge_targetId_idx" ON "relation_edge"("targetId");

-- CreateIndex
CREATE INDEX "relation_edge_relationTypeId_idx" ON "relation_edge"("relationTypeId");

-- CreateIndex
CREATE INDEX "relation_edge_sourceId_targetId_idx" ON "relation_edge"("sourceId", "targetId");

-- CreateIndex
CREATE INDEX "tag_vaultId_idx" ON "tag"("vaultId");

-- CreateIndex
CREATE INDEX "tag_vaultId_parentPath_idx" ON "tag"("vaultId", "parentPath");

-- CreateIndex
CREATE UNIQUE INDEX "tag_vaultId_path_key" ON "tag"("vaultId", "path");

-- CreateIndex
CREATE INDEX "entity_tag_tagId_idx" ON "entity_tag"("tagId");

-- CreateIndex
CREATE INDEX "mention_sourceId_idx" ON "mention"("sourceId");

-- CreateIndex
CREATE INDEX "mention_targetId_idx" ON "mention"("targetId");

-- CreateIndex
CREATE INDEX "view_vaultId_idx" ON "view"("vaultId");

-- CreateIndex
CREATE INDEX "view_vaultId_entityTypeId_idx" ON "view"("vaultId", "entityTypeId");

-- CreateIndex
CREATE INDEX "template_vaultId_idx" ON "template"("vaultId");

-- CreateIndex
CREATE INDEX "automation_vaultId_idx" ON "automation"("vaultId");

-- CreateIndex
CREATE INDEX "automation_vaultId_kind_idx" ON "automation"("vaultId", "kind");

-- CreateIndex
CREATE INDEX "automation_status_nextRunAt_idx" ON "automation"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "automation_run_automationId_idx" ON "automation_run"("automationId");

-- CreateIndex
CREATE INDEX "automation_run_automationId_createdAt_idx" ON "automation_run"("automationId", "createdAt");

-- CreateIndex
CREATE INDEX "formula_vaultId_idx" ON "formula"("vaultId");

-- CreateIndex
CREATE UNIQUE INDEX "formula_vaultId_name_key" ON "formula"("vaultId", "name");

-- CreateIndex
CREATE INDEX "workflow_vaultId_idx" ON "workflow"("vaultId");

-- CreateIndex
CREATE INDEX "workflow_entityTypeId_idx" ON "workflow"("entityTypeId");

-- CreateIndex
CREATE INDEX "git_commit_vaultId_idx" ON "git_commit"("vaultId");

-- CreateIndex
CREATE INDEX "git_commit_entityId_idx" ON "git_commit"("entityId");

-- CreateIndex
CREATE INDEX "git_commit_sha_idx" ON "git_commit"("sha");

-- CreateIndex
CREATE INDEX "plugin_vaultId_idx" ON "plugin"("vaultId");

-- CreateIndex
CREATE UNIQUE INDEX "plugin_vaultId_slug_key" ON "plugin"("vaultId", "slug");

-- CreateIndex
CREATE INDEX "setting_vaultId_idx" ON "setting"("vaultId");

-- CreateIndex
CREATE UNIQUE INDEX "setting_vaultId_key_key" ON "setting"("vaultId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "embedding_entityId_key" ON "embedding"("entityId");

-- CreateIndex
CREATE INDEX "embedding_entityId_idx" ON "embedding"("entityId");

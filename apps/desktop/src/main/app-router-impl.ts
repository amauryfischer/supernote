/**
 * appRouterImpl — Concrete tRPC router for the desktop main process.
 *
 * Reuses the tRPC instance and publicProcedure from @supernote/ipc so that
 * the IpcContext generic matches the contracts defined there.
 * Runtime services (VaultManager, PrismaClient, FileWatcher) are accessed
 * via the service-registry module singleton.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { shell, dialog, app as electronApp } from "electron";
import { ulid } from "ulid";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

import { router, publicProcedure } from "@supernote/ipc";
import {
  OpenVaultInput,
  CloseVaultInput,
  AddVaultInput,
  RemoveVaultInput,
  VaultSchema,
  ListVaultsOutput,
  GetCurrentVaultOutput,
  ListEntitiesInput,
  ListEntitiesOutput,
  GetEntityInput,
  EntitySchema,
  CreateEntityInput,
  UpdateEntityInput,
  DeleteEntityInput,
  ListSchemasInput,
  ListSchemasOutput,
  GetSchemaInput,
  EntityTypeSchema,
  FieldDefinitionSchema,
  AppInfoSchema,
  OpenExternalInput,
  ShowInFolderInput,
  SelectFolderInput,
  SelectFolderOutput,
  SelectFileInput,
  SelectFileOutput,
  // Relations
  CreateRelationInput,
  DeleteRelationInput,
  ListRelationsForEntityInput,
  ListAllRelationsInput,
  RelationEdgeSchema,
  // Tags
  ListTagsInput,
  ListTagsOutput,
  GetHierarchyOutput,
  RenameTagInput,
  RenameTagOutput,
  DeleteTagInput,
  DeleteTagOutput,
  // Views
  ListViewsInput,
  ListViewsOutput,
  GetViewInput,
  ViewSchema,
  SaveViewInput,
  DeleteViewInput,
  // Automations
  ListAutomationsInput,
  ListAutomationsOutput,
  GetAutomationInput,
  AutomationSchema,
  CreateAutomationInput,
  UpdateAutomationInput,
  DeleteAutomationInput,
  RunAutomationInput,
  GetRunsInput,
  GetRunsOutput,
  AutomationRunSchema,
  ListRoutinesInput,
  ListRoutinesOutput,
  GetRoutineInput,
  RoutineSchema,
  CreateRoutineInput,
  UpdateRoutineInput,
  DeleteRoutineInput,
  GetNextRunsInput,
  GetNextRunsOutput,
  // Git
  GitStatusOutputSchema,
  GitHistoryInput,
  GitHistoryOutput,
  GitRestoreInput,
  GitRestoreOutput,
  GitSyncInput,
  GitSyncOutput,
  // Search
  QuerySearchInput,
  SemanticSearchInput,
  HybridSearchInput,
  SearchOutput,
} from "@supernote/ipc";
import { entityFilePath, serializeEntity } from "@supernote/core";
import {
  ftsQuery,
  indexEntity,
  removeFromFts,
  semanticQuery,
  hybridSearch,
  EmbeddingEngine,
  DEFAULT_MODEL,
} from "@supernote/search";
import { openRepo } from "@supernote/git";
import type { GitFileStatus as GitRepoFileStatus } from "@supernote/git";
import { getNextCronDates } from "@supernote/automations";

import {
  getVaultManager,
  getCurrentPrisma,
  getFileWatcher,
  getRawDb,
  setRawDb,
  getAutomationsRuntime,
  getNotificationsRuntime,
  getAutomationEngine,
} from "./services/service-registry.js";
import { writeEntity, deleteEntity, hashFile } from "./services/file-io.js";
import { openRawDb, closeRawDb } from "./services/raw-db.js";
import { reindexVault, reindexFile } from "./services/indexer.js";
import { logger } from "./logger.js";
import type { PrismaClient } from "@supernote/db";
import type { FieldDefinition } from "@supernote/ipc";
import type { Entity as CoreEntity, EntityType as CoreEntityType } from "@supernote/core";
import type { WatchEvent } from "./services/file-watcher.js";

// ── Type helpers ────────────────────────────────────────────────────────────

type FieldValuePrimitive = string | number | boolean | string[] | null;

function requirePrisma(): PrismaClient {
  const p = getCurrentPrisma();
  if (!p) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No vault is currently open" });
  return p;
}

function requireVaultId(): string {
  const v = getVaultManager().getCurrentVault();
  if (!v) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No vault is currently open" });
  return v.id;
}

function requireVaultPath(): string {
  const v = getVaultManager().getCurrentVault();
  if (!v) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No vault is currently open" });
  return v.path;
}

function parseEntityFields(raw: string): Record<string, FieldValuePrimitive> {
  try {
    return JSON.parse(raw) as Record<string, FieldValuePrimitive>;
  } catch {
    return {};
  }
}

function parseFieldDefs(raw: string): FieldDefinition[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: unknown) => FieldDefinitionSchema.parse(item));
  } catch {
    return [];
  }
}

interface RawEntityRow {
  id: string;
  typeId: string;
  filePath: string;
  fields: string;
  body: string | null;
  createdAt: Date;
  updatedAt: Date;
  entityType: { name: string };
  entityTags: Array<{ tag: { path: string } }>;
}

function mapEntityRow(e: RawEntityRow) {
  return {
    id: e.id,
    typeId: e.typeId,
    typeName: e.entityType.name,
    filePath: e.filePath,
    fields: parseEntityFields(e.fields),
    body: e.body ?? "",
    tags: e.entityTags.map((et) => et.tag.path),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

interface RawEntityTypeRow {
  id: string; name: string; plural: string; icon: string | null; color: string | null;
  fields: string; defaultPath: string | null; fileNamePattern: string | null;
  defaultView: string | null; createdAt: Date; updatedAt: Date;
}

function mapEntityTypeRow(et: RawEntityTypeRow) {
  return {
    id: et.id, name: et.name, plural: et.plural,
    icon: et.icon ?? undefined, color: et.color ?? undefined,
    fields: parseFieldDefs(et.fields),
    defaultPath: et.defaultPath ?? undefined,
    fileNamePattern: et.fileNamePattern ?? undefined,
    defaultView: et.defaultView ?? undefined,
    createdAt: et.createdAt.toISOString(), updatedAt: et.updatedAt.toISOString(),
  };
}

const ENTITY_INCLUDE = {
  entityType: { select: { name: true } },
  entityTags: { include: { tag: true } },
} as const;

// ── Watcher lifecycle helpers ───────────────────────────────────────────────

/** Wire the FileWatcher to the Indexer after a vault is opened. */
function startWatcherForVault(vaultId: string, vaultPath: string): void {
  const watcher = getFileWatcher();
  if (!watcher) return;

  // Stop any previous watch session
  watcher.stop();
  watcher.start(vaultPath);

  watcher.on("watch", (event: WatchEvent) => {
    const prisma = getCurrentPrisma();
    if (!prisma) return;

    if (event.type === "file:removed") {
      void reindexFile(prisma, vaultId, vaultPath, event.path).catch((err: unknown) => {
        logger.warn("Watcher: reindexFile (remove) failed", { path: event.path, err: String(err) });
      });
    } else if (event.type === "file:added" || event.type === "file:changed") {
      void reindexFile(prisma, vaultId, vaultPath, event.path).catch((err: unknown) => {
        logger.warn("Watcher: reindexFile failed", { path: event.path, err: String(err) });
      });
    }
  });
}

// ── Automation event emitters ───────────────────────────────────────────────

import type { DomainEvent, DomainEventType } from "@supernote/automations";

function emitAutomationEvent(type: DomainEventType, entity: CoreEntity, previous?: CoreEntity): void {
  const engine = getAutomationEngine();
  if (!engine) return;
  const event: DomainEvent = {
    type,
    entityId: entity.id,
    entityTypeId: entity.typeId,
    entity,
    previous,
    timestamp: new Date(),
  };
  void engine.emitEvent(event).catch((err: unknown) => {
    logger.warn("AutomationEngine.emitEvent failed", { type, entityId: entity.id, err: String(err) });
  });
}

// ── Build CoreEntity from DB row for use with @supernote/core serializers ──

function buildCoreEntity(
  row: { id: string; typeId: string; filePath: string; fields: string; body: string | null; createdAt: Date; updatedAt: Date },
  tags: string[] = [],
): CoreEntity {
  return {
    id: row.id,
    typeId: row.typeId,
    filePath: row.filePath,
    fields: parseEntityFields(row.fields) as Record<string, unknown> as CoreEntity["fields"],
    body: row.body ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    tags,
  };
}

function buildCoreEntityType(et: RawEntityTypeRow): CoreEntityType {
  return {
    id: et.id,
    name: et.name,
    plural: et.plural,
    icon: et.icon ?? undefined,
    color: et.color ?? undefined,
    fields: parseFieldDefs(et.fields) as unknown as CoreEntityType["fields"],
    defaultPath: et.defaultPath ?? et.name,
    fileNamePattern: et.fileNamePattern ?? "{id}",
    defaultView: undefined,
  };
}

// ── Vault router ───────────────────────────────────────────────────────────

const vaultRouter = router({
  open: publicProcedure
    .input(OpenVaultInput)
    .output(VaultSchema)
    .mutation(async (opts) => {
      // Close raw DB from any previous vault
      const prevDb = getRawDb();
      if (prevDb) {
        closeRawDb(prevDb);
        setRawDb(null);
      }

      try {
        const vault = await getVaultManager().openVault(opts.input.path);

        // Open raw DB for FTS operations
        const dbPath = path.join(vault.path, ".supernote", "index.db");
        const rawDb = openRawDb(dbPath);
        setRawDb(rawDb);

        const prisma = getCurrentPrisma()!;
        // Run full reindex then start watcher
        await reindexVault(prisma, vault.id, vault.path);
        startWatcherForVault(vault.id, vault.path);

        // Start notifications runtime — must be ready before automations (which may notify)
        const notifRuntime = getNotificationsRuntime();
        const notifService = notifRuntime?.startForVault(vault.path) ?? null;

        // Start automations runtime
        const automationsRt = getAutomationsRuntime();
        if (automationsRt) {
          void automationsRt.startForVault(vault, prisma, notifService).catch((err: unknown) => {
            logger.error("automations runtime start failed", { err: String(err) });
          });
        }

        return vault;
      } catch (err) {
        logger.error("vault.open failed", { err: String(err) });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(err) });
      }
    }),

  close: publicProcedure
    .input(CloseVaultInput)
    .output(VaultSchema)
    .mutation(async (opts) => {
      const vault = getVaultManager().listVaults().find((v) => v.id === opts.input.id);
      if (!vault) throw new TRPCError({ code: "NOT_FOUND", message: `Vault ${opts.input.id} not found` });

      // Stop watcher before closing vault
      getFileWatcher()?.stop();

      // Stop automations and notifications runtimes
      const automationsRt = getAutomationsRuntime();
      if (automationsRt) {
        await automationsRt.stopForVault().catch((err: unknown) => {
          logger.warn("automations runtime stop failed", { err: String(err) });
        });
      }
      getNotificationsRuntime()?.stopForVault();

      // Close raw DB
      const rawDb = getRawDb();
      if (rawDb) {
        closeRawDb(rawDb);
        setRawDb(null);
      }

      await getVaultManager().closeVault();
      return { ...vault, isActive: false, updatedAt: new Date().toISOString() };
    }),

  getCurrent: publicProcedure
    .output(GetCurrentVaultOutput)
    .query(() => getVaultManager().getCurrentVault()),

  listVaults: publicProcedure
    .output(ListVaultsOutput)
    .query(() => getVaultManager().listVaults()),

  addVault: publicProcedure
    .input(AddVaultInput)
    .output(VaultSchema)
    .mutation((opts) => {
      try {
        return getVaultManager().addVault(opts.input.path, opts.input.name);
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(err) });
      }
    }),

  removeVault: publicProcedure
    .input(RemoveVaultInput)
    .output(VaultSchema)
    .mutation((opts) => {
      try {
        return getVaultManager().removeVault(opts.input.id);
      } catch (err) {
        throw new TRPCError({ code: "NOT_FOUND", message: String(err) });
      }
    }),
});

// ── Entities router ────────────────────────────────────────────────────────

const entitiesRouter = router({
  list: publicProcedure
    .input(ListEntitiesInput)
    .output(ListEntitiesOutput)
    .query(async (opts) => {
      const prisma = requirePrisma();
      const vaultId = requireVaultId();
      const { typeId, typeName, limit, offset } = opts.input;

      const where: Record<string, unknown> = { vaultId };
      if (typeId) where["typeId"] = typeId;
      if (typeName) {
        const et = await prisma.entityType.findFirst({ where: { vaultId, name: typeName }, select: { id: true } });
        if (et) where["typeId"] = et.id;
      }

      const [rows, total] = await Promise.all([
        prisma.entity.findMany({ where, take: limit, skip: offset, orderBy: { createdAt: "desc" }, include: ENTITY_INCLUDE }),
        prisma.entity.count({ where }),
      ]);

      const rawRows = rows as unknown as RawEntityRow[];
      return {
        total,
        items: rawRows.map((row) => {
          const mapped = mapEntityRow(row);
          return {
            id: mapped.id, typeId: mapped.typeId, typeName: mapped.typeName,
            filePath: mapped.filePath, fields: mapped.fields, tags: mapped.tags,
            createdAt: mapped.createdAt, updatedAt: mapped.updatedAt,
          };
        }),
      };
    }),

  get: publicProcedure
    .input(GetEntityInput)
    .output(EntitySchema)
    .query(async (opts) => {
      const prisma = requirePrisma();
      const row = await prisma.entity.findUnique({ where: { id: opts.input.id }, include: ENTITY_INCLUDE });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Entity ${opts.input.id} not found` });
      return mapEntityRow(row as unknown as RawEntityRow);
    }),

  create: publicProcedure
    .input(CreateEntityInput)
    .output(EntitySchema)
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const vaultId = requireVaultId();
      const vaultPath = requireVaultPath();
      const { typeId, fields, body, tags: _tags } = opts.input;

      // Resolve entity type
      const etRow = await prisma.entityType.findUnique({
        where: { id: typeId },
        select: { id: true, name: true, plural: true, icon: true, color: true, fields: true, defaultPath: true, fileNamePattern: true, defaultView: true, createdAt: true, updatedAt: true },
      });
      if (!etRow) throw new TRPCError({ code: "NOT_FOUND", message: `EntityType ${typeId} not found` });

      const id = ulid();
      const now = new Date();

      // Build core entity for path resolution and serialization
      const coreEt = buildCoreEntityType(etRow as unknown as RawEntityTypeRow);
      const partialEntity: CoreEntity = {
        id,
        typeId,
        filePath: "",
        fields: (fields ?? {}) as CoreEntity["fields"],
        body: body ?? "",
        createdAt: now,
        updatedAt: now,
      };

      // Compute file path using core helper
      const resolvedFilePath = entityFilePath(partialEntity, coreEt, vaultPath);
      const fullEntity: CoreEntity = { ...partialEntity, filePath: resolvedFilePath };

      // Serialize to markdown
      const content = serializeEntity(fullEntity, coreEt);
      const fileHash = crypto.createHash("sha256").update(content, "utf-8").digest("hex");

      // Register own write to prevent watcher loopback
      getFileWatcher()?.registerOwnWrite(resolvedFilePath, fileHash);

      // Write file first — if this fails, we do NOT create the DB row
      await writeEntity(resolvedFilePath, { id, type: coreEt.name, created: now.toISOString(), updated: now.toISOString(), fields: fields ?? {} }, body ?? "");

      // Write to DB
      let row: RawEntityRow;
      try {
        const created = await prisma.entity.create({
          data: {
            id,
            vaultId,
            typeId,
            filePath: resolvedFilePath,
            fields: JSON.stringify(fields ?? {}),
            body: body ?? "",
            fileHash,
          },
          include: ENTITY_INCLUDE,
        });
        row = created as unknown as RawEntityRow;
      } catch (err) {
        // Rollback: attempt to delete the written file
        logger.error("entities.create: DB insert failed, rolling back file write", { id, err: String(err) });
        try {
          await deleteEntity(resolvedFilePath, false);
        } catch (cleanupErr) {
          logger.warn("entities.create: rollback file delete failed", { err: String(cleanupErr) });
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to create entity: ${String(err)}` });
      }

      // Update FTS index
      const rawDb = getRawDb();
      if (rawDb) {
        try {
          indexEntity(rawDb, buildCoreEntity(row, []), coreEt);
        } catch (err) {
          logger.warn("entities.create: FTS indexing failed (non-fatal)", { id, err: String(err) });
        }
      }

      // Emit automation domain event (fire-and-forget, non-fatal)
      emitAutomationEvent("entity.created", buildCoreEntity(row, []));

      return mapEntityRow(row);
    }),

  update: publicProcedure
    .input(UpdateEntityInput)
    .output(EntitySchema)
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const { id, fields, body } = opts.input;

      const existing = await prisma.entity.findUnique({ where: { id }, include: ENTITY_INCLUDE });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: `Entity ${id} not found` });

      const existingRow = existing as unknown as RawEntityRow;
      const etRow = await prisma.entityType.findUnique({
        where: { id: existingRow.typeId },
        select: { id: true, name: true, plural: true, icon: true, color: true, fields: true, defaultPath: true, fileNamePattern: true, defaultView: true, createdAt: true, updatedAt: true },
      });

      const now = new Date();
      const updatedFields = fields ?? parseEntityFields(existingRow.fields);
      const updatedBody = body ?? existingRow.body ?? "";

      // Serialize and write the file atomically
      if (etRow) {
        const coreEt = buildCoreEntityType(etRow as unknown as RawEntityTypeRow);
        const coreEntity: CoreEntity = {
          id: existingRow.id,
          typeId: existingRow.typeId,
          filePath: existingRow.filePath,
          fields: updatedFields as CoreEntity["fields"],
          body: updatedBody,
          createdAt: existingRow.createdAt,
          updatedAt: now,
          tags: existingRow.entityTags.map((et) => et.tag.path),
        };
        const content = serializeEntity(coreEntity, coreEt);
        const fileHash = crypto.createHash("sha256").update(content, "utf-8").digest("hex");
        getFileWatcher()?.registerOwnWrite(existingRow.filePath, fileHash);
        await writeEntity(
          existingRow.filePath,
          { id: existingRow.id, type: coreEt.name, created: existingRow.createdAt.toISOString(), updated: now.toISOString(), fields: updatedFields },
          updatedBody,
        );
      }

      // Update DB
      const row = await prisma.entity.update({
        where: { id },
        data: {
          fields: fields ? JSON.stringify(fields) : undefined,
          body: updatedBody,
          updatedAt: now,
        },
        include: ENTITY_INCLUDE,
      });
      const updatedRow = row as unknown as RawEntityRow;

      // Update FTS
      const rawDb = getRawDb();
      if (rawDb && etRow) {
        const coreEt = buildCoreEntityType(etRow as unknown as RawEntityTypeRow);
        try {
          indexEntity(rawDb, buildCoreEntity(updatedRow, updatedRow.entityTags.map((et) => et.tag.path)), coreEt);
        } catch (err) {
          logger.warn("entities.update: FTS update failed (non-fatal)", { id, err: String(err) });
        }
      }

      // Emit automation domain event (fire-and-forget, non-fatal)
      emitAutomationEvent(
        "entity.updated",
        buildCoreEntity(updatedRow, updatedRow.entityTags.map((et) => et.tag.path)),
        buildCoreEntity(existingRow, existingRow.entityTags.map((et) => et.tag.path)),
      );

      return mapEntityRow(updatedRow);
    }),

  delete: publicProcedure
    .input(DeleteEntityInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const { id } = opts.input;

      const existing = await prisma.entity.findUnique({ where: { id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: `Entity ${id} not found` });

      const filePath = (existing as unknown as { filePath: string }).filePath;

      // Move file to OS trash first
      await deleteEntity(filePath, true);

      // Remove from DB (cascades to EntityTag, Mention, etc.)
      await prisma.entity.delete({ where: { id } });

      // Remove from FTS
      const rawDb = getRawDb();
      if (rawDb) {
        try {
          removeFromFts(rawDb, id);
        } catch (err) {
          logger.warn("entities.delete: FTS remove failed (non-fatal)", { id, err: String(err) });
        }
      }

      // Emit automation domain event (fire-and-forget, non-fatal)
      emitAutomationEvent("entity.deleted", buildCoreEntity(existing as unknown as { id: string; typeId: string; filePath: string; fields: string; body: string | null; createdAt: Date; updatedAt: Date }, []));

      logger.info("entities.delete", { id, filePath });
      return { id, deleted: true };
    }),

  search: publicProcedure
    .input(z.object({
      query: z.string().min(1),
      typeId: z.string().optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().int().positive().max(200).default(20),
    }))
    .output(z.object({
      items: z.array(EntitySchema.omit({ body: true })),
      total: z.number().int().nonnegative(),
    }))
    .query(async (opts) => {
      const prisma = requirePrisma();
      const rawDb = getRawDb();

      if (!rawDb) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No vault open for search" });
      }

      const { query, typeId, limit } = opts.input;
      const results = ftsQuery(rawDb, query, { limit, typeFilter: typeId });

      if (results.length === 0) {
        return { items: [], total: 0 };
      }

      const entityIds = results.map((r) => r.entityId);
      const rows = await prisma.entity.findMany({
        where: { id: { in: entityIds } },
        include: ENTITY_INCLUDE,
      });

      // Sort results in FTS rank order (preserving BM25 ranking)
      const rankMap = new Map(results.map((r, i) => [r.entityId, i]));
      const sortedRows = (rows as unknown as RawEntityRow[]).sort(
        (a, b) => (rankMap.get(a.id) ?? 9999) - (rankMap.get(b.id) ?? 9999),
      );

      const items = sortedRows.map((row) => {
        const mapped = mapEntityRow(row);
        return {
          id: mapped.id, typeId: mapped.typeId, typeName: mapped.typeName,
          filePath: mapped.filePath, fields: mapped.fields, tags: mapped.tags,
          createdAt: mapped.createdAt, updatedAt: mapped.updatedAt,
        };
      });

      return { items, total: items.length };
    }),

  getRelated: publicProcedure
    .input(z.object({ id: z.string().min(1), relationTypeId: z.string().optional() }))
    .output(z.object({
      items: z.array(EntitySchema.omit({ body: true })),
      total: z.number().int().nonnegative(),
    }))
    .query(async (opts) => {
      const prisma = requirePrisma();
      const { id, relationTypeId } = opts.input;

      const edgeWhere: Record<string, unknown> = {
        OR: [{ sourceId: id }, { targetId: id }],
      };
      if (relationTypeId) edgeWhere["relationTypeId"] = relationTypeId;

      const edges = await prisma.relationEdge.findMany({
        where: edgeWhere,
        select: { sourceId: true, targetId: true },
      });

      const relatedIds = [
        ...new Set(
          edges
            .flatMap((e: { sourceId: string; targetId: string }) => [e.sourceId, e.targetId])
            .filter((eid: string) => eid !== id),
        ),
      ];

      if (relatedIds.length === 0) return { items: [], total: 0 };

      const rows = await prisma.entity.findMany({
        where: { id: { in: relatedIds } },
        include: ENTITY_INCLUDE,
      });

      const items = (rows as unknown as RawEntityRow[]).map((row) => {
        const mapped = mapEntityRow(row);
        return {
          id: mapped.id, typeId: mapped.typeId, typeName: mapped.typeName,
          filePath: mapped.filePath, fields: mapped.fields, tags: mapped.tags,
          createdAt: mapped.createdAt, updatedAt: mapped.updatedAt,
        };
      });

      return { items, total: items.length };
    }),

  getBacklinks: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(z.array(z.object({
      sourceId: z.string(),
      sourceFilePath: z.string(),
      context: z.string().optional(),
    })))
    .query(async (opts) => {
      const prisma = requirePrisma();
      const { id } = opts.input;

      const mentions = await prisma.mention.findMany({
        where: { targetId: id },
        include: { source: { select: { id: true, filePath: true } } },
      });

      return mentions.map((m: { source: { id: string; filePath: string }; rawText: string }) => ({
        sourceId: m.source.id,
        sourceFilePath: m.source.filePath,
        context: m.rawText,
      }));
    }),
});

// ── Schemas router ─────────────────────────────────────────────────────────

const schemasRouter = router({
  list: publicProcedure
    .input(ListSchemasInput)
    .output(ListSchemasOutput)
    .query(async (opts) => {
      const prisma = requirePrisma();
      const vaultId = requireVaultId();
      const where: Record<string, unknown> = { vaultId };
      if (opts.input.search) where["name"] = { contains: opts.input.search };
      const rawRows = await prisma.entityType.findMany({ where, orderBy: { name: "asc" } });
      return (rawRows as unknown as RawEntityTypeRow[]).map((et) => mapEntityTypeRow(et));
    }),

  get: publicProcedure
    .input(GetSchemaInput)
    .output(EntityTypeSchema)
    .query(async (opts) => {
      const prisma = requirePrisma();
      const et = await prisma.entityType.findUnique({ where: { id: opts.input.id } });
      if (!et) throw new TRPCError({ code: "NOT_FOUND", message: `Schema ${opts.input.id} not found` });
      return mapEntityTypeRow(et as unknown as RawEntityTypeRow);
    }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1), plural: z.string().min(1),
      icon: z.string().optional(), color: z.string().optional(),
      fields: z.array(z.unknown()).optional(),
      defaultPath: z.string().optional(), fileNamePattern: z.string().optional(),
    }))
    .output(EntityTypeSchema)
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const vaultId = requireVaultId();
      const id = ulid();
      const { name, plural, icon, color, fields, defaultPath, fileNamePattern } = opts.input;
      const et = await prisma.entityType.create({
        data: { id, vaultId, name, plural, icon, color, fields: JSON.stringify(fields ?? []), defaultPath, fileNamePattern },
      });
      return mapEntityTypeRow(et as unknown as RawEntityTypeRow);
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string().min(1), name: z.string().min(1).optional(),
      plural: z.string().min(1).optional(), icon: z.string().optional(),
      color: z.string().optional(), fields: z.array(z.unknown()).optional(),
      defaultPath: z.string().optional(), fileNamePattern: z.string().optional(),
      defaultView: z.string().optional(),
    }))
    .output(EntityTypeSchema)
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const { id, name, plural, icon, color, fields, defaultPath, fileNamePattern, defaultView } = opts.input;
      const et = await prisma.entityType.update({
        where: { id },
        data: { name, plural, icon, color, fields: fields ? JSON.stringify(fields) : undefined, defaultPath, fileNamePattern, defaultView },
      });
      return mapEntityTypeRow(et as unknown as RawEntityTypeRow);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const count = await prisma.entity.count({ where: { typeId: opts.input.id } });
      if (count > 0) throw new TRPCError({ code: "CONFLICT", message: `Cannot delete: ${count} entities use this schema` });
      await prisma.entityType.delete({ where: { id: opts.input.id } });
      return { id: opts.input.id, deleted: true };
    }),

  validate: publicProcedure
    .input(z.object({ schemaId: z.string().min(1), fields: z.record(z.string(), z.unknown()) }))
    .output(z.object({ valid: z.boolean(), errors: z.array(z.object({ field: z.string(), message: z.string() })) }))
    .query(() => ({ valid: true, errors: [] })), // TODO: full field validation via @supernote/core
});

// ── System router ──────────────────────────────────────────────────────────

const systemRouter = router({
  getAppInfo: publicProcedure
    .output(AppInfoSchema)
    .query(() => ({
      appName: electronApp.getName(),
      version: electronApp.getVersion(),
      electronVersion: process.versions["electron"] ?? "unknown",
      nodeVersion: process.versions.node,
      platform: process.platform as "darwin" | "win32" | "linux",
      arch: process.arch,
      userDataPath: electronApp.getPath("userData"),
      locale: electronApp.getLocale(),
    })),

  openExternal: publicProcedure
    .input(OpenExternalInput)
    .output(z.object({ success: z.boolean() }))
    .mutation(async (opts) => {
      await shell.openExternal(opts.input.url);
      return { success: true };
    }),

  showInFolder: publicProcedure
    .input(ShowInFolderInput)
    .output(z.object({ success: z.boolean() }))
    .mutation((opts) => {
      shell.showItemInFolder(opts.input.path);
      return { success: true };
    }),

  picker: router({
    selectFolder: publicProcedure
      .input(SelectFolderInput)
      .output(SelectFolderOutput)
      .mutation(async (opts) => {
        const result = await dialog.showOpenDialog({
          title: opts.input.title,
          defaultPath: opts.input.defaultPath,
          properties: ["openDirectory", "createDirectory"],
        });
        return { path: result.canceled ? null : (result.filePaths[0] ?? null) };
      }),

    selectFile: publicProcedure
      .input(SelectFileInput)
      .output(SelectFileOutput)
      .mutation(async (opts) => {
        const props: Array<"openFile" | "multiSelections"> = ["openFile"];
        if (opts.input.multiSelections) props.push("multiSelections");
        const result = await dialog.showOpenDialog({
          title: opts.input.title,
          defaultPath: opts.input.defaultPath,
          filters: opts.input.filters,
          properties: props,
        });
        return { paths: result.canceled ? [] : result.filePaths };
      }),
  }),
});

// ── Relations router ───────────────────────────────────────────────────────

interface RawRelationEdgeRow {
  id: string;
  sourceId: string;
  targetId: string;
  relationTypeId: string;
  fields: string;
  createdAt: Date;
  relationType: { forwardLabel: string };
}

function mapRelationEdge(r: RawRelationEdgeRow) {
  return {
    id: r.id,
    relationTypeId: r.relationTypeId,
    relationTypeName: r.relationType.forwardLabel,
    sourceId: r.sourceId,
    targetId: r.targetId,
    fields: r.fields ? (JSON.parse(r.fields) as Record<string, unknown>) : undefined,
    createdAt: r.createdAt.toISOString(),
  };
}

const EDGE_INCLUDE = { relationType: { select: { forwardLabel: true } } } as const;

const relationsRouter = router({
  create: publicProcedure
    .input(CreateRelationInput)
    .output(RelationEdgeSchema)
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const { relationTypeId, sourceId, targetId, fields } = opts.input;
      const id = ulid();
      const row = await prisma.relationEdge.create({
        data: { id, sourceId, targetId, relationTypeId, fields: JSON.stringify(fields ?? {}) },
        include: EDGE_INCLUDE,
      });
      const mapped = mapRelationEdge(row as unknown as RawRelationEdgeRow);

      // Emit relation.created event to AutomationEngine (fire-and-forget)
      const engine = getAutomationEngine();
      if (engine) {
        const relation = { id, sourceId, targetId, relationTypeId, fields: fields as import("@supernote/core").RelationEdge["fields"], createdAt: new Date() };
        void engine.emitEvent({ type: "relation.created", relation, timestamp: new Date() }).catch((err: unknown) => {
          logger.warn("AutomationEngine.emitEvent(relation.created) failed", { id, err: String(err) });
        });
      }

      return mapped;
    }),

  delete: publicProcedure
    .input(DeleteRelationInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const existing = await prisma.relationEdge.findUnique({ where: { id: opts.input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: `RelationEdge ${opts.input.id} not found` });
      await prisma.relationEdge.delete({ where: { id: opts.input.id } });
      return { id: opts.input.id, deleted: true };
    }),

  listForEntity: publicProcedure
    .input(ListRelationsForEntityInput)
    .output(z.array(RelationEdgeSchema))
    .query(async (opts) => {
      const prisma = requirePrisma();
      const { entityId, relationTypeId, direction } = opts.input;
      const dirFilter =
        direction === "source" ? [{ sourceId: entityId }]
        : direction === "target" ? [{ targetId: entityId }]
        : [{ sourceId: entityId }, { targetId: entityId }];
      const where: Record<string, unknown> = { OR: dirFilter };
      if (relationTypeId) where["relationTypeId"] = relationTypeId;
      const rows = await prisma.relationEdge.findMany({ where, include: EDGE_INCLUDE });
      return (rows as unknown as RawRelationEdgeRow[]).map(mapRelationEdge);
    }),

  listAll: publicProcedure
    .input(ListAllRelationsInput)
    .output(z.array(RelationEdgeSchema))
    .query(async (opts) => {
      const prisma = requirePrisma();
      const { relationTypeId, limit, offset } = opts.input;
      const where: Record<string, unknown> = {};
      if (relationTypeId) where["relationTypeId"] = relationTypeId;
      const rows = await prisma.relationEdge.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { createdAt: "desc" },
        include: EDGE_INCLUDE,
      });
      return (rows as unknown as RawRelationEdgeRow[]).map(mapRelationEdge);
    }),
});

// ── Tags router ────────────────────────────────────────────────────────────

interface RawTagRow {
  id: string;
  path: string;
  label: string;
  parentPath: string | null;
  color: string | null;
  vaultId: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { entityTags: number };
}

import type { TagNode } from "@supernote/ipc";

function buildTagTree(tags: RawTagRow[]): TagNode[] {
  const map = new Map<string, TagNode>();
  for (const t of tags) {
    map.set(t.path, { name: t.label, path: t.path, count: t._count.entityTags, children: [] });
  }
  const roots: TagNode[] = [];
  for (const t of tags) {
    const node = map.get(t.path)!;
    if (t.parentPath && map.has(t.parentPath)) {
      map.get(t.parentPath)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

const tagsRouter = router({
  list: publicProcedure
    .input(ListTagsInput)
    .output(ListTagsOutput)
    .query(async (opts) => {
      const prisma = requirePrisma();
      const vaultId = requireVaultId();
      const { search, prefix } = opts.input;
      const where: Record<string, unknown> = { vaultId };
      if (search) where["path"] = { contains: search };
      if (prefix) where["path"] = { startsWith: prefix };
      const rows = await prisma.tag.findMany({
        where,
        orderBy: { path: "asc" },
        include: { _count: { select: { entityTags: true } } },
      });
      return (rows as unknown as RawTagRow[]).map((t) => ({
        id: t.id,
        name: t.label,
        path: t.path,
        count: t._count.entityTags,
      }));
    }),

  getHierarchy: publicProcedure
    .output(GetHierarchyOutput)
    .query(async () => {
      const prisma = requirePrisma();
      const vaultId = requireVaultId();
      const rows = await prisma.tag.findMany({
        where: { vaultId },
        orderBy: { path: "asc" },
        include: { _count: { select: { entityTags: true } } },
      });
      return buildTagTree(rows as unknown as RawTagRow[]);
    }),

  rename: publicProcedure
    .input(RenameTagInput)
    .output(RenameTagOutput)
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const vaultId = requireVaultId();
      const { oldPath, newPath } = opts.input;
      const tags = await prisma.tag.findMany({
        where: { vaultId, OR: [{ path: oldPath }, { path: { startsWith: `${oldPath}/` } }] },
      });
      let affected = 0;
      for (const tag of tags) {
        const updatedPath = tag.path === oldPath ? newPath : newPath + tag.path.slice(oldPath.length);
        const parts = updatedPath.split("/");
        const newLabel = parts[parts.length - 1] ?? tag.label;
        const newParentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
        await prisma.tag.update({
          where: { id: tag.id },
          data: { path: updatedPath, label: newLabel, parentPath: newParentPath },
        });
        affected++;
      }
      return { affected };
    }),

  delete: publicProcedure
    .input(DeleteTagInput)
    .output(DeleteTagOutput)
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const vaultId = requireVaultId();
      const { path: tagPath, recursive } = opts.input;
      const where: Record<string, unknown> = { vaultId };
      if (recursive) {
        where["OR"] = [{ path: tagPath }, { path: { startsWith: `${tagPath}/` } }];
      } else {
        where["path"] = tagPath;
      }
      const result = await prisma.tag.deleteMany({ where });
      return { affected: result.count };
    }),
});

// ── Views router ───────────────────────────────────────────────────────────

function viewsDir(vaultPath: string): string {
  return path.join(vaultPath, ".supernote", "views");
}

interface ViewFile {
  id: string;
  name: string;
  type: string;
  typeId?: string;
  config: Record<string, unknown>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

async function readViewFile(filePath: string): Promise<ViewFile | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as ViewFile;
  } catch {
    return null;
  }
}

async function writeViewFile(dir: string, view: ViewFile): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${view.id}.json`), JSON.stringify(view, null, 2), "utf-8");
}

const viewsRouter = router({
  list: publicProcedure
    .input(ListViewsInput)
    .output(ListViewsOutput)
    .query(async (opts) => {
      const vaultPath = requireVaultPath();
      const dir = viewsDir(vaultPath);
      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        return [];
      }
      const views: ViewFile[] = [];
      for (const f of files.filter((n) => n.endsWith(".json"))) {
        const v = await readViewFile(path.join(dir, f));
        if (v) views.push(v);
      }
      const { typeId, viewType } = opts.input;
      return views
        .filter((v) => (!typeId || v.typeId === typeId) && (!viewType || v.type === viewType))
        .map((v) => ViewSchema.parse(v));
    }),

  get: publicProcedure
    .input(GetViewInput)
    .output(ViewSchema)
    .query(async (opts) => {
      const vaultPath = requireVaultPath();
      const filePath = path.join(viewsDir(vaultPath), `${opts.input.id}.json`);
      const v = await readViewFile(filePath);
      if (!v) throw new TRPCError({ code: "NOT_FOUND", message: `View ${opts.input.id} not found` });
      return ViewSchema.parse(v);
    }),

  save: publicProcedure
    .input(SaveViewInput)
    .output(ViewSchema)
    .mutation(async (opts) => {
      const vaultPath = requireVaultPath();
      const dir = viewsDir(vaultPath);
      const now = new Date().toISOString();
      const id = opts.input.id ?? ulid();
      const filePath = path.join(dir, `${id}.json`);
      const existing = await readViewFile(filePath);
      const view: ViewFile = {
        id,
        name: opts.input.name,
        type: opts.input.type,
        typeId: opts.input.typeId,
        config: opts.input.config as Record<string, unknown>,
        isDefault: opts.input.isDefault ?? false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await writeViewFile(dir, view);
      return ViewSchema.parse(view);
    }),

  delete: publicProcedure
    .input(DeleteViewInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(async (opts) => {
      const vaultPath = requireVaultPath();
      const filePath = path.join(viewsDir(vaultPath), `${opts.input.id}.json`);
      try {
        await fs.unlink(filePath);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: `View ${opts.input.id} not found` });
      }
      return { id: opts.input.id, deleted: true };
    }),
});

// ── Automations router ─────────────────────────────────────────────────────

interface RawAutomationRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  status: string;
  trigger: string;
  conditions: string;
  actions: string;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface RawAutomationRunRow {
  id: string;
  automationId: string;
  status: string;
  triggerPayload: string;
  actionResults: string;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: Date;
}

function mapDbTriggerToIpc(raw: string): z.infer<typeof AutomationSchema>["trigger"] {
  try {
    const t = JSON.parse(raw) as Record<string, unknown>;
    return {
      type: (t["type"] as string) as z.infer<typeof AutomationSchema>["trigger"]["type"] ?? "manual",
      entityTypeId: t["entityTypeId"] as string | undefined,
      cron: t["cron"] as string | undefined,
      alarmField: t["alarmField"] as string | undefined,
      alarmOffsetDays: t["alarmOffsetDays"] as number | undefined,
    };
  } catch {
    return { type: "manual" };
  }
}

function mapDbActionsToIpc(raw: string): z.infer<typeof AutomationSchema>["actions"] {
  try {
    const arr = JSON.parse(raw) as Array<Record<string, unknown>>;
    if (!Array.isArray(arr)) return [];
    return arr.map((a) => ({
      type: (a["type"] as string) as z.infer<typeof AutomationSchema>["actions"][number]["type"],
      config: (a["config"] as Record<string, unknown>) ?? {},
    }));
  } catch {
    return [];
  }
}

function mapAutomationRow(r: RawAutomationRow): z.infer<typeof AutomationSchema> {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? undefined,
    enabled: r.status === "ACTIVE",
    trigger: mapDbTriggerToIpc(r.trigger),
    conditions: r.conditions !== "[]" ? r.conditions : undefined,
    actions: mapDbActionsToIpc(r.actions),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function mapRoutineRow(r: RawAutomationRow): z.infer<typeof RoutineSchema> {
  const base = mapAutomationRow(r);
  const trigger = mapDbTriggerToIpc(r.trigger);
  return {
    ...base,
    recurrenceLabel: trigger.cron ?? undefined,
  };
}

function mapRunRow(r: RawAutomationRunRow): z.infer<typeof AutomationRunSchema> {
  return {
    id: r.id,
    automationId: r.automationId,
    status: r.status.toLowerCase() as z.infer<typeof AutomationRunSchema>["status"],
    triggeredAt: r.createdAt.toISOString(),
    durationMs: r.durationMs ?? undefined,
    error: r.errorMessage ?? undefined,
    payload: r.triggerPayload ? (JSON.parse(r.triggerPayload) as Record<string, unknown>) : undefined,
  };
}

const automationsRouter = router({
  list: publicProcedure
    .input(ListAutomationsInput)
    .output(ListAutomationsOutput)
    .query(async (opts) => {
      const prisma = requirePrisma();
      const vaultId = requireVaultId();
      const where: Record<string, unknown> = { vaultId, kind: "REACTIVE" };
      if (opts.input.enabled !== undefined) {
        where["status"] = opts.input.enabled ? "ACTIVE" : "INACTIVE";
      }
      const rows = await prisma.automation.findMany({ where, orderBy: { createdAt: "desc" } });
      return (rows as unknown as RawAutomationRow[]).map(mapAutomationRow);
    }),

  get: publicProcedure
    .input(GetAutomationInput)
    .output(AutomationSchema)
    .query(async (opts) => {
      const prisma = requirePrisma();
      const row = await prisma.automation.findUnique({ where: { id: opts.input.id } });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Automation ${opts.input.id} not found` });
      return mapAutomationRow(row as unknown as RawAutomationRow);
    }),

  create: publicProcedure
    .input(CreateAutomationInput)
    .output(AutomationSchema)
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const vaultId = requireVaultId();
      const id = ulid();
      const { name, description, enabled, trigger, conditions, actions } = opts.input;
      const row = await prisma.automation.create({
        data: {
          id, vaultId, name,
          description: description ?? null,
          kind: "REACTIVE",
          status: enabled ? "ACTIVE" : "INACTIVE",
          trigger: JSON.stringify(trigger),
          conditions: conditions ? JSON.stringify(conditions) : "[]",
          actions: JSON.stringify(actions),
        },
      });
      return mapAutomationRow(row as unknown as RawAutomationRow);
    }),

  update: publicProcedure
    .input(UpdateAutomationInput)
    .output(AutomationSchema)
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const { id, name, description, enabled, trigger, conditions, actions } = opts.input;
      const row = await prisma.automation.update({
        where: { id },
        data: {
          name: name ?? undefined,
          description: description !== undefined ? description ?? null : undefined,
          status: enabled !== undefined ? (enabled ? "ACTIVE" : "INACTIVE") : undefined,
          trigger: trigger ? JSON.stringify(trigger) : undefined,
          conditions: conditions !== undefined ? JSON.stringify(conditions) : undefined,
          actions: actions ? JSON.stringify(actions) : undefined,
        },
      });
      return mapAutomationRow(row as unknown as RawAutomationRow);
    }),

  delete: publicProcedure
    .input(DeleteAutomationInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const existing = await prisma.automation.findUnique({ where: { id: opts.input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: `Automation ${opts.input.id} not found` });
      await prisma.automation.delete({ where: { id: opts.input.id } });
      return { id: opts.input.id, deleted: true };
    }),

  run: publicProcedure
    .input(RunAutomationInput)
    .output(AutomationRunSchema)
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const { id, payload } = opts.input;
      const automation = await prisma.automation.findUnique({ where: { id } });
      if (!automation) throw new TRPCError({ code: "NOT_FOUND", message: `Automation ${id} not found` });

      const runId = ulid();
      const startedAt = Date.now();
      const runRow = await prisma.automationRun.create({
        data: {
          id: runId,
          automationId: id,
          status: "RUNNING",
          triggerPayload: JSON.stringify(payload ?? {}),
          actionResults: "[]",
        },
      });

      // Best-effort run — update status after
      try {
        await prisma.automationRun.update({
          where: { id: runId },
          data: { status: "SUCCESS", durationMs: Date.now() - startedAt },
        });
      } catch (err) {
        logger.warn("automations.run: failed to update run status", { runId, err: String(err) });
      }

      return mapRunRow({ ...runRow, status: "SUCCESS", durationMs: Date.now() - startedAt } as unknown as RawAutomationRunRow);
    }),

  getRuns: publicProcedure
    .input(GetRunsInput)
    .output(GetRunsOutput)
    .query(async (opts) => {
      const prisma = requirePrisma();
      const { automationId, limit, offset } = opts.input;
      const [rows, total] = await Promise.all([
        prisma.automationRun.findMany({
          where: { automationId },
          take: limit,
          skip: offset,
          orderBy: { createdAt: "desc" },
        }),
        prisma.automationRun.count({ where: { automationId } }),
      ]);
      return {
        items: (rows as unknown as RawAutomationRunRow[]).map(mapRunRow),
        total,
      };
    }),
});

// ── Routines router ────────────────────────────────────────────────────────

const routinesRouter = router({
  list: publicProcedure
    .input(ListRoutinesInput)
    .output(ListRoutinesOutput)
    .query(async (opts) => {
      const prisma = requirePrisma();
      const vaultId = requireVaultId();
      const where: Record<string, unknown> = { vaultId, kind: "ROUTINE" };
      if (opts.input.enabled !== undefined) {
        where["status"] = opts.input.enabled ? "ACTIVE" : "INACTIVE";
      }
      const rows = await prisma.automation.findMany({ where, orderBy: { createdAt: "desc" } });
      return (rows as unknown as RawAutomationRow[]).map(mapRoutineRow);
    }),

  get: publicProcedure
    .input(GetRoutineInput)
    .output(RoutineSchema)
    .query(async (opts) => {
      const prisma = requirePrisma();
      const row = await prisma.automation.findUnique({ where: { id: opts.input.id } });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Routine ${opts.input.id} not found` });
      return mapRoutineRow(row as unknown as RawAutomationRow);
    }),

  create: publicProcedure
    .input(CreateRoutineInput)
    .output(RoutineSchema)
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const vaultId = requireVaultId();
      const id = ulid();
      const { name, description, enabled, trigger, conditions, actions } = opts.input;
      const row = await prisma.automation.create({
        data: {
          id, vaultId, name,
          description: description ?? null,
          kind: "ROUTINE",
          status: enabled ? "ACTIVE" : "INACTIVE",
          trigger: JSON.stringify(trigger),
          conditions: conditions ? JSON.stringify(conditions) : "[]",
          actions: JSON.stringify(actions),
        },
      });
      return mapRoutineRow(row as unknown as RawAutomationRow);
    }),

  update: publicProcedure
    .input(UpdateRoutineInput)
    .output(RoutineSchema)
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const { id, name, description, enabled, trigger, conditions, actions } = opts.input;
      const row = await prisma.automation.update({
        where: { id },
        data: {
          name: name ?? undefined,
          description: description !== undefined ? description ?? null : undefined,
          status: enabled !== undefined ? (enabled ? "ACTIVE" : "INACTIVE") : undefined,
          trigger: trigger ? JSON.stringify(trigger) : undefined,
          conditions: conditions !== undefined ? JSON.stringify(conditions) : undefined,
          actions: actions ? JSON.stringify(actions) : undefined,
        },
      });
      return mapRoutineRow(row as unknown as RawAutomationRow);
    }),

  delete: publicProcedure
    .input(DeleteRoutineInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const existing = await prisma.automation.findUnique({ where: { id: opts.input.id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: `Routine ${opts.input.id} not found` });
      await prisma.automation.delete({ where: { id: opts.input.id } });
      return { id: opts.input.id, deleted: true };
    }),

  getNextRuns: publicProcedure
    .input(GetNextRunsInput)
    .output(GetNextRunsOutput)
    .query(async (opts) => {
      const prisma = requirePrisma();
      const row = await prisma.automation.findUnique({ where: { id: opts.input.id } });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: `Routine ${opts.input.id} not found` });

      const trigger = JSON.parse((row as unknown as RawAutomationRow).trigger) as Record<string, unknown>;
      if (trigger["type"] !== "cron" || !trigger["cron"]) return [];

      const dates = getNextCronDates(
        { expression: trigger["cron"] as string, timezone: trigger["timezone"] as string | undefined },
        opts.input.count,
      );
      return dates.map((d) => d.toISOString());
    }),
});

// ── Git router ─────────────────────────────────────────────────────────────

function mapGitFileStatus(status: string): "added" | "modified" | "deleted" | "renamed" | "untracked" {
  const map: Record<string, "added" | "modified" | "deleted" | "renamed" | "untracked"> = {
    added: "added", modified: "modified", deleted: "deleted",
    renamed: "renamed", unmerged: "modified", untracked: "untracked",
  };
  return map[status] ?? "modified";
}

const gitRouter = router({
  status: publicProcedure
    .output(GitStatusOutputSchema)
    .query(async () => {
      const vaultPath = requireVaultPath();
      const repo = openRepo(vaultPath);
      try {
        const s = await repo.status();
        const changes = [
          ...s.staged.map((f: GitRepoFileStatus) => ({ path: f.path, status: mapGitFileStatus(f.status) })),
          ...s.unstaged.map((f: GitRepoFileStatus) => ({ path: f.path, status: mapGitFileStatus(f.status) })),
          ...s.untracked.map((p: string) => ({ path: p, status: "untracked" as const })),
        ];
        // Deduplicate by path (prefer staged entry)
        const seen = new Set<string>();
        const deduped = changes.filter((c) => { if (seen.has(c.path)) return false; seen.add(c.path); return true; });
        return { ahead: 0, behind: 0, changes: deduped, hasRemote: false, branch: "main" };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `git status failed: ${String(err)}` });
      }
    }),

  history: publicProcedure
    .input(GitHistoryInput)
    .output(GitHistoryOutput)
    .query(async (opts) => {
      const vaultPath = requireVaultPath();
      const repo = openRepo(vaultPath);
      try {
        const commits = await repo.log({ path: opts.input.filePath, limit: opts.input.limit });
        return commits.map((c: import("@supernote/git").GitCommit) => ({
          oid: c.sha,
          message: c.message,
          author: { name: c.author.name, email: c.author.email },
          timestamp: Math.floor(c.date.getTime() / 1000),
          isoDate: c.date.toISOString(),
        }));
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `git history failed: ${String(err)}` });
      }
    }),

  restore: publicProcedure
    .input(GitRestoreInput)
    .output(GitRestoreOutput)
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const vaultPath = requireVaultPath();
      const { oid, entityId, filePath: inputFilePath } = opts.input;

      let resolvedPath = inputFilePath;
      if (!resolvedPath && entityId) {
        const e = await prisma.entity.findUnique({ where: { id: entityId }, select: { filePath: true } });
        if (!e) throw new TRPCError({ code: "NOT_FOUND", message: `Entity ${entityId} not found` });
        resolvedPath = e.filePath;
      }
      if (!resolvedPath) throw new TRPCError({ code: "BAD_REQUEST", message: "entityId or filePath required" });

      const repo = openRepo(vaultPath);
      const relPath = path.relative(vaultPath, resolvedPath);
      try {
        await repo.restore(oid, relPath);
        return { restored: true, filePath: resolvedPath };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `git restore failed: ${String(err)}` });
      }
    }),

  sync: publicProcedure
    .input(GitSyncInput)
    .output(GitSyncOutput)
    .mutation(async (opts) => {
      const vaultPath = requireVaultPath();
      const repo = openRepo(vaultPath);
      const remote = opts.input.remote ?? "origin";
      try {
        await repo.pull(remote);
        await repo.push(remote);
        return { pushed: 0, pulled: 0, conflicts: [] };
      } catch (err) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `git sync failed: ${String(err)}` });
      }
    }),
});

// ── Search router ──────────────────────────────────────────────────────────

/** Lazy singleton EmbeddingEngine — initialized on first semantic query. */
let _embedder: EmbeddingEngine | null = null;
function getEmbedder(): EmbeddingEngine {
  if (!_embedder) _embedder = new EmbeddingEngine(DEFAULT_MODEL);
  return _embedder;
}

async function enrichSearchResults(
  prisma: ReturnType<typeof requirePrisma>,
  hits: Array<{ entityId: string; typeId: string; title?: string; snippet?: string; rank?: number; combinedScore?: number; semantic?: boolean; similarity?: number }>,
): Promise<z.infer<typeof SearchOutput>["items"]> {
  if (hits.length === 0) return [];
  const ids = hits.map((h) => h.entityId);
  const rows = await prisma.entity.findMany({
    where: { id: { in: ids } },
    include: ENTITY_INCLUDE,
  });
  const rowMap = new Map((rows as unknown as RawEntityRow[]).map((r) => [r.id, r]));
  return hits.flatMap((h) => {
    const row = rowMap.get(h.entityId);
    if (!row) return [];
    const totalHits = hits.length;
    const idx = hits.indexOf(h);
    const score = h.combinedScore !== undefined ? Math.min(1, h.combinedScore)
      : h.similarity !== undefined ? h.similarity
      : h.rank !== undefined ? Math.max(0, 1 + h.rank / totalHits)
      : 1 - idx / totalHits;
    return [{
      entityId: h.entityId,
      typeId: row.typeId,
      typeName: row.entityType.name,
      filePath: row.filePath,
      title: h.title ?? (parseEntityFields(row.fields)["title"] as string) ?? row.filePath,
      excerpts: h.snippet ? [h.snippet] : [],
      score: Math.max(0, Math.min(1, score)),
      semantic: h.semantic ?? false,
      tags: row.entityTags.map((et) => et.tag.path),
    }];
  });
}

const searchRouter = router({
  query: publicProcedure
    .input(QuerySearchInput)
    .output(SearchOutput)
    .query(async (opts) => {
      const prisma = requirePrisma();
      const rawDb = getRawDb();
      if (!rawDb) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No vault open for search" });
      const t0 = Date.now();
      const { query, typeId, limit, offset } = opts.input;
      const results = ftsQuery(rawDb, query, { limit: limit + offset, typeFilter: typeId });
      const paged = results.slice(offset, offset + limit);
      const hits = paged.map((r) => ({ entityId: r.entityId, typeId: r.typeId, title: r.title, snippet: r.snippet, rank: r.rank }));
      const items = await enrichSearchResults(prisma, hits);
      return { items, total: results.length, durationMs: Date.now() - t0 };
    }),

  semantic: publicProcedure
    .input(SemanticSearchInput)
    .output(SearchOutput)
    .query(async (opts) => {
      const prisma = requirePrisma();
      const rawDb = getRawDb();
      if (!rawDb) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No vault open for search" });
      const t0 = Date.now();
      const { query, typeId, limit } = opts.input;
      const results = await semanticQuery(rawDb, query, getEmbedder(), { limit, typeFilter: typeId });
      const hits = results.map((r) => ({ entityId: r.entityId, typeId: r.typeId, similarity: r.similarity, semantic: true }));
      const items = await enrichSearchResults(prisma, hits);
      return { items, total: items.length, durationMs: Date.now() - t0 };
    }),

  hybrid: publicProcedure
    .input(HybridSearchInput)
    .output(SearchOutput)
    .query(async (opts) => {
      const prisma = requirePrisma();
      const rawDb = getRawDb();
      if (!rawDb) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No vault open for search" });
      const t0 = Date.now();
      const { query, typeId, limit, semanticWeight } = opts.input;
      const results = await hybridSearch(rawDb, getEmbedder(), query, {
        limit,
        semanticWeight,
        typeFilter: typeId,
      });
      const hits = results.map((r) => ({
        entityId: r.entityId,
        typeId: r.typeId,
        combinedScore: r.combinedScore,
        semantic: r.semanticSimilarity !== undefined,
      }));
      const items = await enrichSearchResults(prisma, hits);
      return { items, total: items.length, durationMs: Date.now() - t0 };
    }),
});

// ── Root router ────────────────────────────────────────────────────────────

export const appRouterImpl = router({
  vault: vaultRouter,
  entities: entitiesRouter,
  schemas: schemasRouter,
  relations: relationsRouter,
  tags: tagsRouter,
  views: viewsRouter,
  automations: automationsRouter,
  routines: routinesRouter,
  git: gitRouter,
  search: searchRouter,
  system: systemRouter,
});

export type AppRouterImpl = typeof appRouterImpl;

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
} from "@supernote/ipc";
import { entityFilePath, serializeEntity } from "@supernote/core";
import { ftsQuery, indexEntity, removeFromFts } from "@supernote/search";

import {
  getVaultManager,
  getCurrentPrisma,
  getFileWatcher,
  getRawDb,
  setRawDb,
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

// ── Not-implemented stub ───────────────────────────────────────────────────

function notYet(name: string) {
  return publicProcedure.query(() => {
    throw new TRPCError({ code: "METHOD_NOT_SUPPORTED", message: `${name} not yet implemented` });
  });
}

// ── Root router ────────────────────────────────────────────────────────────

export const appRouterImpl = router({
  vault: vaultRouter,
  entities: entitiesRouter,
  schemas: schemasRouter,
  relations: router({
    list: notYet("relations.list"),
    get: notYet("relations.get"),
    create: notYet("relations.create"),
    delete: notYet("relations.delete"),
  }),
  tags: router({
    list: notYet("tags.list"),
    get: notYet("tags.get"),
    create: notYet("tags.create"),
    delete: notYet("tags.delete"),
  }),
  views: router({
    list: notYet("views.list"),
    get: notYet("views.get"),
    create: notYet("views.create"),
    update: notYet("views.update"),
    delete: notYet("views.delete"),
  }),
  automations: router({ list: notYet("automations.list") }),
  routines: router({ list: notYet("routines.list") }),
  git: router({ log: notYet("git.log"), restore: notYet("git.restore") }),
  search: router({ query: notYet("search.query") }),
  system: systemRouter,
});

export type AppRouterImpl = typeof appRouterImpl;

/**
 * appRouterImpl — Concrete tRPC router for the desktop main process.
 *
 * Reuses the tRPC instance and publicProcedure from @supernote/ipc so that
 * the IpcContext generic matches the contracts defined there.
 * Runtime services (VaultManager, PrismaClient) are accessed via the
 * service-registry module singleton.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { shell, dialog, app as electronApp } from "electron";
import { ulid } from "ulid";

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

import { getVaultManager, getCurrentPrisma } from "./services/service-registry.js";
import { logger } from "./logger.js";
import type { PrismaClient } from "@supernote/db";
import type { FieldDefinition } from "@supernote/ipc";

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

// ── Vault router ───────────────────────────────────────────────────────────

const vaultRouter = router({
  open: publicProcedure
    .input(OpenVaultInput)
    .output(VaultSchema)
    .mutation(async (opts) => {
      try {
        return await getVaultManager().openVault(opts.input.path);
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
          // List output omits body
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

      const et = await prisma.entityType.findUnique({ where: { id: typeId }, select: { id: true, name: true, defaultPath: true } });
      if (!et) throw new TRPCError({ code: "NOT_FOUND", message: `EntityType ${typeId} not found` });

      const id = ulid();
      const now = new Date();
      const relPath = et.defaultPath ?? et.name;
      const filePath = `${vaultPath}/${relPath}/${id}.md`;

      const row = await prisma.entity.create({
        data: { id, vaultId, typeId, filePath, fields: JSON.stringify(fields), body: body ?? "" },
        include: ENTITY_INCLUDE,
      });
      const mapped = mapEntityRow(row as unknown as RawEntityRow);
      return { ...mapped, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    }),

  update: publicProcedure
    .input(UpdateEntityInput)
    .output(EntitySchema)
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const { id, fields, body } = opts.input;
      const existing = await prisma.entity.findUnique({ where: { id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: `Entity ${id} not found` });

      const row = await prisma.entity.update({
        where: { id },
        data: {
          fields: fields ? JSON.stringify(fields) : undefined,
          body: body ?? existing.body,
          updatedAt: new Date(),
        },
        include: ENTITY_INCLUDE,
      });
      return mapEntityRow(row as unknown as RawEntityRow);
    }),

  delete: publicProcedure
    .input(DeleteEntityInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(async (opts) => {
      const prisma = requirePrisma();
      const { id } = opts.input;
      const existing = await prisma.entity.findUnique({ where: { id } });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: `Entity ${id} not found` });
      // TODO: delete or trash the physical .md file via file-io
      await prisma.entity.delete({ where: { id } });
      logger.info("entities.delete", { id });
      return { id, deleted: true };
    }),

  search: publicProcedure
    .input(z.object({ query: z.string().min(1), typeId: z.string().optional(), tags: z.array(z.string()).optional(), limit: z.number().int().positive().max(200).default(20) }))
    .output(z.object({ items: z.array(EntitySchema.omit({ body: true })), total: z.number().int().nonnegative() }))
    .query(() => {
      // TODO: implement FTS5 virtual table search
      throw new TRPCError({ code: "METHOD_NOT_SUPPORTED", message: "entities.search: FTS not yet implemented" });
    }),

  getRelated: publicProcedure
    .input(z.object({ id: z.string().min(1), relationTypeId: z.string().optional() }))
    .output(z.object({ items: z.array(EntitySchema.omit({ body: true })), total: z.number().int().nonnegative() }))
    .query(() => {
      throw new TRPCError({ code: "METHOD_NOT_SUPPORTED", message: "entities.getRelated: not yet implemented" });
    }),

  getBacklinks: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .output(z.array(z.object({ sourceId: z.string(), sourceFilePath: z.string(), context: z.string().optional() })))
    .query(() => {
      throw new TRPCError({ code: "METHOD_NOT_SUPPORTED", message: "entities.getBacklinks: not yet implemented" });
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
    .input(z.object({ name: z.string().min(1), plural: z.string().min(1), icon: z.string().optional(), color: z.string().optional(), fields: z.array(z.unknown()).optional(), defaultPath: z.string().optional(), fileNamePattern: z.string().optional() }))
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
    .input(z.object({ id: z.string().min(1), name: z.string().min(1).optional(), plural: z.string().min(1).optional(), icon: z.string().optional(), color: z.string().optional(), fields: z.array(z.unknown()).optional(), defaultPath: z.string().optional(), fileNamePattern: z.string().optional(), defaultView: z.string().optional() }))
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

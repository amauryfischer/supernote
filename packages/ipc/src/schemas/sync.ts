import { z } from "zod";

/**
 * Worker-side RPC contracts for online realtime sync.
 *
 * These mirror the wire types in `@supernote/sync` (intentionally kept as a
 * standalone definition so this contracts package stays dependency-light).
 * The shapes MUST stay structurally identical to `@supernote/sync`'s
 * `EntityOp` / `EntityOpPayload`.
 */

export const SyncOpKindSchema = z.enum(["upsert", "delete"]);
export type SyncOpKind = z.infer<typeof SyncOpKindSchema>;

export const EntityOpPayloadSchema = z.object({
  id: z.string(),
  typeId: z.string(),
  typeName: z.string(),
  filePath: z.string(),
  fields: z.record(z.string(), z.unknown()),
  body: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EntityOpPayload = z.infer<typeof EntityOpPayloadSchema>;

export const EntityOpSchema = z.object({
  opId: z.string(),
  clientId: z.string(),
  kind: SyncOpKindSchema,
  entityId: z.string(),
  ts: z.number(),
  payload: EntityOpPayloadSchema.optional(),
});
export type EntityOp = z.infer<typeof EntityOpSchema>;

// ── sync.applyOps ─────────────────────────────────────────────────────────────

export const ApplyOpsInput = z.object({
  ops: z.array(EntityOpSchema),
  /** Provenance : présent quand l'appel vient d'un salon monté. */
  sourceVaultId: z.string().optional(),
});
export type ApplyOpsInput = z.infer<typeof ApplyOpsInput>;

export const ApplyOpsOutput = z.object({
  applied: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type ApplyOpsOutput = z.infer<typeof ApplyOpsOutput>;

// ── sync.snapshot ─────────────────────────────────────────────────────────────

export const SnapshotOutput = z.object({
  /** One `upsert` op per entity currently in the vault. */
  ops: z.array(EntityOpSchema),
  generatedAt: z.number(),
});
export type SnapshotOutput = z.infer<typeof SnapshotOutput>;

// ── sync.purgeMounted ──────────────────────────────────────────────────────────

export const PurgeMountedInput = z.object({ sourceVaultId: z.string() });
export type PurgeMountedInput = z.infer<typeof PurgeMountedInput>;

export const PurgeMountedOutput = z.object({
  removed: z.number().int().nonnegative(),
});
export type PurgeMountedOutput = z.infer<typeof PurgeMountedOutput>;

// ── sync.head ─────────────────────────────────────────────────────────────────

export const SyncHeadOutput = z.object({
  vaultId: z.string(),
  entityCount: z.number().int().nonnegative(),
});
export type SyncHeadOutput = z.infer<typeof SyncHeadOutput>;

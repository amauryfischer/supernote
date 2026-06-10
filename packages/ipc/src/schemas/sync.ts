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

// ── sync.head ─────────────────────────────────────────────────────────────────

export const SyncHeadOutput = z.object({
  vaultId: z.string(),
  entityCount: z.number().int().nonnegative(),
});
export type SyncHeadOutput = z.infer<typeof SyncHeadOutput>;

// ── sync.collectLocalChanges ───────────────────────────────────────────────────

export const CollectLocalChangesOutput = z.object({
  /**
   * Upsert ops for entities whose on-disk `.md` was modified OUTSIDE the app
   * (text editor, a folder-sync client like Google Drive bringing a peer's
   * file edit). The vault DB is reconciled as a side effect, and each op
   * carries the file's own `updatedAt` so the server resolves conflicts by
   * last-write-wins rather than boot time.
   */
  ops: z.array(EntityOpSchema),
  generatedAt: z.number(),
});
export type CollectLocalChangesOutput = z.infer<typeof CollectLocalChangesOutput>;

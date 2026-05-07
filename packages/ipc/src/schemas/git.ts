import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

export const GitFileStatusSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "untracked",
  "ignored",
]);
export type GitFileStatus = z.infer<typeof GitFileStatusSchema>;

export const GitFileChangeSchema = z.object({
  path: z.string(),
  status: GitFileStatusSchema,
  oldPath: z.string().optional(),
});
export type GitFileChange = z.infer<typeof GitFileChangeSchema>;

export const GitStatusOutputSchema = z.object({
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
  changes: z.array(GitFileChangeSchema),
  hasRemote: z.boolean(),
  branch: z.string(),
});
export type GitStatusOutput = z.infer<typeof GitStatusOutputSchema>;

export const GitCommitSchema = z.object({
  oid: z.string(),
  message: z.string(),
  author: z.object({
    name: z.string(),
    email: z.string(),
  }),
  timestamp: z.number().int(),
  isoDate: z.string().datetime(),
});
export type GitCommit = z.infer<typeof GitCommitSchema>;

// ── Input schemas ─────────────────────────────────────────────────────────────

export const GitHistoryInput = z.object({
  /** File path relative to vault root, or omit for global history */
  filePath: z.string().optional(),
  limit: z.number().int().positive().max(500).default(50),
});
export type GitHistoryInput = z.infer<typeof GitHistoryInput>;

export const GitRestoreInput = z.object({
  /** Entity id or file path */
  entityId: z.string().optional(),
  filePath: z.string().optional(),
  /** Commit OID to restore to */
  oid: z.string().min(1),
});
export type GitRestoreInput = z.infer<typeof GitRestoreInput>;

export const GitSyncInput = z.object({
  remote: z.string().optional(),
  branch: z.string().optional(),
});
export type GitSyncInput = z.infer<typeof GitSyncInput>;

// ── Output schemas ────────────────────────────────────────────────────────────

export const GitHistoryOutput = z.array(GitCommitSchema);
export type GitHistoryOutput = z.infer<typeof GitHistoryOutput>;

export const GitRestoreOutput = z.object({
  restored: z.boolean(),
  filePath: z.string(),
});
export type GitRestoreOutput = z.infer<typeof GitRestoreOutput>;

export const GitSyncOutput = z.object({
  pushed: z.number().int().nonnegative(),
  pulled: z.number().int().nonnegative(),
  conflicts: z.array(z.string()),
});
export type GitSyncOutput = z.infer<typeof GitSyncOutput>;

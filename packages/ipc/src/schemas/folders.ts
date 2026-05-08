import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

/**
 * Folder path validation: forbids leading/trailing slashes and ".." segments.
 * Empty strings are not allowed.
 */
export const FolderPath = z
  .string()
  .min(1)
  .refine((v) => !v.startsWith("/") && !v.endsWith("/"), {
    message: "Folder paths must not start or end with '/'",
  })
  .refine((v) => !v.split("/").includes(".."), {
    message: "Folder paths must not contain '..'",
  });
export type FolderPath = z.infer<typeof FolderPath>;

// ── Input schemas ─────────────────────────────────────────────────────────────

export const ListFoldersInput = z.void();
export type ListFoldersInput = z.infer<typeof ListFoldersInput>;

export const AddFolderInput = z.object({
  path: FolderPath,
});
export type AddFolderInput = z.infer<typeof AddFolderInput>;

export const RenameFolderInput = z.object({
  oldPath: FolderPath,
  newPath: FolderPath,
});
export type RenameFolderInput = z.infer<typeof RenameFolderInput>;

export const DeleteFolderInput = z.object({
  path: FolderPath,
});
export type DeleteFolderInput = z.infer<typeof DeleteFolderInput>;

/**
 * Update per-folder presentation metadata (color and/or icon).
 *
 * Both fields are optional: passing one without the other only patches the
 * provided field. Passing `null` (via the Zod nullable wrapper) clears it,
 * while `undefined` leaves the existing value untouched.
 */
export const UpdateFolderInput = z.object({
  path: FolderPath,
  color: z.string().nullish(),
  icon: z.string().nullish(),
});
export type UpdateFolderInput = z.infer<typeof UpdateFolderInput>;

// ── Output schemas ────────────────────────────────────────────────────────────

/**
 * A folder entry as returned by `vault.folders.list` and the mutation
 * outputs. The legacy on-disk format was a bare `string[]` of paths; we
 * now expose objects so the UI can attach a color and a custom icon to
 * each folder. The worker still accepts (and migrates) the bare-string
 * shape on read for backward-compat.
 */
export const FolderSchema = z.object({
  path: FolderPath,
  color: z.string().optional(),
  icon: z.string().optional(),
});
export type FolderSchema = z.infer<typeof FolderSchema>;

export const ListFoldersOutput = z.array(FolderSchema);
export type ListFoldersOutput = z.infer<typeof ListFoldersOutput>;

export const AddFolderOutput = z.array(FolderSchema);
export type AddFolderOutput = z.infer<typeof AddFolderOutput>;

export const RenameFolderOutput = z.array(FolderSchema);
export type RenameFolderOutput = z.infer<typeof RenameFolderOutput>;

export const DeleteFolderOutput = z.array(FolderSchema);
export type DeleteFolderOutput = z.infer<typeof DeleteFolderOutput>;

export const UpdateFolderOutput = z.array(FolderSchema);
export type UpdateFolderOutput = z.infer<typeof UpdateFolderOutput>;

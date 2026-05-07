import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

export const AppInfoSchema = z.object({
  appName: z.string(),
  version: z.string(),
  electronVersion: z.string(),
  nodeVersion: z.string(),
  platform: z.enum(["darwin", "win32", "linux"]),
  arch: z.string(),
  userDataPath: z.string(),
  locale: z.string(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export const FileFilterSchema = z.object({
  name: z.string(),
  extensions: z.array(z.string()),
});
export type FileFilter = z.infer<typeof FileFilterSchema>;

// ── Input schemas ─────────────────────────────────────────────────────────────

export const OpenExternalInput = z.object({
  url: z.string().url(),
});
export type OpenExternalInput = z.infer<typeof OpenExternalInput>;

export const ShowInFolderInput = z.object({
  path: z.string().min(1),
});
export type ShowInFolderInput = z.infer<typeof ShowInFolderInput>;

export const SelectFolderInput = z.object({
  title: z.string().optional(),
  defaultPath: z.string().optional(),
});
export type SelectFolderInput = z.infer<typeof SelectFolderInput>;

export const SelectFileInput = z.object({
  title: z.string().optional(),
  defaultPath: z.string().optional(),
  filters: z.array(FileFilterSchema).optional(),
  multiSelections: z.boolean().default(false),
});
export type SelectFileInput = z.infer<typeof SelectFileInput>;

// ── Output schemas ────────────────────────────────────────────────────────────

export const SelectFolderOutput = z.object({
  /** Null if the user cancelled the dialog */
  path: z.string().nullable(),
});
export type SelectFolderOutput = z.infer<typeof SelectFolderOutput>;

export const SelectFileOutput = z.object({
  /** Empty if the user cancelled the dialog */
  paths: z.array(z.string()),
});
export type SelectFileOutput = z.infer<typeof SelectFileOutput>;

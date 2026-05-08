import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  AddFolderInput,
  AddFolderOutput,
  DeleteFolderInput,
  DeleteFolderOutput,
  ListFoldersOutput,
  RenameFolderInput,
  RenameFolderOutput,
  UpdateFolderInput,
  UpdateFolderOutput,
} from "../schemas/folders.js";

/**
 * Folders sub-router (mounted under `vault.folders.*`).
 *
 * Folders are persisted in the `setting` table under the
 * `notes.folders` key as a JSON array of slash-separated path strings.
 * The effective folder list returned by `list` is the union of explicit
 * paths from that setting and folder paths derived from `entity.filePath`
 * of existing notes.
 */
export const foldersRouter = router({
  /** Returns the union of explicit folder paths and paths derived from notes. */
  list: publicProcedure
    .output(ListFoldersOutput)
    .query(() => {
      throw notImplemented("vault.folders.list");
    }),

  /** Idempotently adds a folder path. Returns the updated list. */
  add: publicProcedure
    .input(AddFolderInput)
    .output(AddFolderOutput)
    .mutation(() => {
      throw notImplemented("vault.folders.add");
    }),

  /** Renames a folder path (and rewrites entity filePaths under it). */
  rename: publicProcedure
    .input(RenameFolderInput)
    .output(RenameFolderOutput)
    .mutation(() => {
      throw notImplemented("vault.folders.rename");
    }),

  /** Removes a folder path from the explicit list. Notes are left untouched. */
  delete: publicProcedure
    .input(DeleteFolderInput)
    .output(DeleteFolderOutput)
    .mutation(() => {
      throw notImplemented("vault.folders.delete");
    }),

  /**
   * Patch the per-folder presentation metadata (color and/or icon).
   * Persists in the same `notes.folders` setting as the path list, by
   * normalizing the array to its object form on write.
   */
  update: publicProcedure
    .input(UpdateFolderInput)
    .output(UpdateFolderOutput)
    .mutation(() => {
      throw notImplemented("vault.folders.update");
    }),
});

export type FoldersRouter = typeof foldersRouter;

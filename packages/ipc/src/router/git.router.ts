import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  GitStatusOutputSchema,
  GitHistoryInput,
  GitHistoryOutput,
  GitRestoreInput,
  GitRestoreOutput,
  GitSyncInput,
  GitSyncOutput,
} from "../schemas/git.js";

export const gitRouter = router({
  /** Get the current git status of the vault (working tree changes, ahead/behind). */
  status: publicProcedure
    .output(GitStatusOutputSchema)
    .query(() => {
      throw notImplemented("git.status");
    }),

  /** Get commit history, optionally scoped to a single file. */
  history: publicProcedure
    .input(GitHistoryInput)
    .output(GitHistoryOutput)
    .query(() => {
      throw notImplemented("git.history");
    }),

  /** Restore a file to a specific commit. */
  restore: publicProcedure
    .input(GitRestoreInput)
    .output(GitRestoreOutput)
    .mutation(() => {
      throw notImplemented("git.restore");
    }),

  /** Pull + push with the configured remote. */
  sync: publicProcedure
    .input(GitSyncInput)
    .output(GitSyncOutput)
    .mutation(() => {
      throw notImplemented("git.sync");
    }),
});

export type GitRouter = typeof gitRouter;

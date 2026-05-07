import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  AppInfoSchema,
  OpenExternalInput,
  ShowInFolderInput,
  SelectFolderInput,
  SelectFolderOutput,
  SelectFileInput,
  SelectFileOutput,
} from "../schemas/system.js";
import { z } from "zod";

export const systemRouter = router({
  /** Get application metadata (version, platform, paths, etc.). */
  getAppInfo: publicProcedure
    .output(AppInfoSchema)
    .query(() => {
      throw notImplemented("system.getAppInfo");
    }),

  /** Open a URL in the system default browser. */
  openExternal: publicProcedure
    .input(OpenExternalInput)
    .output(z.object({ success: z.boolean() }))
    .mutation(() => {
      throw notImplemented("system.openExternal");
    }),

  /** Reveal a file or folder in the OS file manager. */
  showInFolder: publicProcedure
    .input(ShowInFolderInput)
    .output(z.object({ success: z.boolean() }))
    .mutation(() => {
      throw notImplemented("system.showInFolder");
    }),

  picker: router({
    /** Open a native folder picker dialog. */
    selectFolder: publicProcedure
      .input(SelectFolderInput)
      .output(SelectFolderOutput)
      .mutation(() => {
        throw notImplemented("system.picker.selectFolder");
      }),

    /** Open a native file picker dialog (supports multi-selection). */
    selectFile: publicProcedure
      .input(SelectFileInput)
      .output(SelectFileOutput)
      .mutation(() => {
        throw notImplemented("system.picker.selectFile");
      }),
  }),
});

export type SystemRouter = typeof systemRouter;

import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  OpenVaultInput,
  CloseVaultInput,
  AddVaultInput,
  RemoveVaultInput,
  VaultSchema,
  ListVaultsOutput,
  GetCurrentVaultOutput,
  ReadFileInput,
  ReadFileOutput,
  WriteFileInput,
  WriteFileOutput,
} from "../schemas/vault.js";
import { foldersRouter } from "./folders.router.js";

export const vaultRouter = router({
  /** Persistent, nestable folders for the Notes module. */
  folders: foldersRouter,

  /** Open a vault at the given path, creating it if it doesn't exist. */
  open: publicProcedure
    .input(OpenVaultInput)
    .output(VaultSchema)
    .mutation(() => {
      throw notImplemented("vault.open");
    }),

  /** Close the specified vault (removes it from the active set). */
  close: publicProcedure
    .input(CloseVaultInput)
    .output(VaultSchema)
    .mutation(() => {
      throw notImplemented("vault.close");
    }),

  /** Returns the currently active vault, or null if none is open. */
  getCurrent: publicProcedure
    .output(GetCurrentVaultOutput)
    .query(() => {
      throw notImplemented("vault.getCurrent");
    }),

  /** Lists all known vaults (open + recently used). */
  listVaults: publicProcedure
    .output(ListVaultsOutput)
    .query(() => {
      throw notImplemented("vault.listVaults");
    }),

  /** Register an existing vault directory without opening it. */
  addVault: publicProcedure
    .input(AddVaultInput)
    .output(VaultSchema)
    .mutation(() => {
      throw notImplemented("vault.addVault");
    }),

  /** Remove a vault from the registry (does not delete files). */
  removeVault: publicProcedure
    .input(RemoveVaultInput)
    .output(VaultSchema)
    .mutation(() => {
      throw notImplemented("vault.removeVault");
    }),

  /**
   * Read a file from the active vault by relative path. Used by the
   * attachment viewer layer (image/pdf/csv/…) which can't reach the FSA
   * handle directly — it lives inside the vault Web Worker.
   *
   * Returns the raw bytes plus, for text-encodable formats, the UTF-8
   * decoded body. Caller picks whichever is appropriate for its viewer.
   */
  readFile: publicProcedure
    .input(ReadFileInput)
    .output(ReadFileOutput)
    .query(() => {
      throw notImplemented("vault.readFile");
    }),

  /**
   * Write raw bytes back to a vault file. Used by attachment editors
   * (CSV, XLSX) to persist user edits to the original binary file.
   *
   * Concurrency-safe: the worker serialises per-path through the same
   * mutex that protects `entitiesUpdate`, so back-to-back debounced saves
   * from a fast-typing user don't race on FSA `createWritable`.
   */
  writeFile: publicProcedure
    .input(WriteFileInput)
    .output(WriteFileOutput)
    .mutation(() => {
      throw notImplemented("vault.writeFile");
    }),
});

export type VaultRouter = typeof vaultRouter;

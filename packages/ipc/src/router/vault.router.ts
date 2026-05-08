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
});

export type VaultRouter = typeof vaultRouter;

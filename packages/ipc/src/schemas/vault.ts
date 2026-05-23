import { z } from "zod";

// ── Shared primitives ────────────────────────────────────────────────────────

export const VaultId = z.string().ulid();
export type VaultId = z.infer<typeof VaultId>;

export const VaultSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  path: z.string().min(1),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Vault = z.infer<typeof VaultSchema>;

// ── Input schemas ─────────────────────────────────────────────────────────────

export const OpenVaultInput = z.object({
  path: z.string().min(1),
});
export type OpenVaultInput = z.infer<typeof OpenVaultInput>;

export const CloseVaultInput = z.object({
  id: z.string().min(1),
});
export type CloseVaultInput = z.infer<typeof CloseVaultInput>;

export const AddVaultInput = z.object({
  path: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type AddVaultInput = z.infer<typeof AddVaultInput>;

export const RemoveVaultInput = z.object({
  id: z.string().min(1),
});
export type RemoveVaultInput = z.infer<typeof RemoveVaultInput>;

// ── Output schemas ────────────────────────────────────────────────────────────

export const GetCurrentVaultOutput = VaultSchema.nullable();
export type GetCurrentVaultOutput = z.infer<typeof GetCurrentVaultOutput>;

export const ListVaultsOutput = z.array(VaultSchema);
export type ListVaultsOutput = z.infer<typeof ListVaultsOutput>;

// ── vault.readFile ────────────────────────────────────────────────────────────

export const ReadFileInput = z.object({
  path: z.string().min(1),
});
export type ReadFileInput = z.infer<typeof ReadFileInput>;

// Output carries raw bytes (transferable across worker boundary) plus, for
// text-encodable formats, the UTF-8 decoded body. `bytes` is typed as
// `unknown` because Zod can't express `ArrayBuffer` cleanly and the worker
// link relies on structured-clone to pass it through.
export const ReadFileOutput = z.object({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bytes: z.unknown(),
  text: z.string().nullable(),
  size: z.number().int().nonnegative(),
});
export type ReadFileOutput = z.infer<typeof ReadFileOutput>;

// ── vault.writeFile ───────────────────────────────────────────────────────────

export const WriteFileInput = z.object({
  path: z.string().min(1),
  // ArrayBuffer / Uint8Array transferred via structured-clone.
  bytes: z.unknown(),
});
export type WriteFileInput = z.infer<typeof WriteFileInput>;

export const WriteFileOutput = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
});
export type WriteFileOutput = z.infer<typeof WriteFileOutput>;

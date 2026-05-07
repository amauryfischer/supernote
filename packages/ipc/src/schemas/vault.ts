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

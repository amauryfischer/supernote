/**
 * Logique pure de provenance pour `sync.applyOps`. Garde l'invariant :
 * une entité d'une provenance ne peut jamais écraser une entité d'une autre
 * provenance (y compris native = null).
 */
import { prefixMountPath } from "../online-sync/room-id";

export interface MountWrite {
  /** Chemin à stocker en DB (préfixé si l'op vient d'un salon monté). */
  filePath: string;
  /** Provenance à poser sur la ligne (null = native du père). */
  sourceVaultId: string | null;
}

/**
 * Décide le chemin stocké + la provenance d'une op `applyOps`.
 * `sourceVaultId` undefined/null = client du père (entité native).
 */
export function resolveMountWrite(
  filePath: string,
  sourceVaultId: string | null | undefined,
): MountWrite {
  if (!sourceVaultId) return { filePath, sourceVaultId: null };
  return { filePath: prefixMountPath(sourceVaultId, filePath), sourceVaultId };
}

/**
 * Vrai si une op de provenance `incoming` tente d'écrire sur un id déjà
 * détenu par une AUTRE provenance — on skippe alors plutôt que d'écraser.
 */
export function crossProvenanceCollision(
  existing: { existingSource: string | null },
  incoming: string | null,
): boolean {
  return existing.existingSource !== incoming;
}

/**
 * Logique pure de provenance pour `sync.applyOps`. Garde l'invariant :
 * une entité d'une provenance ne peut jamais écraser une entité d'une autre
 * provenance (y compris native = null).
 */
import { prefixMountPath, MOUNT_PATH_PREFIX } from "../online-sync/room-id";

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

/**
 * Vrai si un chemin stocké appartient à un sous-arbre monté (`@mounts/<slug>/…`).
 * Utilisé en défense en profondeur côté handlers utilisateur :
 *  - `entitiesCreate` refuse de créer une entité native à un chemin monté
 *    (elle serait écrite sur le disque du père + poussée dans le salon du père) ;
 *  - principe miroir de la garde provenance de `entitiesUpdate` (une entité
 *    montée ne matérialise jamais de fichier dans le dossier FSA du père).
 */
export function isMountedPath(filePath: string): boolean {
  return filePath.startsWith(`${MOUNT_PATH_PREFIX}/`);
}

/**
 * Identité canonique d'un salon cloud + slug de répertoire OPFS, partagés
 * entre le boot du coffre cloud (PwaVaultSetup) et le moteur de montage.
 */

/** Préfixe de chemin virtuel des entités montées dans le vault père. */
export const MOUNT_PATH_PREFIX = "@mounts";

/** Serveur canonique : trim, sans slash final. */
export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/**
 * Canonicalise a room key: trim then fold to lowercase.
 *
 * The server partitions the op-log by an exact, case-sensitive string match
 * (`WHERE vault = ?`), so two devices must send byte-identical keys to share a
 * vault. A human typing the same word on a laptop and a phone is the intended
 * pairing flow — but mobile keyboards auto-capitalise the first letter by
 * default, silently turning `amaury` into `Amaury` and splitting the pair into
 * two empty vaults. Folding to lowercase makes the key case-insensitive so the
 * keyboard can't break pairing. Applied on both save and load, so devices that
 * already persisted a mis-cased key heal themselves on the next boot without
 * re-entering it.
 */
export function normalizeVaultKey(key: string): string {
  return key.trim().toLowerCase();
}

/** Identité stable d'un salon : `cloud:<server>|<key>`. */
export function cloudVaultId(serverUrl: string, vaultKey: string): string {
  return `cloud:${normalizeServerUrl(serverUrl)}|${normalizeVaultKey(vaultKey)}`;
}

/** Nom de dossier OPFS déterministe et sûr pour un id de salon. */
export function cloudRoomSlug(cloudId: string): string {
  let h = 5381;
  for (let i = 0; i < cloudId.length; i++) {
    h = ((h << 5) + h + cloudId.charCodeAt(i)) >>> 0;
  }
  const readable = cloudId
    .replace(/^cloud:/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 40);
  return `${readable || "room"}-${h.toString(36)}`;
}

/** Préfixe un chemin d'entité par son salon de provenance. */
export function prefixMountPath(cloudId: string, filePath: string): string {
  return `${MOUNT_PATH_PREFIX}/${cloudRoomSlug(cloudId)}/${filePath}`;
}

/** Retire le préfixe `@mounts/<slug>/` ; renvoie le chemin d'origine ou null. */
export function stripMountPath(cloudId: string, filePath: string): string | null {
  const pfx = `${MOUNT_PATH_PREFIX}/${cloudRoomSlug(cloudId)}/`;
  return filePath.startsWith(pfx) ? filePath.slice(pfx.length) : null;
}

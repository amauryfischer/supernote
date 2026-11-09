import { trpcVanillaClient } from "@/lib/trpc/client";
import { createNative, folderIdFor, NATIVE_KINDS, pointerContent } from "./drive-api";
import { NATIVE } from "./engine";
import { readLinks } from "./links";

/**
 * Crée un Google Doc/Sheet/Slides dans le dossier Drive lié à `folder` et son pointeur local, déjà rapproché :
 * la passe suivante ne le recrée pas. `null` si `folder` n'est sous aucune liaison active.
 */
export async function createLinkedGoogleFile(
  clientId: string,
  vaultId: string,
  folder: string,
  name: string,
  mimeType: string,
): Promise<string | null> {
  const link = readLinks(vaultId).find((l) => l.enabled && (folder === l.vaultFolder || folder.startsWith(`${l.vaultFolder}/`)));
  const kind = NATIVE_KINDS[mimeType];
  if (!link || !kind) return null;
  const relDir = folder.slice(link.vaultFolder.length + 1);
  const id = await createNative(clientId, name, mimeType, await folderIdFor(clientId, link.driveFolderId, relDir));
  const pointer = await trpcVanillaClient.driveSync.putPointer.mutate({ filePath: `${folder}/${name}${kind.ext}`, content: pointerContent(id, mimeType) });
  await trpcVanillaClient.driveSync.stateUpsert.mutate({
    linkId: link.id,
    driveFileId: id,
    entityId: pointer.entityId,
    relPath: `${relDir ? `${relDir}/` : ""}${name}${kind.ext}`,
    driveMd5: NATIVE,
    localHash: NATIVE,
    syncedAt: Date.now(),
  });
  return pointer.entityId;
}

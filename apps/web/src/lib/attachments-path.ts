/**
 * Dossier des pièces jointes d'une note : `<dossier de la note>/_attachments/`.
 *
 * Créé automatiquement au collage/dépôt d'un fichier (cf. vault-file-adapter).
 * C'est un dossier technique : il n'a rien à faire dans l'arborescence des
 * notes ni dans les destinations de déplacement.
 */

export const ATTACHMENTS_DIR = "_attachments";

/** Vrai si le chemin EST le dossier de pièces jointes ou vit dedans. */
export function isAttachmentPath(path: string): boolean {
  if (!path) return false;
  return (
    path === ATTACHMENTS_DIR ||
    path.startsWith(`${ATTACHMENTS_DIR}/`) ||
    path.endsWith(`/${ATTACHMENTS_DIR}`) ||
    path.includes(`/${ATTACHMENTS_DIR}/`)
  );
}

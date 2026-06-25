/**
 * mail-attachments — helpers pour joindre des fichiers à un message Gmail sortant
 * (réponse / brouillon / compose). Le format consommé par `buildRawMessage`
 * (`OutgoingAttachment`) attend du base64 STANDARD. On lit chaque `File` via
 * `FileReader.readAsDataURL` puis on isole la partie base64 du data-URL.
 *
 * Les fonctions de calcul (limite de taille, libellé) sont PURES et testées ;
 * seule `fileToAttachment` touche le DOM (`FileReader`).
 */

import type { OutgoingAttachment } from "./gmail";
import { formatBytes } from "./gmail";

/** Pièce jointe sortante augmentée de sa taille (octets) pour l'UI (chips, total). */
export interface PendingAttachment extends OutgoingAttachment {
  /** Taille brute du fichier en octets (pour l'affichage et le total). */
  size: number;
}

/**
 * Limite Gmail des pièces jointes : 25 Mo. Au-delà, Gmail bascule l'envoi via
 * Drive — qu'on ne gère pas ici. On AVERTIT plutôt que de bloquer (l'envoi
 * échouera côté API, mais l'utilisateur est prévenu en amont).
 */
export const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

/** Somme des tailles d'un lot de pièces jointes (octets). Pur. */
export function totalAttachmentsSize(attachments: Array<{ size: number }>): number {
  return attachments.reduce((sum, a) => sum + (Number.isFinite(a.size) ? a.size : 0), 0);
}

/** Vrai si le total dépasse la limite Gmail (25 Mo). Pur. */
export function exceedsAttachmentLimit(attachments: Array<{ size: number }>): boolean {
  return totalAttachmentsSize(attachments) > MAX_ATTACHMENTS_BYTES;
}

/** Libellé « nom · taille » d'une pièce jointe pour un chip. Pur. */
export function attachmentLabel(att: { filename: string; size: number }): string {
  return `${att.filename} · ${formatBytes(att.size)}`;
}

/**
 * Extrait la partie base64 d'un data-URL (`data:<mime>;base64,<payload>`). Si la
 * chaîne n'est pas un data-URL base64 (cas dégradé), renvoie la chaîne brute. Pur.
 */
export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return dataUrl;
  const header = dataUrl.slice(0, comma);
  return /;base64/i.test(header) ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * Réduit `OutgoingAttachment[]` (sans `size`) à partir de `PendingAttachment[]`
 * pour passer à `sendReply` / `createDraft`. Pur.
 */
export function toOutgoing(attachments: PendingAttachment[]): OutgoingAttachment[] {
  return attachments.map(({ filename, mimeType, base64 }) => ({ filename, mimeType, base64 }));
}

/**
 * Lit un `File` du navigateur en `PendingAttachment` (base64 standard + métadonnées).
 * Effet de bord (FileReader). Le `mimeType` retombe sur `application/octet-stream`
 * si le navigateur n'a pas typé le fichier.
 */
export function fileToAttachment(file: File): Promise<PendingAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Lecture de ${file.name} échouée`));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve({
        filename: file.name || "piece-jointe",
        mimeType: file.type || "application/octet-stream",
        base64: dataUrlToBase64(result),
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

/** Lit plusieurs `File` en parallèle (utilitaire pour un `<input multiple>`). */
export function filesToAttachments(files: File[]): Promise<PendingAttachment[]> {
  return Promise.all(files.map((f) => fileToAttachment(f)));
}

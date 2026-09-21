/**
 * Adaptateur fichiers de l'éditeur ↔ coffre.
 *
 * Côté web, les pièces jointes vivent derrière le worker (FSA ou OPFS) : aucune
 * URL http ne les sert. On écrit donc le fichier collé/déposé dans
 * `<dossier de la note>/_attachments/` et on ne stocke que ce chemin dans le
 * markdown (`![](Projets/_attachments/img-….png)`), puis on le résout en
 * `blob:` au rendu.
 *
 * Coffre synchronisé : les ops ne portent que ce markdown, donc les octets
 * passent par le serveur de synchro — poussés dès qu'ils sont lus ou écrits
 * ici, tirés quand le fichier manque localement (collé sur un autre appareil).
 */

import { mimeTypeForPath } from "@/components/attachments/useAttachmentBlob";
import { trpcVanillaClient } from "@/lib/trpc/client";
import { ATTACHMENTS_DIR } from "@/lib/attachments-path";
import { loadOnlineSyncConfig } from "@/lib/online-sync/config-storage";
import { hasBlob, pullBlob, pushBlob } from "@/lib/online-sync/client";
import type { EditorFileAdapter } from "@supernote/editor";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/webm": "weba",
};

// Un chemin de coffre résolu reste valable toute la session : on garde l'URL
// blob plutôt que de relire le fichier à chaque montage de bloc (une note
// illustrée re-résoudrait toutes ses images à chaque navigation). Jamais
// révoquée volontairement — révoquer une URL encore affichée casse l'image.
const objectUrlByPath = new Map<string, string>();

// Au plus un HEAD par pièce jointe et par session. Une image collée hors ligne,
// ou avant que la synchro ne transporte les octets, part au prochain affichage.
const blobOnServer = new Set<string>();

/** Les sous-arbres montés appartiennent à un autre salon. */
function blobTarget(path: string) {
  const cfg = loadOnlineSyncConfig();
  if (!cfg.enabled || !cfg.vaultKey || path.startsWith("@mounts/")) return null;
  return cfg;
}

function ensureBlobOnServer(path: string, bytes: ArrayBuffer): void {
  const target = blobTarget(path);
  if (!target || blobOnServer.has(path)) return;
  blobOnServer.add(path);
  void (async () => {
    if (!(await hasBlob(target, path))) await pushBlob(target, path, bytes);
  })().catch((err) => {
    blobOnServer.delete(path);
    console.warn("[attachments] envoi au serveur de synchro échoué", path, err);
  });
}

async function pullMissingBlob(path: string): Promise<ArrayBuffer | null> {
  const target = blobTarget(path);
  if (!target) return null;
  const bytes = await pullBlob(target, path).catch(() => null);
  if (!bytes) return null;
  blobOnServer.add(path);
  try {
    await trpcVanillaClient.vault.writeFile.mutate({ path, bytes });
  } catch (err) {
    console.warn("[attachments] copie locale échouée", path, err);
  }
  return bytes;
}

function extensionFor(file: File): string {
  const fromName = file.name.includes(".") ? file.name.split(".").pop() : "";
  if (fromName && /^[a-z0-9]{1,5}$/i.test(fromName)) return fromName.toLowerCase();
  return EXT_BY_MIME[file.type] ?? "bin";
}

function baseNameFor(file: File): string {
  const raw = file.name.replace(/\.[^.]*$/, "").trim();
  const slug = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (slug && slug !== "image") return slug;
  return file.type.startsWith("image/") ? "img" : "file";
}

function isExternalUrl(url: string): boolean {
  return /^(https?:|blob:|data:|file:)/i.test(url);
}

function objectUrlFor(path: string, bytes: ArrayBuffer, mime?: string): string {
  const url = URL.createObjectURL(
    new Blob([bytes], { type: mime || mimeTypeForPath(path) }),
  );
  objectUrlByPath.set(path, url);
  return url;
}

/**
 * Construit l'adaptateur pour une note. `getNoteDir` retourne le dossier de la
 * note dans le coffre ("" à la racine) — lu à chaque appel, la note courante
 * changeant sous l'adaptateur.
 */
export function createVaultFileAdapter(
  getNoteDir: () => string,
): EditorFileAdapter {
  const upload = async (file: File): Promise<string> => {
    const dir = getNoteDir().replace(/^\/+|\/+$/g, "");
    const name = `${baseNameFor(file)}-${Date.now()}.${extensionFor(file)}`;
    const path = `${dir ? `${dir}/` : ""}${ATTACHMENTS_DIR}/${name}`;
    const bytes = await file.arrayBuffer();
    await trpcVanillaClient.vault.writeFile.mutate({ path, bytes });
    ensureBlobOnServer(path, bytes);
    // Le bloc va demander la résolution dans la foulée : on l'alimente sans
    // relire le fichier qu'on vient d'écrire.
    objectUrlFor(path, bytes, file.type);
    return path;
  };

  const resolveUrl = async (url: string): Promise<string> => {
    if (!url || isExternalUrl(url)) return url;
    const dir = getNoteDir().replace(/^\/+|\/+$/g, "");
    const clean = url.replace(/^\/+/, "");
    // Chemin depuis la racine du coffre (ce qu'on écrit) d'abord, puis relatif
    // à la note (notes importées d'Obsidian, markdown écrit à la main).
    const candidates = dir && !clean.startsWith(`${dir}/`) ? [clean, `${dir}/${clean}`] : [clean];
    for (const path of candidates) {
      const cached = objectUrlByPath.get(path);
      if (cached) return cached;
      try {
        const result = (await trpcVanillaClient.vault.readFile.query({ path })) as {
          bytes: ArrayBuffer;
        };
        ensureBlobOnServer(path, result.bytes);
        return objectUrlFor(path, result.bytes);
      } catch {
        /* candidat suivant */
      }
    }
    for (const path of candidates) {
      const bytes = await pullMissingBlob(path);
      if (bytes) return objectUrlFor(path, bytes);
    }
    return url;
  };

  return { upload, resolveUrl };
}

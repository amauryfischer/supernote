import { ATTACHMENTS_DIR, isAttachmentPath } from "@/lib/attachments-path";
import { publishShareBlob, type OwnedShare } from "./shareApi";

const IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif)$/i;

/**
 * Un invité en écriture choisit le markdown : sans ce filtre, `![](Finance/impots.pdf)`
 * ferait publier n'importe quel fichier du coffre du propriétaire.
 */
function publishable(path: string): boolean {
  if (/^(https?|data|blob|file):/i.test(path)) return false;
  if (!IMAGE_EXT_RE.test(path)) return false;
  const clean = path.replace(/^\/+/, "");
  if (clean.includes("..")) return false;
  return isAttachmentPath(clean) && clean.includes(`${ATTACHMENTS_DIR}/`);
}

/** Publie les images de coffre de la note pas encore envoyées (`done` est muté). */
export async function publishNoteImages(
  share: OwnedShare,
  markdown: string,
  resolveUrl: (path: string) => Promise<string>,
  done: Set<string>,
): Promise<void> {
  for (const [, path] of markdown.matchAll(IMAGE_RE)) {
    if (!path || done.has(path) || !publishable(path)) continue;
    const url = await resolveUrl(path);
    if (!url.startsWith("blob:")) continue;
    const blob = await (await fetch(url)).blob();
    if (blob.size > 10 * 1024 * 1024) continue;
    await publishShareBlob(share, path, blob);
    done.add(path);
  }
}

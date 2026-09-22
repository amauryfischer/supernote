import { publishShareBlob, type OwnedShare } from "./shareApi";

const IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)\)/g;

/** Publie les images de coffre de la note pas encore envoyées (`done` est muté). */
export async function publishNoteImages(
  share: OwnedShare,
  markdown: string,
  resolveUrl: (path: string) => Promise<string>,
  done: Set<string>,
): Promise<void> {
  for (const [, path] of markdown.matchAll(IMAGE_RE)) {
    // Le serveur refuse le SVG : sans ce saut, chaque passe s'arrêterait dessus.
    if (!path || done.has(path) || /^(https?|data|blob):/.test(path) || /\.svg$/i.test(path)) continue;
    const url = await resolveUrl(path);
    if (!url.startsWith("blob:")) continue;
    const blob = await (await fetch(url)).blob();
    if (blob.size > 10 * 1024 * 1024) continue;
    await publishShareBlob(share, path, blob);
    done.add(path);
  }
}

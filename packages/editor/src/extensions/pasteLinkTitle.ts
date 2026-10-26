// Collage d'une URL seule (sans sélection) → lien dont le texte est l'URL, puis
// remplacé par le titre de la page quand `resolveLinkTitle` répond.
//
// Même raison que htmlPaste.ts : listener DOM en capture, car PM diffère son
// `handlePaste` et le DataTransfer est déjà vidé à ce moment-là. Une URL collée
// sur une sélection, dans un bloc de code ou dans un lien garde le comportement natif.

import type { Editor } from "@tiptap/core";

export interface PasteLinkEditorLike {
  _tiptapEditor: Editor;
}

const LINK_MARK = "link";

/** L'URL http(s) que contient le presse-papier, si c'est tout ce qu'il contient. */
function pastedUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

/** Remplace le texte d'un lien resté tel quel (texte === href === url) ; sans effet si l'utilisateur l'a touché. */
function replaceLinkText(tiptap: Editor, url: string, title: string): void {
  if (tiptap.isDestroyed) return;
  const { doc, schema } = tiptap.state;
  const hits: Array<{ node: typeof doc; pos: number }> = [];
  doc.descendants((node, pos) => {
    if (hits.length > 0) return false;
    const link = node.isText ? node.marks.find((m) => m.type.name === LINK_MARK) : undefined;
    if (link && link.attrs["href"] === url && node.text === url) hits.push({ node, pos });
    return hits.length === 0;
  });
  const hit = hits[0];
  if (!hit) return;
  tiptap.view.dispatch(
    tiptap.state.tr.replaceWith(hit.pos, hit.pos + hit.node.nodeSize, schema.text(title, hit.node.marks)),
  );
}

export function attachPasteLinkTitle(
  element: HTMLElement,
  getBlockNote: () => PasteLinkEditorLike | null,
  getResolver: () => ((url: string) => Promise<string | null>) | undefined,
): () => void {
  const onPaste = (event: ClipboardEvent) => {
    const resolve = getResolver();
    const data = event.clipboardData;
    if (!resolve || !data) return;
    // Un lien copié depuis une page arrive avec son texte en text/html : on le laisse tel quel.
    if (Array.from(data.types).includes("text/html")) return;
    const url = pastedUrl(data.getData("text/plain"));
    if (!url) return;

    const tiptap = getBlockNote()?._tiptapEditor;
    if (!tiptap || tiptap.isDestroyed || !tiptap.isEditable) return;
    if (!tiptap.view.dom.contains(event.target as Node | null)) return;
    const { selection } = tiptap.state;
    if (!selection.empty || selection.$from.parent.type.spec.code) return;
    if (selection.$from.marks().some((m) => m.type.name === LINK_MARK)) return;

    event.preventDefault();
    event.stopPropagation();
    tiptap.commands.insertContent({
      type: "text",
      text: url,
      marks: [{ type: LINK_MARK, attrs: { href: url } }],
    });

    resolve(url).then(
      (title) => {
        const clean = title?.trim();
        if (clean && clean !== url) replaceLinkText(tiptap, url, clean);
      },
      () => undefined,
    );
  };

  element.addEventListener("paste", onPaste, true);
  return () => element.removeEventListener("paste", onPaste, true);
}

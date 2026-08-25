// Collage d'un document HTML complet → bloc artefact.
//
// Déclenché uniquement quand le presse-papier contient, en text/plain, ce qui
// ressemble à un document HTML (doctype / <html> / fragment structuré fermé) :
// c'est la forme du « copier le code » d'un artefact. Copier un morceau de page
// web, lui, arrive en text/html et doit rester du texte riche — d'où le refus
// dès que le presse-papier annonce du HTML natif.
//
// ⚠️ Listener DOM en capture, et NON `handlePaste` de ProseMirror : PM diffère
// son appel (capturePaste + setTimeout) et Chrome a déjà neutralisé le
// DataTransfer à ce moment-là — `getData("text/plain")` y renvoie "".

import { looksLikeHtmlDocument } from "../blocks/htmlArtifactUtils.js";
import type { BlockOpsEditorLike } from "./blockOpsShortcuts.js";

/** En deçà, un collage n'est pas un artefact (bout de balisage, snippet). */
const MIN_ARTIFACT_LENGTH = 40;

export function attachHtmlPaste(
  element: HTMLElement,
  getBlockNote: () => BlockOpsEditorLike | null,
): () => void {
  const onPaste = (event: ClipboardEvent) => {
    const data = event.clipboardData;
    if (!data) return;
    if (Array.from(data.types).includes("text/html")) return;
    const text = data.getData("text/plain");
    if (text.length < MIN_ARTIFACT_LENGTH || !looksLikeHtmlDocument(text)) return;

    const editor = getBlockNote();
    if (!editor) return;

    event.preventDefault();
    event.stopPropagation();

    const current = editor.getTextCursorPosition().block;
    const inserted = editor.insertBlocks(
      [
        { type: "htmlArtifact", props: { html: text } },
        { type: "paragraph", props: {} },
      ],
      current,
      "after",
    );
    const trailing = inserted?.[1];
    if (trailing) editor.setTextCursorPosition(trailing, "start");
  };

  element.addEventListener("paste", onPaste, true);
  return () => element.removeEventListener("paste", onPaste, true);
}

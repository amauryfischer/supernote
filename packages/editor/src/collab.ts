// Conversions markdown ↔ Yjs pour le partage de notes en co-édition.

import { BlockNoteEditor } from "@blocknote/core";
import { blocksToYDoc, yXmlFragmentToBlocks } from "@blocknote/core/yjs";
import * as Y from "yjs";
import { supernoteSchema } from "./schema.js";
import { blocksToMarkdown, markdownToBlocks } from "./serialization/index.js";

export const COLLAB_FRAGMENT = "document-store";

/** État Yjs initial d'une note partagée, construit depuis son markdown. */
export function markdownToYUpdate(markdown: string): Uint8Array {
  const editor = BlockNoteEditor.create({ schema: supernoteSchema });
  const blocks = markdownToBlocks(markdown);
  const doc = blocksToYDoc(editor, blocks.length ? blocks : [{ type: "paragraph" }], COLLAB_FRAGMENT);
  return Y.encodeStateAsUpdate(doc);
}

/** Markdown de l'état Yjs courant : l'éditeur monté sur un fragment déjà rempli n'émet aucun onChange. */
export function yFragmentToMarkdown(fragment: Y.XmlFragment): string {
  const editor = BlockNoteEditor.create({ schema: supernoteSchema });
  return blocksToMarkdown(yXmlFragmentToBlocks(editor, fragment));
}

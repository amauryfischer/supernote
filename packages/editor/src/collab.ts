// Amorçage Yjs pour le partage de notes en co-édition.

import { BlockNoteEditor } from "@blocknote/core";
import { blocksToYDoc } from "@blocknote/core/yjs";
import * as Y from "yjs";
import { supernoteSchema } from "./schema.js";
import { markdownToBlocks } from "./serialization/index.js";

export const COLLAB_FRAGMENT = "document-store";

/** État Yjs initial d'une note partagée, construit depuis son markdown. */
export function markdownToYUpdate(markdown: string): Uint8Array {
  const editor = BlockNoteEditor.create({ schema: supernoteSchema });
  const blocks = markdownToBlocks(markdown);
  const doc = blocksToYDoc(editor, blocks.length ? blocks : [{ type: "paragraph" }], COLLAB_FRAGMENT);
  return Y.encodeStateAsUpdate(doc);
}

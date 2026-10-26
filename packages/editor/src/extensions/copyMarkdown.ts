// Copier en Markdown : Mod+Maj+C et entrée du menu de bloc.
// La sérialisation est celle de la sauvegarde (serialization/serialize.ts),
// le résultat part en text/plain.

import type { Editor } from "@tiptap/core";
import { blocksToMarkdown } from "../serialization/serialize.js";
import type { BlockLike, BlockOpsEditorLike } from "./blockOpsShortcuts.js";

/** Émis sur le DOM de l'éditeur après une copie réussie (retour visuel côté SupernoteEditor). */
export const COPIED_MARKDOWN_EVENT = "supernote:copied-markdown";

/** Sélection → blocs découpés à la sélection ; sans sélection → bloc du curseur. */
function blocksToCopy(bn: BlockOpsEditorLike): BlockLike[] {
  if (!bn.prosemirrorState.selection.empty) {
    try {
      const cut = bn.getSelectionCutBlocks().blocks;
      if (cut.length > 0) return cut;
    } catch {
      /* sélection de nœud (bloc non éditable) : repli ci-dessous */
    }
    const whole = bn.getSelection()?.blocks;
    if (whole?.length) return whole;
  }
  return [bn.getTextCursorPosition().block];
}

export async function copyBlocksAsMarkdown(blocks: readonly BlockLike[]): Promise<boolean> {
  const md = blocksToMarkdown(blocks as unknown as Parameters<typeof blocksToMarkdown>[0]);
  if (!md.trim()) return false;
  try {
    await navigator.clipboard.writeText(md);
    return true;
  } catch {
    // contexte non sécurisé ou permission refusée
    return false;
  }
}

/** Raccourci clavier : lance la copie, signale les blocs copiés à l'éditeur. */
export function copySelectionAsMarkdown(editor: Editor, bn: BlockOpsEditorLike): boolean {
  let blocks: BlockLike[];
  try {
    blocks = blocksToCopy(bn);
  } catch {
    return false;
  }
  void copyBlocksAsMarkdown(blocks).then((ok) => {
    if (!ok) return;
    editor.view.dom.dispatchEvent(
      new CustomEvent(COPIED_MARKDOWN_EVENT, { bubbles: true, detail: { ids: blocks.map((b) => b.id) } }),
    );
  });
  return true;
}

// Opérations sur blocs au clavier :
//
//   Alt-ArrowUp / Alt-ArrowDown   → déplacer le bloc courant (réordonner)
//   Mod-d                         → dupliquer le bloc courant
//   Mod-Shift-ArrowUp / ArrowDown → étendre la sélection paragraphe par paragraphe
//   Mod-x (sélection vide)        → couper le bloc entier
//
// Déplacement et duplication passent par l'API BlockNote (seule à connaître
// la structure blockContainer/blockGroup) — l'extension Tiptap est créée
// avant l'éditeur BlockNote, d'où le getter `getBlockNote` résolu à la frappe
// (même pattern de découplage que continueChecklistOnEnter).
//
// Mod-x n'implémente PAS le cut lui-même : sélection vide → on élargit la
// sélection au blockContainer (NodeSelection) puis on retourne `false` pour
// laisser le cut natif opérer — ProseMirror sérialise le bloc complet dans
// le presse-papier (re-collable tel quel) et le supprime. Zéro logique
// clipboard maison.

import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import {
  collectTextblockRanges,
  resolveSelectExtendTarget,
} from "./blockNavShortcuts.js";

interface BlockLike {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown;
  children?: BlockLike[];
}

/** Sous-ensemble de BlockNoteEditor utilisé ici (cf. continueChecklistOnEnter). */
export interface BlockOpsEditorLike {
  getTextCursorPosition: () => { block: BlockLike };
  insertBlocks: (
    blocks: Array<Omit<BlockLike, "id">>,
    referenceBlock: BlockLike | string,
    placement: "before" | "after",
  ) => BlockLike[];
  setTextCursorPosition: (
    block: BlockLike | string,
    placement?: "start" | "end",
  ) => void;
  moveBlocksUp: () => void;
  moveBlocksDown: () => void;
}

/**
 * Clone profond d'un bloc sans ses ids — insertBlocks regénère des ids
 * frais, sinon le document contiendrait des doublons.
 */
export function cloneBlockWithoutIds(block: BlockLike): Omit<BlockLike, "id"> {
  return {
    type: block.type,
    props: structuredClone(block.props),
    content: block.content != null ? structuredClone(block.content) : undefined,
    children: (block.children ?? []).map(
      (c) => cloneBlockWithoutIds(c) as BlockLike,
    ),
  };
}

function duplicateCurrentBlock(bn: BlockOpsEditorLike): boolean {
  let block: BlockLike;
  try {
    block = bn.getTextCursorPosition().block;
  } catch {
    return false;
  }
  const inserted = bn.insertBlocks([cloneBlockWithoutIds(block)], block, "after");
  const newId = inserted?.[0]?.id;
  if (newId) {
    try {
      bn.setTextCursorPosition(newId, "start");
    } catch {
      /* le caret reste sur l'original — duplication déjà faite */
    }
  }
  return true;
}

function extendSelection(editor: Editor, dir: "up" | "down"): boolean {
  const { selection } = editor.state;
  const target = resolveSelectExtendTarget(
    collectTextblockRanges(editor),
    selection.head,
    dir,
  );
  if (target == null) return true;
  return editor
    .chain()
    .setTextSelection({ from: selection.anchor, to: target })
    .scrollIntoView()
    .run();
}

/** Sélection vide → NodeSelection sur le blockContainer parent, cut natif ensuite. */
function selectBlockForCut(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!selection.empty) return false; // sélection réelle → cut natif inchangé
  const $from = selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "blockContainer") {
      editor.commands.setNodeSelection($from.before(d));
      break;
    }
  }
  return false; // toujours laisser le cut natif consommer l'événement
}

/** Extension Tiptap branchée dans SupernoteEditor via `_tiptapOptions`. */
export function createBlockOpsExtension(
  getBlockNote: () => BlockOpsEditorLike | null,
): Extension {
  return Extension.create({
    name: "supernoteBlockOps",
    addKeyboardShortcuts() {
      return {
        "Alt-ArrowUp": () => {
          const bn = getBlockNote();
          if (!bn) return false;
          bn.moveBlocksUp();
          return true;
        },
        "Alt-ArrowDown": () => {
          const bn = getBlockNote();
          if (!bn) return false;
          bn.moveBlocksDown();
          return true;
        },
        "Mod-d": () => {
          const bn = getBlockNote();
          return bn ? duplicateCurrentBlock(bn) : false;
        },
        "Mod-Shift-ArrowUp": ({ editor }) => extendSelection(editor, "up"),
        "Mod-Shift-ArrowDown": ({ editor }) => extendSelection(editor, "down"),
        "Mod-x": ({ editor }) => selectBlockForCut(editor),
      };
    },
  });
}

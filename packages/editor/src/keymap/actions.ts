import type { Editor } from "@tiptap/core";
import type { EditorAction, EditorActionMeta } from "./types.js";
import {
  collectTextblockRanges, resolveBlockNavTarget,
  collectHeadingStarts, resolveHeadingTarget,
} from "../extensions/blockNavShortcuts.js";
import { duplicateCurrentBlock } from "../extensions/blockOpsShortcuts.js";

function jumpBlock(editor: Editor, dir: "up" | "down"): boolean {
  const head = editor.state.selection.head;
  const target = resolveBlockNavTarget(collectTextblockRanges(editor), head, dir);
  if (target == null) return true;
  return editor.chain().setTextSelection(target).scrollIntoView().run();
}

function jumpHeading(editor: Editor, dir: "prev" | "next"): boolean {
  const head = editor.state.selection.head;
  const target = resolveHeadingTarget(collectHeadingStarts(editor), head, dir);
  if (target == null) return true;
  return editor.chain().setTextSelection(target).scrollIntoView().run();
}

function selectParagraph(editor: Editor): boolean {
  const head = editor.state.selection.head;
  const r = collectTextblockRanges(editor).find((x) => head >= x.from && head <= x.to);
  if (!r) return false;
  return editor.chain().setTextSelection({ from: r.from, to: r.to }).run();
}

export const EDITOR_ACTIONS: readonly EditorAction[] = [
  // Navigation (OS-safe)
  { id: "navigation.prevBlock", label: "Bloc précédent", category: "navigation",
    defaultCombo: "alt+shift+up", run: ({ editor }) => jumpBlock(editor, "up") },
  { id: "navigation.nextBlock", label: "Bloc suivant", category: "navigation",
    defaultCombo: "alt+shift+down", run: ({ editor }) => jumpBlock(editor, "down") },
  { id: "navigation.prevHeading", label: "Titre précédent", category: "navigation",
    defaultCombo: "mod+alt+up", run: ({ editor }) => jumpHeading(editor, "prev") },
  { id: "navigation.nextHeading", label: "Titre suivant", category: "navigation",
    defaultCombo: "mod+alt+down", run: ({ editor }) => jumpHeading(editor, "next") },
  // Block-ops
  { id: "block-ops.moveUp", label: "Déplacer le bloc vers le haut", category: "block-ops",
    defaultCombo: "alt+up", run: ({ blockNote }) => { if (!blockNote) return false; blockNote.moveBlocksUp(); return true; } },
  { id: "block-ops.moveDown", label: "Déplacer le bloc vers le bas", category: "block-ops",
    defaultCombo: "alt+down", run: ({ blockNote }) => { if (!blockNote) return false; blockNote.moveBlocksDown(); return true; } },
  { id: "block-ops.duplicate", label: "Dupliquer le bloc", category: "block-ops",
    defaultCombo: "mod+d", run: ({ blockNote }) => (blockNote ? duplicateCurrentBlock(blockNote) : false) },
  // Édition
  { id: "edition.selectParagraph", label: "Sélectionner le paragraphe", category: "edition",
    defaultCombo: "mod+shift+a", run: ({ editor }) => selectParagraph(editor) },
];

export const ACTION_META: readonly EditorActionMeta[] = EDITOR_ACTIONS.map(
  ({ id, label, category, defaultCombo, reserved }) => ({ id, label, category, defaultCombo, reserved }),
);

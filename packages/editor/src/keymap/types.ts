import type { Editor } from "@tiptap/core";
import type { BlockOpsEditorLike } from "../extensions/blockOpsShortcuts.js";

export type EditorActionCategory =
  | "format" | "bloc" | "navigation" | "block-ops" | "edition" | "ia";

/** API BlockNote requise par les handlers (move/duplicate). */
export type KeymapBlockNote = BlockOpsEditorLike;

export interface EditorActionContext {
  editor: Editor;                    // éditeur Tiptap (sélection, formatage)
  blockNote: KeymapBlockNote | null; // API BlockNote, peut être null avant init
}

export interface EditorAction {
  id: string;
  label: string;
  category: EditorActionCategory;
  defaultCombo: string;              // canonique ("mod+b"), "" si pas de défaut
  reserved?: boolean;
  run: (ctx: EditorActionContext) => boolean;
}

/** Métadonnées sérialisables (sans handler) pour l'UI / cheat-sheet / resolver. */
export interface EditorActionMeta {
  id: string;
  label: string;
  category: EditorActionCategory;
  defaultCombo: string;
  reserved?: boolean;
}

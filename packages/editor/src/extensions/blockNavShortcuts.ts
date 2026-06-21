// Navigation clavier par paragraphe — Ctrl/Cmd + flèches.
//
//   Mod-ArrowUp    → début du paragraphe courant ; si déjà au début,
//                    début du paragraphe précédent (style Word).
//   Mod-ArrowDown  → début du paragraphe suivant ; sans suivant, fin du courant.
//   Mod-ArrowLeft  → début du paragraphe courant ; si déjà au début,
//                    fin du paragraphe précédent (on remonte les frontières).
//   Mod-ArrowRight → fin du paragraphe courant ; si déjà à la fin,
//                    début du paragraphe suivant.
//
// La cible est calculée par `resolveBlockNavTarget` (logique pure, testée)
// sur la liste des textblocks du document — les nœuds non-textuels
// (databaseView, formula…) sont simplement sautés.

import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";

export type BlockNavDirection = "up" | "down" | "left" | "right";

/** Plage [from, to] des positions de curseur valides d'un textblock. */
export interface BlockRange {
  from: number;
  to: number;
}

/**
 * Position cible pour une direction donnée, ou null quand il n'y a nulle
 * part où aller (début/fin de document) — le handler consomme quand même
 * la touche pour garder un comportement stable.
 */
export function resolveBlockNavTarget(
  ranges: BlockRange[],
  head: number,
  dir: BlockNavDirection,
): number | null {
  if (ranges.length === 0) return null;
  const idx = ranges.findIndex((r) => head >= r.from && head <= r.to);

  // Curseur hors textblock (NodeSelection sur un bloc atomique) : on se
  // rabat sur le bloc voisin dans le sens du déplacement.
  if (idx === -1) {
    if (dir === "down" || dir === "right") {
      const next = ranges.find((r) => r.from > head);
      return next ? next.from : null;
    }
    const prev = [...ranges].reverse().find((r) => r.to < head);
    return prev ? (dir === "up" ? prev.from : prev.to) : null;
  }

  const cur = ranges[idx]!;
  const prev = ranges[idx - 1];
  const next = ranges[idx + 1];

  switch (dir) {
    case "up":
      if (head > cur.from) return cur.from;
      return prev ? prev.from : null;
    case "down":
      if (next) return next.from;
      return head < cur.to ? cur.to : null;
    case "left":
      if (head > cur.from) return cur.from;
      return prev ? prev.to : null;
    case "right":
      if (head < cur.to) return cur.to;
      return next ? next.from : null;
  }
}

/**
 * Cible d'extension de sélection (Mod-Shift-flèches) : la tête de sélection
 * saute de frontière en frontière de paragraphe, l'ancre reste fixe.
 *   up   → début du bloc courant, puis début du bloc précédent (style Word)
 *   down → fin du bloc courant, puis fin du bloc suivant
 */
export function resolveSelectExtendTarget(
  ranges: BlockRange[],
  head: number,
  dir: "up" | "down",
): number | null {
  if (dir === "up") return resolveBlockNavTarget(ranges, head, "up");
  if (ranges.length === 0) return null;
  const idx = ranges.findIndex((r) => head >= r.from && head <= r.to);
  if (idx === -1) {
    const next = ranges.find((r) => r.from > head);
    return next ? next.to : null;
  }
  const cur = ranges[idx]!;
  if (head < cur.to) return cur.to;
  const next = ranges[idx + 1];
  return next ? next.to : null;
}

/** Positions de début des blocs `heading` du document, ordonnées. */
export function collectHeadingStarts(editor: Editor): number[] {
  const starts: number[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") { starts.push(pos + 1); return false; }
    return true;
  });
  return starts;
}

/** Position du titre précédent/suivant strict par rapport à `head`, ou null. */
export function resolveHeadingTarget(
  starts: number[], head: number, dir: "prev" | "next",
): number | null {
  if (dir === "next") { const n = starts.find((s) => s > head); return n ?? null; }
  const p = [...starts].reverse().find((s) => s < head); return p ?? null;
}

/** Collecte les plages curseur de tous les textblocks du document. */
export function collectTextblockRanges(editor: Editor): BlockRange[] {
  const ranges: BlockRange[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) {
      ranges.push({ from: pos + 1, to: pos + node.nodeSize - 1 });
      return false; // inutile de descendre dans un textblock
    }
    return true;
  });
  return ranges;
}

function navigate(editor: Editor, dir: BlockNavDirection): boolean {
  const head = editor.state.selection.head;
  const target = resolveBlockNavTarget(collectTextblockRanges(editor), head, dir);
  if (target == null) return true; // consommé : pas de saut natif incohérent
  return editor.chain().setTextSelection(target).scrollIntoView().run();
}

/** Extension Tiptap branchée dans SupernoteEditor via `_tiptapOptions`. */
export const blockNavExtension = Extension.create({
  name: "supernoteBlockNav",
  addKeyboardShortcuts() {
    return {
      "Mod-ArrowUp": ({ editor }) => navigate(editor, "up"),
      "Mod-ArrowDown": ({ editor }) => navigate(editor, "down"),
      "Mod-ArrowLeft": ({ editor }) => navigate(editor, "left"),
      "Mod-ArrowRight": ({ editor }) => navigate(editor, "right"),
    };
  },
});

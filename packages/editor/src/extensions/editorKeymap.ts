import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import { EDITOR_ACTIONS } from "../keymap/actions.js";
import { canonicalToTiptap } from "../keymap/combo.js";
import type { KeymapBlockNote } from "../keymap/types.js";

/**
 * Extension Tiptap unique pilotée par le registre d'actions. `getBindings`
 * renvoie la map résolue combo->actionId (défauts + overrides utilisateur,
 * calculée côté app). Les raccourcis sont enregistrés À LA CRÉATION à partir
 * des combos RÉSOLUS — un rebind arbitraire prend effet via recréation de
 * l'extension (remount de l'éditeur, déclenché côté app quand les bindings
 * changent). `getBlockNote` résout l'API BlockNote à la frappe (peut être null
 * avant init).
 */
export function createEditorKeymapExtension(
  getBindings: () => Record<string, string>,
  getBlockNote: () => KeymapBlockNote | null,
): Extension {
  const actionById = new Map(EDITOR_ACTIONS.map((a) => [a.id, a]));
  return Extension.create({
    name: "supernoteEditorKeymap",
    addKeyboardShortcuts() {
      const shortcuts: Record<string, (p: { editor: Editor }) => boolean> = {};
      for (const [combo, actionId] of Object.entries(getBindings())) {
        const action = actionById.get(actionId);
        if (!action) continue; // combo d'une action hors registre (ex. format différé) — ignoré
        const key = canonicalToTiptap(combo);
        if (!key) continue;
        shortcuts[key] = ({ editor }) => action.run({ editor, blockNote: getBlockNote() });
      }
      return shortcuts;
    },
  });
}

/** Raccourcis de formatage fournis par BlockNote/Tiptap — affichage seul,
 * non réassignables (gérés en interne par l'éditeur). Combos en forme
 * canonique ("mod+b"). Les valeurs reflètent les défauts RÉELS lus dans la
 * source BlockNote/Tiptap (voir Task 8 investigation).
 *
 * Sources vérifiées :
 *   - Bold    : @tiptap/extension-bold src/bold.tsx          → Mod-b
 *   - Italic  : @tiptap/extension-italic src/italic.ts       → Mod-i
 *   - Under.  : @tiptap/extension-underline src/underline.ts → Mod-u
 *   - Strike  : @tiptap/extension-strike src/strike.ts       → Mod-Shift-s
 *   - Code    : @tiptap/extension-code src/code.ts           → Mod-e
 *   - Link    : aucun raccourci clavier défini dans BlockNote/Tiptap (omis)
 */
export interface BuiltinShortcut {
  label: string;
  combo: string;
}

export const BUILTIN_FORMAT_SHORTCUTS: readonly BuiltinShortcut[] = [
  { label: "Gras", combo: "mod+b" },
  { label: "Italique", combo: "mod+i" },
  { label: "Souligné", combo: "mod+u" },
  { label: "Barré", combo: "mod+shift+s" },
  { label: "Code (inline)", combo: "mod+e" },
];

// `#tag` devient une pastille dès la frappe du séparateur (ou d'Entrée), comme
// parse.ts le fait au rechargement : sans ça, le tag n'apparaissait qu'en
// rouvrant la note.

import { Extension, InputRule } from "@tiptap/core";

// Même classe de caractères que TAG_RE (@supernote/core, index du worker) et parse.ts.
const TAG_TYPED = /(^|\s)#([A-Za-z0-9_/-]+)([\s.,;:!?)])$/;
const TAG_BEFORE_CURSOR = /(?:^|\s)#([A-Za-z0-9_/-]+)$/;

export const tagInputRuleExtension = Extension.create({
  name: "supernoteTagInputRule",

  addInputRules() {
    return [
      new InputRule({
        find: TAG_TYPED,
        handler: ({ state, range, match }) => {
          const node = state.schema.nodes["tag"]?.create({ path: match[2] });
          if (!node) return null;
          // La zone matchée exclut le séparateur tapé : il est réinséré après la pastille.
          state.tr.replaceWith(range.from + (match[1]?.length ?? 0), range.to, [node, state.schema.text(match[3]!)]);
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor;
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.spec.code || $from.marks().some((m) => m.type.spec.code)) return false;
        // Une feuille (pastille, saut de ligne) compte pour une position : "￼" garde l'alignement.
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
        const m = TAG_BEFORE_CURSOR.exec(before);
        const node = m ? state.schema.nodes["tag"]?.create({ path: m[1] }) : null;
        if (m && node) editor.view.dispatch(state.tr.replaceWith($from.pos - m[1]!.length - 1, $from.pos, node));
        // Toujours false : BlockNote coupe ensuite le bloc comme d'habitude.
        return false;
      },
    };
  },
});

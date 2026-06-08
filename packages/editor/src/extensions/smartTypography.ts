// Remplacements typographiques automatiques à la frappe ("smart typography").
//
// Branché dans SupernoteEditor via `_tiptapOptions.extensions`. Chaque règle
// est une input rule ProseMirror : le motif est ancré sur la fin du texte
// (`$`) et déclenché par le dernier caractère tapé. Le `replace` inclut donc
// toujours le caractère déclencheur (ex. l'espace pour l'em dash / les
// fractions), car l'input rule remplace la zone matchée AVANT que ce
// caractère ne soit inséré.
//
// ── Exclusion des blocs de code ─────────────────────────────────────────────
// Double garde :
//   1. Tiptap saute nativement toute input rule quand le noeud parent porte
//      `spec.code` (cas du `codeBlock` par défaut de BlockNote).
//   2. Garde explicite par nodeType ci-dessous (`CODE_NODE_TYPES`) — défensive,
//      couvre aussi un éventuel renommage. Le bloc custom `codeHighlight` est
//      `content: "none"` (code stocké dans une prop), donc aucune frappe
//      inline n'y est possible de toute façon.
//
// PIÈGE PM connu du projet : on ne touche JAMAIS au DOM directement. Tout
// passe par une transaction ProseMirror (`state.tr.insertText`), chemin sûr
// vis-à-vis du MutationObserver de l'éditeur.

import { Extension, InputRule } from "@tiptap/core";

/** Une règle de remplacement typographique. */
export interface SmartTypographyRule {
  /** Identifiant lisible (debug / tests). */
  readonly name: string;
  /** Motif ancré sur la fin du texte tapé (`$`). Non global. */
  readonly find: RegExp;
  /** Texte de remplacement — inclut le caractère déclencheur conservé. */
  readonly replace: string;
}

/**
 * Table des remplacements, dans l'ordre d'essai (première règle qui matche
 * gagne). Structure pure exportée → testée unitairement, source unique de
 * vérité partagée entre l'extension Tiptap et `applySmartTypography`.
 */
export const SMART_TYPOGRAPHY_RULES: readonly SmartTypographyRule[] = [
  // Flèches.
  { name: "arrowRight", find: /->$/, replace: "→" },
  { name: "arrowLeft", find: /<-$/, replace: "←" },
  { name: "doubleArrowRight", find: /=>$/, replace: "⇒" },
  // Em dash : deux tirets suivis d'un espace (l'espace est le déclencheur et
  // est conservé dans le remplacement).
  { name: "emDash", find: /-- $/, replace: "— " },
  // Points de suspension.
  { name: "ellipsis", find: /\.\.\.$/, replace: "…" },
  // Symboles (c)/(r)/(tm) — insensibles à la casse sur la lettre.
  { name: "copyright", find: /\([cC]\)$/, replace: "©" },
  { name: "registered", find: /\([rR]\)$/, replace: "®" },
  { name: "trademark", find: /\((?:tm|TM|tM|Tm)\)$/, replace: "™" },
  // Fractions « entourées d'espaces » : l'espace de tête et l'espace
  // déclencheur sont tous deux conservés dans le remplacement.
  { name: "half", find: / 1\/2 $/, replace: " ½ " },
  { name: "quarter", find: / 1\/4 $/, replace: " ¼ " },
  { name: "threeQuarter", find: / 3\/4 $/, replace: " ¾ " },
];

/**
 * Applique (de façon pure) la première règle qui matche la fin de `text` et
 * renvoie le texte transformé ; renvoie `text` inchangé si aucune règle ne
 * matche. Modélise fidèlement le résultat visible de l'input rule — utilisé
 * par les tests.
 */
export function applySmartTypography(text: string): string {
  for (const rule of SMART_TYPOGRAPHY_RULES) {
    if (rule.find.test(text)) {
      return text.replace(rule.find, rule.replace);
    }
  }
  return text;
}

/** Types de noeuds où aucun remplacement ne doit jamais s'appliquer. */
const CODE_NODE_TYPES = new Set(["codeBlock", "codeHighlight", "code"]);

/** Construit l'input rule ProseMirror correspondant à une règle. */
function buildInputRule(rule: SmartTypographyRule): InputRule {
  return new InputRule({
    find: rule.find,
    handler: ({ state, range }) => {
      // Garde explicite : jamais de remplacement dans un bloc de code.
      // `return null` => Tiptap considère la règle comme non appliquée.
      if (CODE_NODE_TYPES.has(state.selection.$from.parent.type.name)) {
        return null;
      }
      // Remplace la zone matchée par le glyphe (transaction PM, jamais le DOM).
      state.tr.insertText(rule.replace, range.from, range.to);
    },
  });
}

/**
 * Extension Tiptap qui enregistre toutes les règles de smart typography.
 * Ajoutée conditionnellement dans SupernoteEditor (prop `smartTypography`).
 */
export const smartTypographyExtension = Extension.create({
  name: "supernoteSmartTypography",
  addInputRules() {
    return SMART_TYPOGRAPHY_RULES.map(buildInputRule);
  },
});

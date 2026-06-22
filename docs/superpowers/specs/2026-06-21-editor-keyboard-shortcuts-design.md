# Clavier éditeur unifié & remappable — Design

- **Date** : 2026-06-21
- **Statut** : validé (brainstorming), prêt pour plan d'implémentation
- **Approche retenue** : B — schéma curé + cheat-sheet + remapping complet (façon Obsidian)

## Objectif

Donner à l'éditeur markdown de Supernote un **contrôle clavier intuitif, complet et
découvrable** : les classiques (`⌘B` gras…) **étendus** de power-moves de navigation
et d'édition, sans conflit avec l'OS, **remappables** par l'utilisateur et exposés dans
une cheat-sheet.

Non-modal explicitement : **pas de modes Vim**. On vise le *feeling* de navigation
rapide, pas l'édition modale.

## Contexte / état actuel

- **Formatage** : fourni par défaut par BlockNote/Tiptap (`⌘B/I/U`, strike, code, titres,
  listes, undo/redo). La toolbar (`editorChrome.tsx`) affiche déjà « Gras (Ctrl+B) ».
- **Navigation bloc/paragraphe** : `packages/editor/src/extensions/blockNavShortcuts.ts`
  mappe `Mod-Flèche` sur paragraphe — **mais ça écrase la nav OS-native** (`⌘←/→`=ligne sur
  Mac, `Ctrl←/→`=mot sur Win/Linux). C'est une cause majeure du « pas intuitif ».
- **Block-ops** : `blockOpsShortcuts.ts` — `Alt-↑/↓` déplace, `⌘D` duplique, `⌘X` coupe le bloc.
- **Chord IA** : `SupernoteEditor.tsx` intercepte `⌘K` puis `r/s/c/p` (reformat / summarize /
  fix-spelling / palette) → **collision avec le classique `⌘K`=lien**.
- **Deux systèmes de raccourcis déconnectés** :
  1. **App-level** : `lib/keyboard/types.ts` `Shortcut` (runtime, `handler`) dispatché par
     `ShortcutProvider` (listener `window` en capture, scope stack global/editor/modal).
  2. **Réglages** : `settings/types.ts` `Shortcut` (`{id,label,keys}`) édité par
     `settings/tabs/ShortcutsTab.tsx` (clic-pour-réassigner, restaurer défauts).
- **Piège constaté (hors scope, à flaguer)** : rien ne relie visiblement `settings.shortcuts`
  au `ShortcutProvider` → le remapping **global** actuel paraît **cosmétique** (édite la liste
  mais ne rebinde rien au runtime). Bug latent séparé ; **non traité ici**.

## Décisions d'architecture

### D1 — Les raccourcis éditeur se dispatchent au niveau Tiptap/ProseMirror, pas via `ShortcutProvider`

`ShortcutProvider` est un listener `window` capture-phase qui `preventDefault`. Correct pour
le global (nouvelle note, recherche), **mauvais** pour les ops texte de l'éditeur : il se
battrait avec ProseMirror, casserait l'IME et le contenteditable, et provoquerait du
double-handling. Le formatage/nav/édition vivent donc dans le **keymap Tiptap**.

### D2 — Source de vérité unique : un registre d'actions éditeur

`packages/editor/src/keymap/actions.ts` :

```ts
type EditorActionCategory =
  | "format" | "bloc" | "navigation" | "block-ops" | "edition" | "ia";

interface EditorAction {
  id: string;                       // ex. "format.bold"
  label: string;                    // fr, ex. "Gras"
  category: EditorActionCategory;
  defaultCombo: string;             // canonique, ex. "mod+b" ; "" = pas de défaut
  run: (editor: EditorLike) => boolean; // true si géré (stoppe la propagation)
  reserved?: boolean;               // combo non réassignable (ex. undo)
}

const EDITOR_ACTIONS: readonly EditorAction[];
```

- `run` est **pur vis-à-vis du clavier** : il agit sur l'éditeur, renvoie `true`/`false`.
- Le registre est la **seule** liste ; il alimente : keymap Tiptap, cheat-sheet, section
  ShortcutsTab, tooltips toolbar.

### D3 — Une seule extension keymap Tiptap, à bindings vivants

`packages/editor/src/extensions/editorKeymap.ts` : une extension Tiptap dont
`addKeyboardShortcuts()` lit une **map de bindings vivante** fournie via options
(`getBindings(): Record<combo, actionId>` — une **ref**, pas une valeur figée). Rebinder
met à jour la ref → **pas de remount de l'éditeur**.

Elle **remplace et absorbe** `blockNavShortcuts.ts`, `blockOpsShortcuts.ts` et le chord IA
`⌘K` de `SupernoteEditor.tsx` (ces fichiers sont supprimés / leurs handlers migrés dans le
registre).

### D4 — Resolver pur (apps/web)

`apps/web/src/lib/editor-shortcuts/resolve.ts` :

```ts
function resolveBindings(
  defaults: ReadonlyArray<{ id: string; defaultCombo: string; reserved?: boolean }>,
  overrides: Record<string, string>,   // actionId -> combo
  platform: "mac" | "other",
): {
  bindings: Record<string, string>;    // combo -> actionId (résolu, normalisé)
  byAction: Record<string, string>;    // actionId -> combo (pour UI/tooltips)
  conflicts: Array<{ combo: string; actionIds: string[]; kind: "duplicate" | "reserved" | "native" }>;
};
```

Pur et testable. Normalisation des combos via `lib/keyboard/normalize.ts` (réutilisé).

### D5 — Persistance et découplage

- Override stockés dans les réglages : `settings.editorShortcuts: Record<actionId, combo>`
  (override-only ; absent = défaut du registre), via `SettingsContext` (localStorage).
- `packages/editor` **ne connaît pas** les settings. `apps/web` calcule la map résolue,
  la place dans une ref, et l'injecte dans l'éditeur (option `getBindings`). Le registre
  (métadonnées sérialisables : `{id,label,category,defaultCombo,reserved}`) est **exporté**
  par `packages/editor` pour l'UI et la cheat-sheet.

## Jeu d'actions — « classiques mais +++ »

Combos en **forme canonique** (`mod` = ⌘ sur Mac, Ctrl ailleurs). Rendu OS via `normalize.ts`.

### Format
| id | label | défaut |
|---|---|---|
| `format.bold` | Gras | `mod+b` |
| `format.italic` | Italique | `mod+i` |
| `format.underline` | Souligné | `mod+u` |
| `format.strike` | Barré | `mod+shift+s` |
| `format.code` | Code inline | `mod+e` |
| `format.link` | Lien | `mod+k` |
| `format.clear` | Effacer le format | `mod+\` |

### Bloc / type
| id | label | défaut |
|---|---|---|
| `bloc.h1` / `h2` / `h3` | Titre 1/2/3 | `mod+alt+1` / `2` / `3` |
| `bloc.bulletList` | Liste à puces | `mod+shift+8` |
| `bloc.orderedList` | Liste numérotée | `mod+shift+7` |
| `bloc.checkList` | Cases à cocher | `mod+shift+9` |
| `bloc.quote` | Citation | `mod+shift+.` |
| `bloc.codeBlock` | Bloc de code | `mod+alt+c` |
| `bloc.paragraph` | Paragraphe | `mod+alt+0` |

### Block-ops (+++)
| id | label | défaut |
|---|---|---|
| `block-ops.moveUp` / `moveDown` | Déplacer bloc ↑/↓ | `alt+up` / `alt+down` |
| `block-ops.duplicate` | Dupliquer bloc | `mod+d` |
| `block-ops.delete` | Supprimer bloc | `mod+shift+k` |
| `block-ops.select` | Sélectionner bloc | `mod+shift+l` |

### Navigation (+++ OS-safe)
| id | label | défaut |
|---|---|---|
| `navigation.prevBlock` / `nextBlock` | Bloc préc./suiv. | `alt+shift+up` / `alt+shift+down` |
| `navigation.prevHeading` / `nextHeading` | Titre préc./suiv. | `mod+alt+up` / `mod+alt+down` |

**Laissés à l'OS natif (jamais rebindés) :** mot (`alt+←/→` Mac, `ctrl+←/→` autres),
ligne (`Home`/`End`), document (`mod+Home`/`mod+End` / `mod+↑/↓` Mac). L'ancien
`Mod-Flèche=paragraphe` est **retiré**.

### Édition (+++)
| id | label | défaut |
|---|---|---|
| `edition.undo` | Annuler | `mod+z` (reserved) |
| `edition.redo` | Rétablir | `mod+shift+z` (reserved) |
| `edition.selectParagraph` | Sélectionner paragraphe | `mod+shift+a` |

(suppression de mot = comportement natif, non re-bindé.)

### IA
| id | label | défaut |
|---|---|---|
| `ia.palette` | Palette IA | `mod+j` |
| `ia.reformat` | Reformuler | (via palette, pas de combo par défaut) |
| `ia.summarize` | Résumer | (via palette) |
| `ia.fixSpelling` | Corriger l'orthographe | (via palette) |

→ **`⌘K` rendu au lien**, le chord IA `⌘K`-puis-lettre est supprimé au profit de `⌘J`.

## Remapping + gestion des conflits

- **ShortcutsTab** : nouvelle section **« Éditeur »**, groupée par catégorie. Chaque action
  affiche son combo résolu, clic-pour-réassigner (réutilise `ShortcutRow` : capture clavier
  → combo canonique), bouton « Restaurer les défauts » (vide `settings.editorShortcuts`).
- **Conflits** (calculés par le resolver, affichés inline) :
  - `duplicate` : deux actions même combo → avertissement, on garde la dernière assignée mais
    on signale.
  - `reserved` : combo qui écrase undo/redo/copier/coller/sélectionner-tout
    (`mod+z`, `mod+shift+z`, `mod+c`, `mod+v`, `mod+x`, `mod+a`) ou un
    `BLOCKED_BROWSER_COMBOS` → **réassignation bloquée**.
  - `native` : combo qui écrase la nav OS native (mot/ligne/doc) → avertissement (autorisé
    mais déconseillé).
- Combos stockés canoniques ; rendu ⌘/Ctrl selon OS.

## Découvrabilité — cheat-sheet

- **Overlay** (Modal HeroUI) `ShortcutsCheatSheet`, déclenché par `?` (uniquement hors champ
  éditable) **et** un bouton dans le chrome éditeur. Groupé par catégorie, glyphes par OS,
  filtre de recherche. **Lit la map résolue** (toujours synchro avec les rebinds).
- **Tooltips toolbar** : `editorChrome.tsx` lit le combo résolu (« Gras (⌘B) » se met à jour
  si rebindé) au lieu du texte en dur.
- **Mobile** (règle CLAUDE.md) : entrée cheat-sheet exposée via `MoreDrawer` ; la section de
  remapping rend correctement sous 768px (pas de débordement, hit-targets tactiles).

## Tests

- **Resolver** (`resolve.test.ts`, vitest, pur) : merge défauts+overrides, normalisation,
  plateforme mac/other, détection `duplicate`/`reserved`/`native`, override-only (absent=défaut).
- **Registre** : chaque `run()` testé avec un éditeur mocké (état PM simulé) — vérifie l'effet
  (toggle bold, déplace bloc, saute au titre suivant…).
- **Composants** : test léger ShortcutsTab section éditeur (rebind → updateSettings appelé) et
  cheat-sheet (rendu groupé, filtre).

## Migration

1. Créer le registre + l'extension `editorKeymap` + le resolver + la persistance.
2. Replier les handlers de `blockNavShortcuts.ts`, `blockOpsShortcuts.ts` et le chord IA `⌘K`
   de `SupernoteEditor.tsx` dans le registre comme défauts.
3. Supprimer les anciennes extensions ; vérifier **zéro double-binding**.
4. Câbler `editorChrome` (tooltips) + ShortcutsTab (section) + cheat-sheet sur la map résolue.

**Risque** : l'éditeur est délicat (consommé via `dist` → rebuild requis pour tester en app ;
piège MutationObserver PM = jamais de `setAttribute` dans le subtree éditeur). Les changements
ici sont au niveau plugin/keymap PM → faible risque DOM.

## Hors scope

- Le bug latent du **remapping global** cosmétique (`settings.shortcuts` non câblé à
  `ShortcutProvider`) — à traiter séparément.
- Mode Vim modal.
- Repli/dépli de blocs (folding) — pas de folding aujourd'hui.
- Multi-curseurs.

## Critères de succès

1. Tous les classiques marchent et sont **affichés** (toolbar + cheat-sheet) avec le bon glyphe OS.
2. La nav OS native (mot/ligne/doc) n'est **plus** écrasée.
3. Titre préc./suiv. fonctionne sur un long doc.
4. `⌘K` ouvre le lien ; la palette IA est sur `⌘J`.
5. Réassigner un combo dans ShortcutsTab change le comportement **immédiatement**, sans
   remount éditeur ; conflits réservés bloqués, doublons signalés.
6. `?` ouvre la cheat-sheet synchro avec les rebinds.
7. `pnpm typecheck` + tests vitest passent.

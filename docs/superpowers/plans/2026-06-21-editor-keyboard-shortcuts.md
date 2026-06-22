# Clavier éditeur unifié & remappable — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un clavier éditeur complet, OS-safe, remappable et découvrable (cheat-sheet), construit sur un registre d'actions unique.

**Architecture:** Registre d'actions dans `packages/editor` (source de vérité) → une extension Tiptap unique à bindings vivants. `apps/web` détient la persistance (`settings.editorShortcuts`), un resolver pur (défauts+overrides+plateforme+conflits), la section ShortcutsTab et la cheat-sheet. L'éditeur reçoit la map résolue via une prop ; il ne connaît pas les settings.

**Tech Stack:** TypeScript, Tiptap (`@tiptap/core` `Extension.create` + `addKeyboardShortcuts`), BlockNote, React, HeroUI v3, vitest, pnpm workspaces.

**Spec :** `docs/superpowers/specs/2026-06-21-editor-keyboard-shortcuts-design.md`

---

## Structure de fichiers

**`packages/editor` (créés) :**
- `src/keymap/types.ts` — `EditorAction`, `EditorActionCategory`, `EditorActionMeta` (sérialisable).
- `src/keymap/combo.ts` — `canonicalToTiptap()` (`"mod+shift+s"` → `"Mod-Shift-S"`).
- `src/keymap/actions.ts` — `EDITOR_ACTIONS` (handlers, réutilise les primitives nav/block) + `ACTION_META`.
- `src/extensions/editorKeymap.ts` — `createEditorKeymapExtension(getBindings, getBlockNote)`.

**`packages/editor` (modifiés) :**
- `src/extensions/blockNavShortcuts.ts` — garder les primitives pures, **retirer** `blockNavExtension`.
- `src/extensions/blockOpsShortcuts.ts` — garder les primitives pures, **retirer** `createBlockOpsExtension`.
- `src/SupernoteEditor.tsx` — remplacer les 2 extensions + le chord IA `⌘K` par `createEditorKeymapExtension` ; nouvelle prop `getKeymapBindings`.
- `src/index.ts` — exporter `ACTION_META`, `createEditorKeymapExtension`, types.

**`apps/web` (créés) :**
- `src/lib/editor-shortcuts/resolve.ts` + `resolve.test.ts` — resolver pur.
- `src/lib/editor-shortcuts/useEditorBindings.ts` — hook (settings → map résolue + ref vivante + conflits).
- `src/components/notes/ShortcutsCheatSheet.tsx` — overlay HeroUI.

**`apps/web` (modifiés) :**
- `src/components/settings/types.ts` — `editorShortcuts` dans `AppSettings` + union de clés.
- `src/components/settings/defaults.ts` — `editorShortcuts: {}`.
- `src/components/settings/SettingsContext.tsx` — merge défensif.
- `src/components/settings/tabs/ShortcutsTab.tsx` — section « Éditeur ».
- `src/components/notes/NoteEditor.tsx` — `useEditorBindings` → `getKeymapBindings` à l'éditeur + monter la cheat-sheet.

---

## Task 1 : Schéma settings `editorShortcuts`

**Files:**
- Modify: `apps/web/src/components/settings/types.ts:91-99`
- Modify: `apps/web/src/components/settings/defaults.ts`
- Modify: `apps/web/src/components/settings/SettingsContext.tsx:36-50`

- [ ] **Step 1 : Ajouter le champ au type `AppSettings`**

Dans `types.ts`, ajouter dans l'interface `AppSettings` (à côté de `shortcuts: Shortcut[];`) :

```ts
  /** Overrides utilisateur des raccourcis éditeur : actionId -> combo canonique. Absent = défaut. */
  editorShortcuts: Record<string, string>;
```

Et ajouter `"editorShortcuts"` à l'union de clés de settings en haut du fichier (la liste qui contient déjà `"shortcuts"`).

- [ ] **Step 2 : Défaut vide**

Dans `defaults.ts`, dans `DEFAULT_SETTINGS`, ajouter :

```ts
  editorShortcuts: {},
```

- [ ] **Step 3 : Merge défensif au chargement**

Dans `SettingsContext.tsx`, dans le bloc de merge (vers la ligne 49, à côté de `shortcuts: parsed.shortcuts ?? DEFAULT_SETTINGS.shortcuts,`), ajouter :

```ts
      editorShortcuts: parsed.editorShortcuts ?? DEFAULT_SETTINGS.editorShortcuts,
```

- [ ] **Step 4 : Typecheck**

Run: `pnpm --filter @supernote/web typecheck`
Expected: PASS (aucune erreur).

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/components/settings/types.ts apps/web/src/components/settings/defaults.ts apps/web/src/components/settings/SettingsContext.tsx
git commit -m "feat(editor): schéma settings editorShortcuts"
```

---

## Task 2 : Conversion combo canonique → Tiptap

Tiptap attend `"Mod-Shift-S"` ; les settings stockent `"mod+shift+s"`. Pure, testable.

**Files:**
- Create: `packages/editor/src/keymap/combo.ts`
- Test: `packages/editor/src/keymap/combo.test.ts`

- [ ] **Step 1 : Test d'abord**

```ts
import { describe, it, expect } from "vitest";
import { canonicalToTiptap } from "./combo";

describe("canonicalToTiptap", () => {
  it("met en forme Tiptap (modificateurs capitalisés, '+'→'-')", () => {
    expect(canonicalToTiptap("mod+b")).toBe("Mod-b");
    expect(canonicalToTiptap("mod+shift+s")).toBe("Mod-Shift-s");
    expect(canonicalToTiptap("alt+up")).toBe("Alt-ArrowUp");
    expect(canonicalToTiptap("alt+shift+down")).toBe("Alt-Shift-ArrowDown");
    expect(canonicalToTiptap("mod+alt+1")).toBe("Mod-Alt-1");
  });
  it("renvoie '' pour un combo vide", () => {
    expect(canonicalToTiptap("")).toBe("");
  });
});
```

- [ ] **Step 2 : Lancer le test (échec attendu)**

Run: `pnpm --filter @supernote/editor exec vitest run src/keymap/combo.test.ts`
Expected: FAIL (`canonicalToTiptap` n'existe pas).

- [ ] **Step 3 : Implémentation**

```ts
const MODIFIERS: Record<string, string> = {
  mod: "Mod",
  ctrl: "Ctrl",
  meta: "Mod", // Tiptap résout Mod selon la plateforme
  alt: "Alt",
  shift: "Shift",
};

const KEY_ALIASES: Record<string, string> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

/** "mod+shift+s" -> "Mod-Shift-s" (format keymap Tiptap). "" -> "". */
export function canonicalToTiptap(combo: string): string {
  if (!combo) return "";
  return combo
    .toLowerCase()
    .split("+")
    .map((p) => MODIFIERS[p] ?? KEY_ALIASES[p] ?? p)
    .join("-");
}
```

- [ ] **Step 4 : Le test passe**

Run: `pnpm --filter @supernote/editor exec vitest run src/keymap/combo.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5 : Commit**

```bash
git add packages/editor/src/keymap/combo.ts packages/editor/src/keymap/combo.test.ts
git commit -m "feat(editor): conversion combo canonique -> format Tiptap"
```

---

## Task 3 : Resolver pur (apps/web)

**Files:**
- Create: `apps/web/src/lib/editor-shortcuts/resolve.ts`
- Test: `apps/web/src/lib/editor-shortcuts/resolve.test.ts`

- [ ] **Step 1 : Test d'abord**

```ts
import { describe, it, expect } from "vitest";
import { resolveBindings, type ResolverActionMeta } from "./resolve";

const META: ResolverActionMeta[] = [
  { id: "format.bold", defaultCombo: "mod+b" },
  { id: "format.link", defaultCombo: "mod+k" },
  { id: "edition.undo", defaultCombo: "mod+z", reserved: true },
];

describe("resolveBindings", () => {
  it("utilise les défauts quand pas d'override", () => {
    const r = resolveBindings(META, {});
    expect(r.byAction["format.bold"]).toBe("mod+b");
    expect(r.bindings["mod+b"]).toBe("format.bold");
    expect(r.conflicts).toHaveLength(0);
  });

  it("applique un override", () => {
    const r = resolveBindings(META, { "format.bold": "mod+shift+b" });
    expect(r.byAction["format.bold"]).toBe("mod+shift+b");
    expect(r.bindings["mod+shift+b"]).toBe("format.bold");
    expect(r.bindings["mod+b"]).toBeUndefined();
  });

  it("signale un doublon (deux actions, même combo)", () => {
    const r = resolveBindings(META, { "format.link": "mod+b" });
    const dup = r.conflicts.find((c) => c.kind === "duplicate");
    expect(dup?.combo).toBe("mod+b");
    expect(dup?.actionIds.sort()).toEqual(["format.bold", "format.link"]);
  });

  it("signale un combo réservé écrasé", () => {
    const r = resolveBindings(META, { "format.bold": "mod+c" });
    expect(r.conflicts.some((c) => c.kind === "reserved" && c.combo === "mod+c")).toBe(true);
  });

  it("signale l'écrasement d'une nav OS native", () => {
    const r = resolveBindings(META, { "format.bold": "alt+left" });
    expect(r.conflicts.some((c) => c.kind === "native")).toBe(true);
  });
});
```

- [ ] **Step 2 : Lancer (échec attendu)**

Run: `pnpm --filter @supernote/web exec vitest run src/lib/editor-shortcuts/resolve.test.ts`
Expected: FAIL (`resolveBindings` absent).

- [ ] **Step 3 : Implémentation**

```ts
export interface ResolverActionMeta {
  id: string;
  defaultCombo: string;
  reserved?: boolean;
}

export interface BindingConflict {
  combo: string;
  actionIds: string[];
  kind: "duplicate" | "reserved" | "native";
}

export interface ResolvedBindings {
  bindings: Record<string, string>; // combo -> actionId
  byAction: Record<string, string>; // actionId -> combo
  conflicts: BindingConflict[];
}

// Combos non réassignables (édition/clipboard) — un override dessus est bloqué côté UI.
const RESERVED = new Set(["mod+z", "mod+shift+z", "mod+c", "mod+v", "mod+x", "mod+a"]);
// Nav OS native qu'on déconseille d'écraser (avertissement, pas blocage).
const NATIVE = new Set([
  "alt+left", "alt+right", "ctrl+left", "ctrl+right",
  "home", "end", "mod+home", "mod+end", "mod+up", "mod+down",
]);

export function resolveBindings(
  meta: ReadonlyArray<ResolverActionMeta>,
  overrides: Record<string, string>,
): ResolvedBindings {
  const byAction: Record<string, string> = {};
  for (const a of meta) {
    const combo = (overrides[a.id] ?? a.defaultCombo).trim().toLowerCase();
    if (combo) byAction[a.id] = combo;
  }

  const bindings: Record<string, string> = {};
  const comboToActions = new Map<string, string[]>();
  for (const [actionId, combo] of Object.entries(byAction)) {
    bindings[combo] = actionId; // dernier gagne ; doublon signalé ci-dessous
    comboToActions.set(combo, [...(comboToActions.get(combo) ?? []), actionId]);
  }

  const conflicts: BindingConflict[] = [];
  for (const [combo, actionIds] of comboToActions) {
    if (actionIds.length > 1) conflicts.push({ combo, actionIds, kind: "duplicate" });
    if (RESERVED.has(combo)) conflicts.push({ combo, actionIds, kind: "reserved" });
    else if (NATIVE.has(combo)) conflicts.push({ combo, actionIds, kind: "native" });
  }

  return { bindings, byAction, conflicts };
}
```

- [ ] **Step 4 : Le test passe**

Run: `pnpm --filter @supernote/web exec vitest run src/lib/editor-shortcuts/resolve.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/lib/editor-shortcuts/resolve.ts apps/web/src/lib/editor-shortcuts/resolve.test.ts
git commit -m "feat(editor): resolver de bindings (défauts+overrides+conflits)"
```

---

## Task 4 : Registre d'actions éditeur

Réutilise les primitives existantes (`resolveBlockNavTarget`, `collectTextblockRanges`, `resolveSelectExtendTarget`, `duplicateCurrentBlock`, `cloneBlockWithoutIds`) en les gardant exportées depuis `blockNavShortcuts.ts` / `blockOpsShortcuts.ts`. Ajoute une primitive titre.

**Files:**
- Create: `packages/editor/src/keymap/types.ts`
- Create: `packages/editor/src/keymap/actions.ts`
- Modify: `packages/editor/src/extensions/blockNavShortcuts.ts` (ajouter `collectHeadingRanges`, exporter `navigate` helpers réutilisables)
- Test: `packages/editor/src/keymap/actions.test.ts`

- [ ] **Step 1 : Types**

`keymap/types.ts` :

```ts
import type { Editor } from "@tiptap/core";

export type EditorActionCategory =
  | "format" | "bloc" | "navigation" | "block-ops" | "edition" | "ia";

/** Sous-ensemble BlockNote requis par les handlers (cf. BlockOpsEditorLike). */
export type KeymapBlockNote = import("../extensions/blockOpsShortcuts.js").BlockOpsEditorLike;

export interface EditorActionContext {
  editor: Editor;             // éditeur Tiptap (formatage, sélection)
  blockNote: KeymapBlockNote | null; // API BlockNote (move/duplicate), peut être null
}

export interface EditorAction {
  id: string;
  label: string;
  category: EditorActionCategory;
  defaultCombo: string;       // canonique ("mod+b"), "" si pas de défaut
  reserved?: boolean;
  run: (ctx: EditorActionContext) => boolean;
}

/** Métadonnées sérialisables (sans handler) exposées à l'UI/cheat-sheet/resolver. */
export interface EditorActionMeta {
  id: string;
  label: string;
  category: EditorActionCategory;
  defaultCombo: string;
  reserved?: boolean;
}
```

- [ ] **Step 2 : Primitive titre dans `blockNavShortcuts.ts`**

Ajouter (à côté de `collectTextblockRanges`) :

```ts
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
```

- [ ] **Step 3 : Registre `actions.ts`**

```ts
import type { EditorAction, EditorActionMeta } from "./types.js";
import {
  collectTextblockRanges, resolveBlockNavTarget,
  collectHeadingStarts, resolveHeadingTarget,
} from "../extensions/blockNavShortcuts.js";
import {
  duplicateCurrentBlock, // exporté en Task 4 Step 4
} from "../extensions/blockOpsShortcuts.js";

const fmt = (cmd: (c: ReturnType<import("@tiptap/core").Editor["chain"]>) => unknown) =>
  ({ editor }: import("./types.js").EditorActionContext) => { cmd(editor.chain()); return true; };

export const EDITOR_ACTIONS: readonly EditorAction[] = [
  // ── Navigation (OS-safe) ───────────────────────────────────────────────
  {
    id: "navigation.prevBlock", label: "Bloc précédent", category: "navigation",
    defaultCombo: "alt+shift+up",
    run: ({ editor }) => jumpBlock(editor, "up"),
  },
  {
    id: "navigation.nextBlock", label: "Bloc suivant", category: "navigation",
    defaultCombo: "alt+shift+down",
    run: ({ editor }) => jumpBlock(editor, "down"),
  },
  {
    id: "navigation.prevHeading", label: "Titre précédent", category: "navigation",
    defaultCombo: "mod+alt+up",
    run: ({ editor }) => jumpHeading(editor, "prev"),
  },
  {
    id: "navigation.nextHeading", label: "Titre suivant", category: "navigation",
    defaultCombo: "mod+alt+down",
    run: ({ editor }) => jumpHeading(editor, "next"),
  },
  // ── Block-ops ──────────────────────────────────────────────────────────
  {
    id: "block-ops.moveUp", label: "Déplacer le bloc vers le haut", category: "block-ops",
    defaultCombo: "alt+up",
    run: ({ blockNote }) => { if (!blockNote) return false; blockNote.moveBlocksUp(); return true; },
  },
  {
    id: "block-ops.moveDown", label: "Déplacer le bloc vers le bas", category: "block-ops",
    defaultCombo: "alt+down",
    run: ({ blockNote }) => { if (!blockNote) return false; blockNote.moveBlocksDown(); return true; },
  },
  {
    id: "block-ops.duplicate", label: "Dupliquer le bloc", category: "block-ops",
    defaultCombo: "mod+d",
    run: ({ blockNote }) => (blockNote ? duplicateCurrentBlock(blockNote) : false),
  },
  // ── Édition ────────────────────────────────────────────────────────────
  {
    id: "edition.selectParagraph", label: "Sélectionner le paragraphe", category: "edition",
    defaultCombo: "mod+shift+a",
    run: ({ editor }) => selectParagraph(editor),
  },
];

function jumpBlock(editor: import("@tiptap/core").Editor, dir: "up" | "down"): boolean {
  const head = editor.state.selection.head;
  const target = resolveBlockNavTarget(collectTextblockRanges(editor), head, dir);
  if (target == null) return true;
  return editor.chain().setTextSelection(target).scrollIntoView().run();
}

function jumpHeading(editor: import("@tiptap/core").Editor, dir: "prev" | "next"): boolean {
  const head = editor.state.selection.head;
  const target = resolveHeadingTarget(collectHeadingStarts(editor), head, dir);
  if (target == null) return true;
  return editor.chain().setTextSelection(target).scrollIntoView().run();
}

function selectParagraph(editor: import("@tiptap/core").Editor): boolean {
  const head = editor.state.selection.head;
  const r = collectTextblockRanges(editor).find((x) => head >= x.from && head <= x.to);
  if (!r) return false;
  return editor.chain().setTextSelection({ from: r.from, to: r.to }).run();
}

export const ACTION_META: readonly EditorActionMeta[] = EDITOR_ACTIONS.map(
  ({ id, label, category, defaultCombo, reserved }) => ({ id, label, category, defaultCombo, reserved }),
);
```

> NOTE : les actions de **formatage** (`format.*`) et **bloc/type** (`bloc.*`) ne sont PAS dans ce registre tant que la Task 8 (spike) n'a pas validé l'override du keymap BlockNote. Elles seront ajoutées soit comme actions remappables (si l'override marche), soit comme entrées **display-only** dans la cheat-sheet (Task 7). Ce registre couvre d'abord nav + block-ops + édition, déjà custom et sûrs.

- [ ] **Step 4 : Exporter `duplicateCurrentBlock`**

Dans `blockOpsShortcuts.ts`, changer `function duplicateCurrentBlock` en `export function duplicateCurrentBlock`.

- [ ] **Step 5 : Test du registre (handlers avec éditeur mocké)**

`keymap/actions.test.ts` — teste les helpers purs via les primitives déjà testées + un faux `editor.chain()` :

```ts
import { describe, it, expect, vi } from "vitest";
import { resolveHeadingTarget } from "../extensions/blockNavShortcuts";
import { ACTION_META, EDITOR_ACTIONS } from "./actions";

describe("registre d'actions", () => {
  it("ACTION_META reflète EDITOR_ACTIONS sans handler", () => {
    expect(ACTION_META).toHaveLength(EDITOR_ACTIONS.length);
    expect(ACTION_META.every((m) => !("run" in m))).toBe(true);
    expect(new Set(ACTION_META.map((m) => m.id)).size).toBe(ACTION_META.length); // ids uniques
  });
  it("aucune collision de defaultCombo non vide", () => {
    const used = ACTION_META.map((m) => m.defaultCombo).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
  });
  it("resolveHeadingTarget saute au bon titre", () => {
    expect(resolveHeadingTarget([5, 20, 40], 10, "next")).toBe(20);
    expect(resolveHeadingTarget([5, 20, 40], 25, "prev")).toBe(20);
    expect(resolveHeadingTarget([5, 20, 40], 50, "next")).toBeNull();
  });
  it("block-ops.moveUp appelle moveBlocksUp", () => {
    const bn = { moveBlocksUp: vi.fn() } as never;
    const action = EDITOR_ACTIONS.find((a) => a.id === "block-ops.moveUp")!;
    expect(action.run({ editor: {} as never, blockNote: bn })).toBe(true);
    expect((bn as { moveBlocksUp: ReturnType<typeof vi.fn> }).moveBlocksUp).toHaveBeenCalled();
  });
});
```

- [ ] **Step 6 : Lancer**

Run: `pnpm --filter @supernote/editor exec vitest run src/keymap/actions.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7 : Commit**

```bash
git add packages/editor/src/keymap/ packages/editor/src/extensions/blockNavShortcuts.ts packages/editor/src/extensions/blockOpsShortcuts.ts
git commit -m "feat(editor): registre d'actions clavier (nav, block-ops, édition)"
```

---

## Task 5 : Extension keymap unique + branchement SupernoteEditor

**Files:**
- Create: `packages/editor/src/extensions/editorKeymap.ts`
- Modify: `packages/editor/src/SupernoteEditor.tsx:152-158` (registration) + signature des props
- Modify: `packages/editor/src/extensions/blockNavShortcuts.ts` (retirer `blockNavExtension`)
- Modify: `packages/editor/src/extensions/blockOpsShortcuts.ts` (retirer `createBlockOpsExtension`, garder primitives + `extendSelection`/`selectBlockForCut` repliés dans le registre si voulus plus tard)
- Modify: `packages/editor/src/index.ts`

- [ ] **Step 1 : Extension**

`editorKeymap.ts` :

```ts
import { Extension } from "@tiptap/core";
import { EDITOR_ACTIONS } from "../keymap/actions.js";
import { canonicalToTiptap } from "../keymap/combo.js";
import type { KeymapBlockNote } from "../keymap/types.js";

/**
 * Extension Tiptap unique. `getBindings` renvoie la map vivante combo->actionId
 * (résolue côté app à partir des settings) ; lue à CHAQUE frappe via une ref,
 * donc rebinder ne remonte pas l'éditeur. `getBlockNote` résout l'API BlockNote
 * à la frappe (même pattern que les anciennes extensions).
 */
export function createEditorKeymapExtension(
  getBindings: () => Record<string, string>,
  getBlockNote: () => KeymapBlockNote | null,
): Extension {
  const actionById = new Map(EDITOR_ACTIONS.map((a) => [a.id, a]));
  return Extension.create({
    name: "supernoteEditorKeymap",
    addKeyboardShortcuts() {
      const shortcuts: Record<string, (p: { editor: import("@tiptap/core").Editor }) => boolean> = {};
      // On enregistre une entrée Tiptap par défaut de chaque action ; le handler
      // re-vérifie le binding vivant pour respecter les rebinds dynamiques.
      for (const action of EDITOR_ACTIONS) {
        const register = (tiptapKey: string) => {
          if (!tiptapKey) return;
          shortcuts[tiptapKey] = ({ editor }) => {
            const liveCombo = bindingForAction(getBindings(), action.id);
            if (!liveCombo) return false;
            if (canonicalToTiptap(liveCombo) !== tiptapKey) return false; // rebindé ailleurs
            return action.run({ editor, blockNote: getBlockNote() });
          };
        };
        register(canonicalToTiptap(action.defaultCombo));
      }
      return shortcuts;
    },
  });
}

function bindingForAction(bindings: Record<string, string>, actionId: string): string | null {
  for (const [combo, id] of Object.entries(bindings)) if (id === actionId) return combo;
  return null;
}
```

> Limite assumée (documentée) : un combo **rebindé sur une touche non pré-enregistrée** par un défaut ne sera pris en compte qu'après recréation de l'extension. Pour couvrir le rebind arbitraire à chaud, la Task 6 recrée l'éditeur (key React) quand l'ensemble des combos change — voir Task 6 Step 3.

- [ ] **Step 2 : Brancher dans SupernoteEditor**

Dans `SupernoteEditor.tsx`, remplacer les imports `blockNavExtension` / `createBlockOpsExtension` par :

```ts
import { createEditorKeymapExtension } from "./extensions/editorKeymap.js";
```

Ajouter une prop (dans l'interface des props du composant) :

```ts
  /** Map vivante combo->actionId. Défaut : registre interne si absent. */
  getKeymapBindings?: () => Record<string, string>;
```

Remplacer dans `_tiptapOptions.extensions` (lignes 156-157) les deux entrées par :

```ts
          createEditorKeymapExtension(
            getKeymapBindings ?? defaultBindings,
            () => blockNoteRef.current,
          ),
```

Et au-dessus du composant, le fallback (défauts du registre) :

```ts
import { ACTION_META } from "./keymap/actions.js";
const defaultBindings = (): Record<string, string> => {
  const m: Record<string, string> = {};
  for (const a of ACTION_META) if (a.defaultCombo) m[a.defaultCombo] = a.id;
  return m;
};
```

- [ ] **Step 3 : Retirer les anciennes extensions**

Dans `blockNavShortcuts.ts`, supprimer l'export `blockNavExtension` (garder toutes les fonctions primitives). Dans `blockOpsShortcuts.ts`, supprimer `createBlockOpsExtension` (garder `cloneBlockWithoutIds`, `duplicateCurrentBlock`, `BlockOpsEditorLike`, `extendSelection`, `selectBlockForCut`).

- [ ] **Step 4 : Exports**

Dans `packages/editor/src/index.ts`, ajouter :

```ts
export { createEditorKeymapExtension } from "./extensions/editorKeymap.js";
export { ACTION_META } from "./keymap/actions.js";
export type { EditorActionMeta, EditorActionCategory } from "./keymap/types.js";
```

- [ ] **Step 5 : Build + typecheck éditeur (consommé via dist)**

Run: `pnpm --filter @supernote/editor build && pnpm --filter @supernote/editor typecheck`
Expected: PASS. (L'éditeur est consommé via `dist` — le build est requis pour que `apps/web` voie les nouveaux exports.)

- [ ] **Step 6 : Commit**

```bash
git add packages/editor/src
git commit -m "feat(editor): extension keymap unique remplace blockNav/blockOps"
```

---

## Task 6 : Hook `useEditorBindings` + branchement NoteEditor

**Files:**
- Create: `apps/web/src/lib/editor-shortcuts/useEditorBindings.ts`
- Modify: `apps/web/src/components/notes/NoteEditor.tsx` (instancier le hook, passer `getKeymapBindings`, clé de remount)

- [ ] **Step 1 : Hook**

```ts
"use client";
import { useMemo, useRef } from "react";
import { ACTION_META } from "@supernote/editor";
import { useSettings } from "@/components/settings/SettingsContext";
import { resolveBindings, type ResolvedBindings } from "./resolve";

export function useEditorBindings(): {
  resolved: ResolvedBindings;
  getBindings: () => Record<string, string>;
  /** Change quand l'ensemble des combos change → sert de clé de remount éditeur. */
  bindingsKey: string;
} {
  const { settings } = useSettings();
  const overrides = settings.editorShortcuts;
  const resolved = useMemo(
    () => resolveBindings(ACTION_META, overrides),
    [overrides],
  );
  // Ref vivante lue par l'extension Tiptap à chaque frappe (pas de remount au rebind
  // tant que la touche reste pré-enregistrée).
  const ref = useRef(resolved.bindings);
  ref.current = resolved.bindings;
  const getBindings = useMemo(() => () => ref.current, []);
  const bindingsKey = useMemo(
    () => Object.entries(resolved.bindings).sort().map(([c, a]) => `${c}:${a}`).join("|"),
    [resolved.bindings],
  );
  return { resolved, getBindings, bindingsKey };
}
```

- [ ] **Step 2 : Brancher dans NoteEditor**

Dans `NoteEditor.tsx`, instancier le hook et passer `getKeymapBindings={getBindings}` au composant `<SupernoteEditor … />`. Concaténer `bindingsKey` à la `key` déjà utilisée pour remonter l'éditeur (cf. `key={`${note.id}:${viewMode}`}` côté page), afin que tout rebind arbitraire (touche non pré-enregistrée) prenne effet via remount :

```tsx
const { getBindings, bindingsKey } = useEditorBindings();
// …
<SupernoteEditor
  /* …props existantes… */
  getKeymapBindings={getBindings}
/>
```

Et propager `bindingsKey` jusqu'à la `key` de l'éditeur (passer une prop ou inclure dans la clé du wrapper). Le remount n'arrive qu'au **rebind**, pas à la frappe.

- [ ] **Step 3 : Typecheck**

Run: `pnpm --filter @supernote/web typecheck`
Expected: PASS.

- [ ] **Step 4 : Vérif manuelle (dev server)**

Run: `pnpm dev:web` puis ouvrir une note. Vérifier dans la console : pas d'erreur ; `Alt+Shift+↓` saute au bloc suivant ; `⌘/Ctrl+Alt+↓` saute au titre suivant ; `Alt+↑/↓` déplace le bloc ; `⌘/Ctrl+D` duplique. Vérifier que `⌘/Ctrl+←/→` fait de nouveau la nav **native** (mot/ligne), plus paragraphe.

- [ ] **Step 5 : Commit**

```bash
git add apps/web/src/lib/editor-shortcuts/useEditorBindings.ts apps/web/src/components/notes/NoteEditor.tsx
git commit -m "feat(editor): câbler les bindings résolus dans l'éditeur"
```

---

## Task 7 : Section « Éditeur » dans ShortcutsTab + cheat-sheet

**Files:**
- Modify: `apps/web/src/components/settings/tabs/ShortcutsTab.tsx`
- Create: `apps/web/src/components/notes/ShortcutsCheatSheet.tsx`
- Modify: `apps/web/src/components/notes/NoteEditor.tsx` (monter la cheat-sheet + trigger `?`)
- Modify: `packages/editor/src/extensions/editorChrome.tsx:40-41` (tooltips lisent le combo résolu — voir Task 8 si format remappable)

- [ ] **Step 1 : Section éditeur dans ShortcutsTab**

Ajouter sous la section existante une `SettingSection` « Raccourcis éditeur » qui mappe `ACTION_META` groupé par `category`, affiche le combo résolu (`resolved.byAction[id]` via `useEditorBindings`), réutilise `ShortcutRow` (capture clavier → combo canonique), et écrit via `updateSettings("editorShortcuts", { ...overrides, [id]: combo })`. Afficher un badge d'avertissement pour chaque `conflict` (`duplicate`/`native`) et **désactiver** la sauvegarde si le nouveau combo est `reserved` (le resolver le marque). Bouton « Restaurer les défauts » → `updateSettings("editorShortcuts", {})`.

```tsx
// extrait — la section :
const { resolved } = useEditorBindings();
const overrides = settings.editorShortcuts;
const grouped = useMemo(() => groupBy(ACTION_META, (a) => a.category), []);
const conflictByAction = useMemo(() => indexConflicts(resolved.conflicts), [resolved]);
// rendu : pour chaque catégorie -> titre + lignes ShortcutRow{ label, keys: resolved.byAction[id] }
// onEdit(combo) => updateSettings("editorShortcuts", { ...overrides, [id]: toCanonical(combo) })
```

(Réutiliser le pattern `handleKeyDown` existant de `ShortcutRow` ; ajouter un helper `toCanonical` qui transforme la capture `"Cmd+Shift+S"` en `"mod+shift+s"`.)

- [ ] **Step 2 : Composant cheat-sheet**

`ShortcutsCheatSheet.tsx` : `Modal` HeroUI (`isOpen`, `onClose`), lit `useEditorBindings().resolved.byAction` + `ACTION_META`, groupe par catégorie, rend chaque ligne `label` + combo (formaté ⌘/Ctrl via `normalizeCombo` + un `prettyCombo`), `Input` de filtre en haut. Aucune logique d'édition.

- [ ] **Step 3 : Trigger `?` + montage**

Dans `NoteEditor.tsx` (ou le shell éditeur), ajouter un état `cheatOpen` et un listener : `?` (touche `?`, sans modificateur) ouvre la cheat-sheet **uniquement** si la cible n'est pas un champ éditable (`document.activeElement` pas `[contenteditable]`/input/textarea). Monter `<ShortcutsCheatSheet isOpen={cheatOpen} onClose={…} />`. Exposer aussi l'entrée via `MoreDrawer` (mobile, règle CLAUDE.md) : ajouter une action « Raccourcis clavier » qui ouvre la même modal.

- [ ] **Step 4 : Typecheck + tests**

Run: `pnpm --filter @supernote/web typecheck && pnpm --filter @supernote/web test`
Expected: PASS (tous, dont resolve.test).

- [ ] **Step 5 : Vérif manuelle**

Dev server : ouvrir Réglages → Raccourcis → section Éditeur, réassigner « Titre suivant » à `⌘+↓`… vérifier l'avertissement `native`, réassigner ailleurs, vérifier effet immédiat. Presser `?` hors éditeur → cheat-sheet s'ouvre, synchro avec le rebind. Filtre fonctionne.

- [ ] **Step 6 : Commit**

```bash
git add apps/web/src/components/settings/tabs/ShortcutsTab.tsx apps/web/src/components/notes/ShortcutsCheatSheet.tsx apps/web/src/components/notes/NoteEditor.tsx
git commit -m "feat(editor): remapping UI + cheat-sheet des raccourcis éditeur"
```

---

## Task 8 : SPIKE — formatage/bloc BlockNote remappables (recherche avant code)

Les classiques de formatage (`⌘B`…) et changements de type (titres/listes) sont fournis par **BlockNote/Tiptap interne**. Les rendre remappables exige d'**overrider** leur keymap. Cette tâche **investigue puis décide** — pas de code inventé.

**Files:** lecture seule d'abord.

- [ ] **Step 1 : Investiguer le keymap BlockNote**

Lire comment BlockNote enregistre ses raccourcis de formatage et l'ordre de priorité des extensions Tiptap :
- `grep -rn "addKeyboardShortcuts\|Mod-b\|toggleBold\|priority" node_modules/.pnpm/@blocknote*/`
- Vérifier si une extension ajoutée via `_tiptapOptions.extensions` (donc APRÈS le cœur) gagne la priorité clavier sur `Mod-b`.
- Tester empiriquement : enregistrer `format.bold` (`mod+b`) dans `EDITOR_ACTIONS` avec `run: ({editor}) => editor.chain().toggleBold().run()` et voir si notre handler intercepte ou si BlockNote gagne.

- [ ] **Step 2 : Décision**

- **Si l'override marche** : ajouter les actions `format.*` et `bloc.*` au registre (Task 4 pattern), avec handlers `editor.chain().toggle…().run()`. Elles deviennent remappables ; mettre à jour `editorChrome.tsx` tooltips pour lire `resolved.byAction`.
- **Si l'override ne marche pas proprement** : garder les classiques en **display-only** dans la cheat-sheet (ajouter une liste statique `BUILTIN_SHORTCUTS` documentant les combos BlockNote, marquée « non réassignable ») et noter la limitation dans le spec. Le remapping reste effectif pour nos actions custom.

- [ ] **Step 3 : Implémenter la branche choisie**

Écrire le code de la décision Step 2 (actions format/bloc OU liste display-only), avec tests cohérents (registre : pas de collision ; cheat-sheet : rendu des builtins).

- [ ] **Step 4 : Tooltips**

Si format remappable : `editorChrome.tsx` lignes 40-41 — remplacer `title: "Gras (Ctrl+B)"` en dur par un titre dérivé du combo résolu (passer `resolved.byAction` ou un `prettyCombo(actionId)` via contexte/prop). Sinon, laisser tel quel.

- [ ] **Step 5 : Build éditeur + typecheck + tests**

Run: `pnpm --filter @supernote/editor build && pnpm typecheck && pnpm --filter @supernote/web test`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add -A
git commit -m "feat(editor): formatage remappable OU cheat-sheet builtins (selon spike)"
```

---

## Task 9 : Vérification finale

- [ ] **Step 1 : Typecheck global**

Run: `pnpm typecheck`
Expected: 23/23 PASS.

- [ ] **Step 2 : Tests**

Run: `pnpm --filter @supernote/web test && pnpm --filter @supernote/editor test`
Expected: PASS (dont combo, resolve, actions).

- [ ] **Step 3 : Checklist manuelle (dev server, desktop + viewport mobile)**

Vérifier les 7 critères de succès du spec :
1. Classiques affichés avec bon glyphe OS (toolbar + cheat-sheet).
2. Nav OS native (mot/ligne/doc) non écrasée.
3. Titre préc./suiv. sur un long doc.
4. `⌘K` = lien ; palette IA sur `⌘J`.
5. Rebind dans ShortcutsTab → effet immédiat ; réservé bloqué, doublon signalé.
6. `?` ouvre la cheat-sheet synchro.
7. Mobile : cheat-sheet via MoreDrawer, section remapping sans débordement.

- [ ] **Step 4 : Commit final éventuel** (si ajustements)

```bash
git add -A
git commit -m "chore(editor): finalisation clavier remappable"
```

---

## Auto-review du plan

- **Couverture spec** : architecture (T4/T5), resolver+conflits (T3), persistance (T1), actions nav/block/édition (T4), extension unique + migration (T5), branchement app + remount (T6), remapping UI + cheat-sheet + mobile (T7), formatage/bloc remappable (T8 spike), tests (T2/T3/T4 + T9). Critères de succès → T9 Step 3. ✓
- **Risque assumé** : remapping des **classiques BlockNote** dépend du spike T8 — isolé exprès, avec branche de repli display-only. La nav OS-safe + le `⌘K`→lien (suppression du chord IA, déplacé `⌘J`) sont traités en T5/T8.
- **Cohérence des types** : `ACTION_META`/`EDITOR_ACTIONS`/`EditorActionContext`/`resolveBindings`/`editorShortcuts` cohérents entre T1–T7. `getKeymapBindings` (prop) ↔ `getBindings` (hook) ↔ `getBindings()` (extension) alignés.

# Correctifs UX P3 — Confirmations destructives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les confirmations inline ad-hoc des actions destructives "delete field" (Findings #6) et "delete view" (Findings #7) par le hook `useConfirm()` introduit dans la Foundation. Premier vrai consumer de `useConfirm`, sert également de smoke test (cf. Foundation Task 8 différé).

**Architecture:** Les deux composants ont aujourd'hui un état local `confirmDelete: boolean` qui bascule l'UI inline. On retire ce state, on appelle `await confirm({...})` directement avant la mutation. Le ré-affichage inline disparaît.

**Tech Stack:** React 19, `@heroui/react` v3, `@supernote/ui` (Modal), `useConfirm` (`@/lib/confirm`).

---

## Spec couvert

Spec : `docs/superpowers/specs/2026-05-15-correctifs-ux-high-design.md` findings **#6** et **#7**.

Finding **#9** (rename column commit on blur) déjà implémenté : `ColumnHeaderMenu.tsx:161` a `onBlur={commitRename}` et le handler `Escape` revert sans commit (`onClose()` ligne 146). Hors scope — aucun changement de code requis.

## File Structure

### Fichiers modifiés

| Path | Modification |
| --- | --- |
| `apps/web/src/components/bases/ColumnEditorSidebar.tsx` | Retirer `confirmDelete` state local du sous-composant `SortableFieldRow`. Remplacer le bouton de bascule par un seul bouton "Supprimer" qui appelle `await confirm()` puis `onDelete()` si confirmé. |
| `apps/web/src/components/bases/ViewSettingsMenu.tsx` | Retirer `confirmDelete` state local. Remplacer le rendu `confirmDelete ? "Confirmer ?" : ...` par un seul bouton "Supprimer" qui appelle `await confirm()` puis `remove()` si confirmé. |

### Aucun nouveau fichier.

## Conventions

- HeroUI v3 (`Button` from `@heroui/react`) — aucun `<button>` HTML nu.
- TypeScript strict, pas d'`any`.
- Conventional commits FR.
- Pas de modification des mutations tRPC sous-jacentes — uniquement le geste utilisateur.

---

## Task 1 : Confirmation modale pour suppression de champ (Finding #6)

**Files:**
- Modify: `apps/web/src/components/bases/ColumnEditorSidebar.tsx`

### État actuel à connaître

Le sous-composant `SortableFieldRow` (autour de la ligne 318) possède :

```ts
const [confirmDelete, setConfirmDelete] = useState(false);
```

Rendu autour de la ligne 387 :

```tsx
{!confirmDelete ? (
  <Button
    variant="ghost"
    size="sm"
    onPress={() => setConfirmDelete(true)}
    className="rounded p-1 hover:bg-[var(--surface-3)]"
    style={{ color: "var(--text-muted)" }}
    aria-label="Supprimer"
  >
    <Trash size={12} />
  </Button>
) : (
  <Button
    variant="danger"
    size="sm"
    onPress={() => { onDelete(); setConfirmDelete(false); }}
    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
    style={{ backgroundColor: "var(--destructive)", color: "#fff" }}
    aria-label="Confirmer la suppression"
  >
    Suppr.
  </Button>
)}
```

### Cible

Un seul bouton trash → ouvre `useConfirm` modal → si confirmé, `onDelete()`.

- [ ] **Step 1 : Ajouter l'import useConfirm**

Trouve les imports en haut du fichier. Ajoute :

```ts
import { useConfirm } from "@/lib/confirm";
```

- [ ] **Step 2 : Récupérer le nom du champ pour le message**

`SortableFieldRow` reçoit déjà `field` en props (vérifier la signature). Le label affiché à l'utilisateur est `field.label || field.name`. Utilise cette valeur dans le body du confirm pour personnaliser le message (« Supprimer le champ "Titre" ? »).

- [ ] **Step 3 : Câbler useConfirm**

Dans le corps de `SortableFieldRow`, juste après les autres hooks (et avant les handlers existants), ajouter :

```ts
const confirm = useConfirm();
```

- [ ] **Step 4 : Remplacer le rendu**

Supprimer la déclaration `const [confirmDelete, setConfirmDelete] = useState(false);` ainsi que tout usage de `confirmDelete` / `setConfirmDelete`. Remplacer le bloc `{!confirmDelete ? (...) : (...)}` par :

```tsx
<Button
  variant="ghost"
  size="sm"
  onPress={async () => {
    const fieldLabel = field.label || field.name;
    const ok = await confirm({
      title: "Supprimer ce champ ?",
      body: (
        <>
          Le champ <strong>{fieldLabel}</strong> et toutes ses valeurs sur les entités existantes
          seront perdus. Cette action est irréversible.
        </>
      ),
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (ok) {
      onDelete();
    }
  }}
  className="rounded p-1 hover:bg-[var(--surface-3)]"
  style={{ color: "var(--text-muted)" }}
  aria-label="Supprimer"
>
  <Trash size={12} />
</Button>
```

- [ ] **Step 5 : Typecheck**

Run: `pnpm --filter @supernote/web typecheck`
Expected: PASS.

- [ ] **Step 6 : Tests (si existants)**

Run: `pnpm --filter @supernote/web test`
Expected: PASS (aucun test de cette UI n'existe à priori, mais on vérifie qu'aucune régression).

- [ ] **Step 7 : Vérification visuelle (manuelle)**

Run: `pnpm --filter @supernote/web dev`
Naviguer vers une base, ouvrir l'éditeur de colonnes, cliquer la corbeille sur un champ.
Expected :
- Modal apparaît, titre "Supprimer ce champ ?", body avec nom de champ en gras, bouton "Supprimer" rouge.
- Annuler / Escape / clic backdrop → modal se ferme, champ intact.
- Confirmer → modal se ferme, champ disparaît de la liste.

- [ ] **Step 8 : Commit**

```bash
git add apps/web/src/components/bases/ColumnEditorSidebar.tsx
git commit -m "fix(bases): suppression champ via useConfirm modal"
```

---

## Task 2 : Confirmation modale pour suppression de vue (Finding #7)

**Files:**
- Modify: `apps/web/src/components/bases/ViewSettingsMenu.tsx`

### État actuel à connaître

Le composant possède :

```ts
const [confirmDelete, setConfirmDelete] = useState(false);
```

Rendu autour de la ligne 198 :

```tsx
{confirmDelete ? (
  <div className="flex items-center gap-1 p-2 text-xs">
    <span style={{ color: "var(--text-secondary)" }}>Confirmer ?</span>
    <Button variant="danger" size="sm" onPress={remove} ...>Supprimer</Button>
    <Button variant="ghost" size="sm" onPress={() => setConfirmDelete(false)} ...>Annuler</Button>
  </div>
) : (
  /* Bouton qui set confirmDelete à true */
)}
```

### Cible

Un seul bouton "Supprimer la vue" → ouvre `useConfirm` modal → si confirmé, `remove()`.

- [ ] **Step 1 : Ajouter l'import useConfirm**

```ts
import { useConfirm } from "@/lib/confirm";
```

- [ ] **Step 2 : Câbler useConfirm**

Ajouter dans le corps du composant, après les autres hooks :

```ts
const confirm = useConfirm();
```

- [ ] **Step 3 : Récupérer le nom de la vue**

Le composant reçoit `view` en props. Le label affiché est `view.name`. Utilise-le dans le body du confirm.

- [ ] **Step 4 : Remplacer le rendu conditionnel**

Supprimer `const [confirmDelete, setConfirmDelete] = useState(false);` et tout usage.

Localiser le bloc rendu autour de la ligne 198 (`{confirmDelete ? ... : ...}`) et le remplacer par le bouton non confirmé seul, modifié pour appeler `confirm` puis `remove` :

```tsx
<Button
  variant="ghost"
  size="sm"
  onPress={async () => {
    const ok = await confirm({
      title: "Supprimer cette vue ?",
      body: (
        <>
          La vue <strong>{view.name}</strong> sera supprimée. Ses filtres, tris et configuration
          sont perdus. Les données des entités restent intactes. Cette action est irréversible.
        </>
      ),
      confirmLabel: "Supprimer la vue",
      variant: "danger",
    });
    if (ok) {
      remove();
    }
  }}
  className="rounded px-2 py-1.5 text-xs"
  style={{ color: "var(--color-danger-700)" }}
>
  Supprimer la vue
</Button>
```

**Note :** réutilise la classe et le style du bouton "non confirmé" existant. Si le bouton "non confirmé" actuel a une icône `<Trash />` ou similaire, garde-la. L'objectif est de remplacer la dualité par un seul bouton qui ouvre le modal.

- [ ] **Step 5 : Typecheck**

Run: `pnpm --filter @supernote/web typecheck`
Expected: PASS.

- [ ] **Step 6 : Tests**

Run: `pnpm --filter @supernote/web test`
Expected: PASS.

- [ ] **Step 7 : Vérification visuelle (manuelle)**

Run: `pnpm --filter @supernote/web dev`
Naviguer vers une base, ouvrir les paramètres d'une vue non-système, cliquer "Supprimer la vue".
Expected :
- Modal avec titre "Supprimer cette vue ?", body mentionnant le nom de la vue + ce qui est perdu + irréversible.
- Annuler / Escape / backdrop → vue intacte.
- Confirmer → vue supprimée, le parent bascule vers une autre vue (logique existante de `onDeleted()` callback inchangée).

- [ ] **Step 8 : Commit**

```bash
git add apps/web/src/components/bases/ViewSettingsMenu.tsx
git commit -m "fix(bases): suppression vue via useConfirm modal"
```

---

## Task 3 : Validation finale

- [ ] **Step 1 : Suite complète**

Run: `pnpm --filter @supernote/web test`
Expected: PASS, 36 tests existants toujours verts.

- [ ] **Step 2 : Typecheck final**

Run: `pnpm --filter @supernote/web typecheck`
Expected: PASS.

- [ ] **Step 3 : Confirmer Finding #9 hors scope**

Sanity check : `apps/web/src/components/bases/ColumnHeaderMenu.tsx` ligne 161 doit toujours contenir `onBlur={commitRename}` et la branche `e.key === "Escape"` du `handleRenameKeyDown` doit appeler `onClose()` sans commit (lignes 144-146). Aucun changement à faire.

Aucun commit nécessaire.

---

## Récapitulatif des commits attendus

```
fix(bases): suppression champ via useConfirm modal
fix(bases): suppression vue via useConfirm modal
```

2 commits.

## Validation finale

- `pnpm --filter @supernote/web typecheck` PASS.
- `pnpm --filter @supernote/web test` PASS (36 tests Foundation toujours verts).
- Modal useConfirm fonctionne réellement sur 2 sites de production (smoke test différé de Foundation Task 8 désormais couvert).
- Aucun nouveau `<button>` HTML nu.
- Aucun `any`.

## Risques

- **Title flicker du Modal** flagué par le review de Foundation : se confirmera ou non sur ces deux sites. Si visible, fix dans `ConfirmProvider.tsx` (mémoriser `lastOpts` via `useRef`).
- **ViewSettingsMenu rendu en flex inline** : le bloc `confirmDelete ? ... : ...` actuel doit être analysé attentivement pour préserver la structure visuelle quand on retire la dualité. Si la maquette du bouton seul ne correspond pas au reste du menu, ajuster classes/spacing.
- **Aucun test automatisé** sur ces composants — la vérification visuelle est obligatoire.

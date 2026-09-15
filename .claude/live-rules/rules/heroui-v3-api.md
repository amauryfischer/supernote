---
description: "API réelle de HeroUI v3 (surface réduite) et cas natifs justifiés"
globs: ["apps/web/**/*.tsx", "packages/ui/**/*.tsx", "packages/editor/**/*.tsx"]
priority: 20
---
Le build `@heroui/react` v3 de ce dépôt a une surface **réduite** vs NextUI/HeroUI v2. Se tromper casse le rendu sans erreur TypeScript.

**`Button`**
- Pas de `startContent`/`endContent`. Icône en **enfant**, avec `className="flex items-center gap-1.5"`.
- `variant` ∈ `primary | secondary | tertiary | ghost | outline | danger | danger-soft`. Ni `light`, ni `flat`, ni `solid`.
- ⚠️ Défaut = **solide primaire (violet)**. Un Button sans `variant` avec seulement `style={{color:…}}` rend un **bloc violet sans label** (texte accent sur fond accent). Pour du non-solide : `variant="ghost"` / `"outline"`, ou override `backgroundColor`.
- Action primaire, convention du dépôt : `<Button size="sm" className="flex items-center gap-1.5" style={{backgroundColor:"var(--accent)", color:"var(--accent-foreground)"}}><Icon/> Label</Button>`.

**`Input`** = champ stylé **brut**.
- Pas de `label`, `labelPlacement`, `startContent`. `size` est l'attribut HTML **numérique**, pas `"sm"`.
- Styliser via `className` + tokens. Label = `<label>` frère. Icône de début = wrapper `relative` + icône `absolute` + `pl-8`.

**Natif justifié** (garder `<button>`/`<input>`, commenter la raison) quand :
1. un `useRef` + `focus()` programmatique vise un sibling — react-aria perpétue le focus visible (bug vécu : autofocus en boucle sur la date de note dans `NoteEditor.tsx`) ;
2. le handler a besoin de `MouseEvent.clientX/Y` — HeroUI passe un `PressEvent` sans coordonnées ;
3. le composant spread des listeners dnd-kit (`{...listeners}`) ;
4. `<input type="color">` ou `<input type="file">` invisible piloté par `ref.click()` ;
5. Cell editor inline et `FormulaInputEditor` (déjà actés dans CLAUDE.md).

Boutons icône : préférer icône phosphor + `Tooltip` du wrapper `@supernote/ui` (pas HeroUI brut) au label texte, et toujours un `aria-label`.

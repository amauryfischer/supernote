# Correctifs UX HIGH — spec design

**Date:** 2026-05-15
**Status:** Draft
**Origine:** Audit UX session 2026-05-15 suite à remontées users non spécifiées

## Contexte

Les utilisateurs ont signalé des problèmes UX sans préciser lesquels. Un audit complet de l'application a été réalisé (4 agents parallèles, ~100 findings). Ce spec regroupe les **11 findings HIGH** — ceux qui causent une perte de données, cassent une feature, ou bloquent l'usage mobile.

Les MED et LOW (≈ 90 findings) seront traités dans des specs ultérieurs et sortent du scope.

## Hypothèses sur les plaintes users

L'audit suggère que les frictions perçues correspondent probablement à :

- « J'ai perdu mes notes journal » → JournalEditor ne persiste rien (placeholder `console.log`).
- « Le calendrier ne montre rien » → MOCK hardcodé sur `journal/page.tsx`.
- « Je sais pas si ça a sauvegardé » → `catch {}` muets sur mutations, toasts absents.
- « J'ai supprimé sans le vouloir » → confirmations destructives manquantes.
- « Ça déborde sur mon téléphone » → grids `grid-cols-[...]` fixes sans breakpoint.
- « La command palette ne marche pas sur mobile » → tap n'invoque pas `onSelect`.

## Findings HIGH (catalogue)

### #1 — JournalEditor : sauvegarde morte (perte de données)

- **Localisation :** `apps/web/src/components/journal/JournalEditor.tsx` ligne ~29
- **Symptôme :** Le handler de save est un `console.log` placeholder. `saveStatus` flashe sans effet réel. Toute écriture journal est perdue au reload.
- **Cause racine :** Mutation tRPC `journal.upsert` (ou équivalent) jamais branchée.
- **Fix :** Implémenter mutation worker `journal.save(date, content)` + appel dans `JournalEditor`. Toast d'erreur sur échec. Indicateur "Enregistré" basé sur résultat réel.
- **Acceptation :** Écrire dans le journal, recharger la page, contenu présent. Couper le worker en plein save → toast erreur visible.

### #2 — JournalCalendar : dates hardcodées

- **Localisation :** `apps/web/src/app/journal/page.tsx:43-45` (`MOCK_DATES_WITH_NOTE`)
- **Symptôme :** Calendar n'indique que la date du jour comme "avec note". Les autres entrées sont invisibles.
- **Cause racine :** Constante mock jamais remplacée par une vraie query.
- **Fix :** Query tRPC `journal.listDatesWithEntry(monthStart, monthEnd)` → renvoie `string[]` (YYYY-MM-DD). `JournalCalendar` consomme cette liste. Loading state pendant fetch.
- **Acceptation :** Créer une entrée le 2026-05-10, revenir au calendrier, voir le point/marker sur ce jour.

### #3 — Contacts : validation email/tel absente

- **Localisation :** `apps/web/src/app/contacts/nouveau/page.tsx:45` (email) et `:59` (téléphone)
- **Symptôme :** Champs acceptent n'importe quoi (`x@y`, `abc123`). Données poubelle persistées.
- **Cause racine :** Inputs HeroUI sans `type="email"`, sans `pattern`, sans validation client.
- **Fix :**
  - `Input type="email"` + helper `validateEmail()` partagé (`packages/core` ou `apps/web/src/lib/validation/`).
  - `Input type="tel" inputMode="tel"` + helper `validateE164OrLocal()` (regex simple `^[+]?[0-9\s.\-()]{6,20}$`).
  - `isInvalid` + `errorMessage` HeroUI v3 wired sur submit.
  - Même validation appliquée à `contacts/[id]/page.tsx` (édition).
- **Acceptation :** Soumettre `"x@y"` → erreur inline rouge "Email invalide". Tel `"abc"` → erreur "Numéro invalide". Submit bloqué tant que erreurs présentes.

### #4 — Todos : quick-add accepte texte vide

- **Localisation :** `apps/web/src/app/todos/page.tsx:171`
- **Symptôme :** Prompt rapide accepte `"   "` (espaces) ou chaîne vide → todo blank crée.
- **Cause racine :** Pas de `.trim().length > 0` check avant `mutate`.
- **Fix :** Validation `text.trim()` non vide avant mutation. Si vide, ne pas envoyer (silencieux) ou shake animation sur input. Préférence : silencieux + retour focus.
- **Acceptation :** Ouvrir quick-add, appuyer Entrée sans texte → rien ne se passe, focus reste. Avec espaces seuls → idem.

### #5 — Finance : grids fixes débordent mobile

- **Localisation :** `apps/web/src/app/finance/comptes/page.tsx:116`, `actifs/page.tsx:142`
- **Symptôme :** `grid-cols-[1fr_140px_140px_140px]` sans breakpoint → débordement horizontal <640px, scroll page forcé.
- **Cause racine :** Layout desktop appliqué uniformément.
- **Fix :**
  - Mobile : `grid-cols-1` ou `flex-col` (card layout par compte/actif).
  - Desktop (`md:`) : grid actuel.
  - Pattern réutilisable : helper `cn()` ou snippet documenté dans `apps/web/src/components/finance/utils.ts`.
- **Acceptation :** Ouvrir `/finance/comptes` à 360px de large → pas de scroll horizontal, chaque compte sur sa carte. À 1024px → tableau classique.

### #6 — Bases : delete field instantané sans confirm

- **Localisation :** `apps/web/src/components/bases/SortableFieldRow.tsx:66-75`
- **Symptôme :** Click corbeille → suppression immédiate du champ + toutes ses valeurs entités. Aucun retour arrière.
- **Cause racine :** `onDelete` câblé direct sur le bouton.
- **Fix :** Hook partagé `useConfirm({ title, body, confirmLabel, variant })` rendant Modal HeroUI v3. Avant `onDelete`, await `confirm({ title: "Supprimer ce champ ?", body: "Les valeurs de toutes les entités seront perdues. Cette action est irréversible.", variant: "danger" })`.
- **Acceptation :** Click corbeille → modal. Confirmer → suppression. Annuler → rien.

### #7 — Bases : delete view sans warning irréversibilité

- **Localisation :** `apps/web/src/components/bases/ViewSettingsMenu.tsx:52`
- **Symptôme :** État `confirmDelete` existe mais pas de message clair sur la perte (filtres, tris, groupages spécifiques à la vue).
- **Cause racine :** Texte de confirmation générique.
- **Fix :** Réutiliser `useConfirm` (cf #6). Body : « La vue sera supprimée. Ses filtres, tris et configuration sont perdus. Les données des entités restent intactes. ».
- **Acceptation :** Delete vue → modal explicite avec mention "Cette action est irréversible".

### #8 — Bases : empty states cachés (DataGrid, Kanban)

- **Localisation :** `apps/web/src/components/bases/DataGrid.tsx:791-800`, `KanbanView.tsx:39-41`
- **Symptôme :**
  - DataGrid : "Aucune entrée" rendu sous la zone scrollable → user ne le voit pas avant de scroller.
  - Kanban : colonnes vides invisibles → user ne sait pas que la colonne existe.
- **Cause racine :** Rendu conditionnel dans le flow normal au lieu d'un overlay/stub dédié.
- **Fix :**
  - DataGrid : si `rows.length === 0` → overlay centré au-dessus de la grille (CTA "Créer la première entrée").
  - Kanban : chaque colonne rend une zone de drop visible même vide avec libellé "Glissez une entrée ici".
- **Acceptation :** Base vide → message centré visible immédiatement. Kanban avec colonne `Status=Done` vide → drop zone explicite visible.

### #9 — Bases : rename column perd focus sans commit

- **Localisation :** `apps/web/src/components/bases/ColumnHeaderMenu.tsx`
- **Symptôme :** Inline rename en cours, click extérieur → input perd focus, nouveau nom perdu silencieusement.
- **Cause racine :** Pas de `onBlur={commit}` ni d'indication "Entrée pour valider".
- **Fix :** `onBlur` commit la valeur (avec validation `name.trim().length > 0`). Si invalide, revert + toast erreur. `Escape` annule explicitement. Hint visuel "Entrée pour valider, Échap pour annuler".
- **Acceptation :** Rename "Nom" → "Titre" → click ailleurs → renommage appliqué. Escape pendant edit → revert.

### #10 — Paramètres : save vs auto-save ambigu

- **Localisation :** `apps/web/src/app/parametres/page.tsx:145-159`
- **Symptôme :** Bouton "Save" présent sur certains onglets, absent sur d'autres. User ignore si auto-save ou pas. Layout shift mobile à chaque tab switch.
- **Cause racine :** Comportement mixte (auto-save par tab, save manuel sur autres) non communiqué.
- **Fix :**
  - Décider par onglet : auto-save (préféré) ou manuel.
  - Status global `aria-live="polite"` dans le header : "Enregistré il y a 2s" / "Enregistrement…" / "Erreur d'enregistrement".
  - Si manuel : bouton toujours visible (disabled si non dirty).
  - Pas de layout shift entre tabs (slot fixe pour le status).
- **Acceptation :** Modifier un paramètre → indicateur clair "Enregistré". Couper worker → "Erreur" visible.

### #11 — Command palette : tap mobile ne sélectionne pas

- **Localisation :** `apps/web/src/components/command/CommandPalette.tsx:538-542`
- **Symptôme :** Sur mobile, tap sur un `EntityCommandItem` ne déclenche pas `onSelect`. La palette devient inutilisable au doigt.
- **Cause racine :** `cmdk` ne pose pas `data-selected` au tap ; le workaround `onClick + preventDefault` est partiel.
- **Fix :**
  - Tester sur device réel (Chrome devtools touch émulation).
  - Si confirmé : capter `onPointerUp` ou `onTouchEnd` qui appelle `onSelect` directement, sans dépendre de la sélection cmdk.
  - Garder `onClick` pour souris desktop.
- **Acceptation :** Ouvrir palette sur 360px viewport, taper sur un résultat → navigation effectuée.

## Patterns cross-cutting (mutualisables)

Pour éviter de dupliquer la logique, trois utilitaires partagés sont introduits **en parallèle** des fixes ci-dessus :

### A. `useConfirm()` — Modal HeroUI v3 standardisé

- **Emplacement :** `apps/web/src/lib/hooks/use-confirm.tsx`
- **Signature :**
  ```ts
  const confirm = useConfirm();
  const ok = await confirm({
    title: string;
    body: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: "default" | "danger";
  });
  ```
- **Implémentation :** Provider global dans `RootLayout` → portail unique HeroUI `Modal`. Hook retourne `Promise<boolean>`.
- **Consommateurs immédiats :** #6, #7. Étendu au-delà du HIGH dans specs suivants.

### B. `withMutationFeedback()` — toast unifié sur tRPC

- **Emplacement :** `apps/web/src/lib/trpc/with-feedback.ts`
- **Signature :**
  ```ts
  const mutation = trpc.x.y.useMutation(withMutationFeedback({
    success: "Enregistré",
    error: (e) => `Échec : ${e.message}`,
  }));
  ```
- **Implémentation :** Wrapper qui ajoute `onSuccess`/`onError` callbacks appelant `toast()` (HeroUI ou provider local). Préserve callbacks personnalisés.
- **Consommateurs immédiats :** #1 (journal save), #9 (rename commit). Sert de base pour traiter les `catch {}` muets dans la suite des findings.

### C. `validators/` — helpers form

- **Emplacement :** `apps/web/src/lib/validation/`
- **Contenu initial :** `validateEmail`, `validatePhone`, `validateNonEmpty` (avec messages FR).
- **Tests :** `vitest` co-located.
- **Consommateurs immédiats :** #3 (contacts), #4 (todos). Réutilisable finance/IBAN dans specs suivants.

## Ordre d'exécution

Pour minimiser conflits de fichiers et livrer la valeur perçue rapidement :

1. **Foundation** (A, B, C ci-dessus) — 1 PR
2. **P0 bugs perte de données** : #1, #2 — 1 PR (consomme B)
3. **P1 validation forms** : #3, #4 — 1 PR (consomme C)
4. **P2 mobile/empty** : #5, #8 — 1 PR (indépendant)
5. **P3 destructifs** : #6, #7, #9 — 1 PR (consomme A et B)
6. **P4 nav/palette** : #10, #11 — 1 PR (indépendant)

Chaque PR a son commit message conventionnel français (`fix(journal): …`, `fix(ux): …`).

## Out of scope

- Les ≈90 findings MED/LOW (résidus HeroUI v3, tooltips manquants, skeletons hardcodés, etc.) → specs ultérieurs par thème.
- Refonte design system, theming, dark mode.
- Refactor architecture stores, hooks.
- Onboarding tour amélioré (cf. finding LOW dans audit).
- Tests E2E exhaustifs (sauf cas critique #1 journal save).

## Critères de réussite globaux

- `pnpm typecheck` passe.
- `pnpm --filter @supernote/* test` passe.
- Chaque acceptation des findings #1–#11 vérifiée manuellement (dev server + DevTools touch émulation pour #11).
- Aucun nouveau `catch {}` muet introduit dans les fichiers touchés.
- Aucun nouveau `<button>` HTML nu introduit (HeroUI v3 obligatoire — règle CLAUDE.md).

## Risques

- **#1 JournalEditor :** la mutation manquante peut nécessiter une migration schema worker. À vérifier au moment du plan d'implémentation.
- **#11 Command palette :** dépend de `cmdk` version installée ; un upgrade peut être nécessaire au lieu d'un workaround.
- **`useConfirm` provider :** placement dans `RootLayout` doit cohabiter avec autres providers (HeroUI `Provider`, tRPC, etc.). Ordre à valider.

## Références

- Audit complet (4 agents parallèles, ~100 findings) — session 2026-05-15.
- `CLAUDE.md` projet : règle HeroUI v3 obligatoire, TypeScript strict, conventional commits français.
- Memory `feedback_heroui_native_exceptions` : exceptions justifiées pour `<button>`/`<input>` natifs.

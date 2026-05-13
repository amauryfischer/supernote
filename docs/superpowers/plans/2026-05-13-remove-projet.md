# Remove Projet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Supprimer complètement la notion de "Projet" (entity type `"projet"`) du codebase — pages, navigation, recherche, seed, éditeur, IA, templates et fixtures.

**Architecture:** Suppression pure, sans migration DB (aucun vault existant n'est concerné). Chaque tâche couvre une zone fonctionnelle cohérente et se termine par un commit. Aucun nouveau fichier n'est créé.

**Tech Stack:** Next.js (App Router + react-router custom), tRPC, TypeScript, Prisma vault-worker (SQLite).

---

## Fichiers modifiés

| Fichier | Action |
|---|---|
| `apps/web/src/app/projets/page.tsx` | Supprimer |
| `apps/web/src/app/projets/[id]/page.tsx` | Supprimer |
| `apps/web/src/router.tsx` | Retirer 2 routes |
| `apps/web/src/components/shell/Sidebar.tsx` | Retirer entrée `nav.projects` + import `Stack` si devenu inutilisé |
| `apps/web/src/components/shell/mobile/MobileBottomNav.tsx` | Retirer `/projets` de la liste |
| `apps/web/src/components/shell/mobile/MoreDrawer.tsx` | Retirer l'entrée Projets |
| `apps/web/src/components/command/CommandPalette.tsx` | Retirer `projet`/`project` de `entityHref`, `ENTITY_TYPE_LABELS`, `priority`, `TYPE_ICON_MAP`; retirer import `Stack` si inutilisé |
| `apps/web/src/lib/commands/seed.ts` | Supprimer commande `nav.projects` |
| `apps/web/src/components/search/FilterChips.tsx` | Retirer `"projet"` et `"Projets"` des filtres |
| `apps/web/src/components/search/ResultCard.tsx` | Retirer `projet`/`project` de `entityHref` et `TYPE_ICON_MAP`; retirer import `Briefcase` si inutilisé |
| `apps/web/src/components/search/fixtures.ts` | Retirer `projet: "Projets"` |
| `apps/web/src/components/search/demo-fixtures.ts` | Supprimer l'entrée de type `"projet"` |
| `apps/web/src/lib/vault-worker/seed-default-types.ts` | Supprimer `projetFields`, type `"projet"`, 4 relations impliquant `"projet"` |
| `packages/editor/src/extensions/slashMenu.tsx` | Retirer entrée "Lier un projet" et `projet` de `MENTION_TYPE_ICONS` |
| `apps/web/src/components/notes/EntityLinkPicker.tsx` | Retirer `projet: "Lier un projet"` de `TYPE_FILTER_LABELS` |
| `packages/ai/src/auto-tag/heuristic.ts` | Retirer le pattern `"project"` |
| `packages/ai/src/classifier/heuristic-classify.ts` | Supprimer l'entrée `"Projet"` |
| `packages/templates/src/seeds/index.ts` | Supprimer `PROJECT_BRIEF` et son export depuis `SEED_TEMPLATES` |
| `apps/web/src/components/views/demo-fixtures.ts` | Supprimer la vue "Projets actifs" |
| `apps/web/src/components/views/fixtures.ts` | Retirer `project: "Projet"` |

---

## Task 1 : Supprimer les pages Next.js et les routes

**Fichiers :**
- Supprimer : `apps/web/src/app/projets/page.tsx`
- Supprimer : `apps/web/src/app/projets/[id]/page.tsx`
- Modifier : `apps/web/src/router.tsx`

- [ ] **Étape 1 : Supprimer les deux fichiers de page**

```bash
rm apps/web/src/app/projets/page.tsx
rm apps/web/src/app/projets/\[id\]/page.tsx
rmdir apps/web/src/app/projets/\[id\] apps/web/src/app/projets
```

- [ ] **Étape 2 : Retirer les routes dans `router.tsx`**

Localiser les lignes :
```typescript
{ path: "projets", lazy: lazyPage(() => import("./app/projets/page")) },
{ path: "projets/:id", lazy: lazyPage(() => import("./app/projets/[id]/page")) },
```
Supprimer ces deux lignes.

- [ ] **Étape 3 : Vérifier la compilation TypeScript**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -30
```
Résultat attendu : aucune erreur liée à `projets`.

- [ ] **Étape 4 : Commit**

```bash
git add apps/web/src/router.tsx
git commit -m "feat(remove-projet): supprimer pages /projets et routes associées"
```

---

## Task 2 : Retirer la navigation (Sidebar, mobile, CommandPalette, seed commandes)

**Fichiers :**
- Modifier : `apps/web/src/components/shell/Sidebar.tsx`
- Modifier : `apps/web/src/components/shell/mobile/MobileBottomNav.tsx`
- Modifier : `apps/web/src/components/shell/mobile/MoreDrawer.tsx`
- Modifier : `apps/web/src/components/command/CommandPalette.tsx`
- Modifier : `apps/web/src/lib/commands/seed.ts`

- [ ] **Étape 1 : Sidebar — retirer l'entrée Projets**

Dans `apps/web/src/components/shell/Sidebar.tsx`, supprimer la ligne :
```typescript
{ labelKey: "nav.projects", icon: Stack, href: "/projets" },
```
Puis vérifier si `Stack` est encore utilisé ailleurs dans ce fichier. S'il ne l'est plus, le retirer de l'import `@phosphor-icons/react`.

- [ ] **Étape 2 : MobileBottomNav — retirer `/projets` de la liste**

Dans `apps/web/src/components/shell/mobile/MobileBottomNav.tsx`, la ligne contient un tableau de paths qui masquent le bottom nav. Retirer `"/projets"` de ce tableau :
```typescript
// Avant :
["/contacts", "/projets", "/finance", "/tags", "/vues", "/canvas",
// Après :
["/contacts", "/finance", "/tags", "/vues", "/canvas",
```

- [ ] **Étape 3 : MoreDrawer — retirer l'entrée Projets**

Dans `apps/web/src/components/shell/mobile/MoreDrawer.tsx`, supprimer la ligne :
```typescript
{ label: "Projets", href: "/projets", icon: Stack, tint: "oklch(0.62 0.22 295)" },
```
Vérifier si `Stack` est encore utilisé dans ce fichier ; sinon le retirer de l'import.

- [ ] **Étape 4 : CommandPalette — nettoyer les références projet**

Dans `apps/web/src/components/command/CommandPalette.tsx` :

**4a.** Dans `entityHref`, supprimer la branche :
```typescript
if (t === "projet" || t === "project") return `/projets/${entityId}`;
```

**4b.** Dans `ENTITY_TYPE_LABELS`, supprimer :
```typescript
projet: "Projets",
project: "Projets",
```

**4c.** Dans le tableau `priority` (ligne ~228), retirer `"projet"` :
```typescript
// Avant :
const priority = ["note", "personne", "organisation", "projet"];
// Après :
const priority = ["note", "personne", "organisation"];
```

**4d.** Dans `TYPE_ICON_MAP`, supprimer :
```typescript
projet: Stack,
project: Stack,
```

**4e.** Si `Stack` n'est plus utilisé dans ce fichier après ces suppressions, le retirer de l'import `@phosphor-icons/react`.

- [ ] **Étape 5 : commands/seed.ts — retirer la commande nav.projects**

Dans `apps/web/src/lib/commands/seed.ts`, supprimer l'objet de commande dont l'id est `"nav.projects"` (les quelques lignes autour de la ligne 61) :
```typescript
// Supprimer ce bloc :
{
  id: "nav.projects",
  label: "Aller aux Projets",
  // ...
  keywords: ["projets", "projects"],
  // ...
},
```

- [ ] **Étape 6 : Vérifier la compilation**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Étape 7 : Commit**

```bash
git add apps/web/src/components/shell/Sidebar.tsx \
        apps/web/src/components/shell/mobile/MobileBottomNav.tsx \
        apps/web/src/components/shell/mobile/MoreDrawer.tsx \
        apps/web/src/components/command/CommandPalette.tsx \
        apps/web/src/lib/commands/seed.ts
git commit -m "feat(remove-projet): retirer la navigation et les commandes Projets"
```

---

## Task 3 : Nettoyer la recherche

**Fichiers :**
- Modifier : `apps/web/src/components/search/FilterChips.tsx`
- Modifier : `apps/web/src/components/search/ResultCard.tsx`
- Modifier : `apps/web/src/components/search/fixtures.ts`
- Modifier : `apps/web/src/components/search/demo-fixtures.ts`

- [ ] **Étape 1 : FilterChips — retirer projet des filtres**

Dans `apps/web/src/components/search/FilterChips.tsx` :

**1a.** Dans le filtre `type`, retirer `"projet"` de la liste `values` :
```typescript
// Avant :
{ key: "type", label: "Type", values: ["note", "personne", "projet", "ressource", "journal"] },
// Après :
{ key: "type", label: "Type", values: ["note", "personne", "ressource", "journal"] },
```

**1b.** Dans le filtre `in`, retirer `"Projets"` de la liste `values` :
```typescript
// Avant :
{ key: "in", label: "Dossier", values: ["Inbox", "Notes", "Daily", "Projets", "Contacts"] },
// Après :
{ key: "in", label: "Dossier", values: ["Inbox", "Notes", "Daily", "Contacts"] },
```

- [ ] **Étape 2 : ResultCard — retirer la branche projet**

Dans `apps/web/src/components/search/ResultCard.tsx` :

**2a.** Dans `entityHref`, supprimer :
```typescript
if (t === "projet" || t === "project") return `/projets/${entityId}`;
```

**2b.** Dans `TYPE_ICON_MAP`, supprimer :
```typescript
projet: Briefcase,
```

**2c.** Si `Briefcase` n'est plus utilisé, le retirer de l'import `@phosphor-icons/react`.

- [ ] **Étape 3 : fixtures.ts — retirer l'entrée projet**

Dans `apps/web/src/components/search/fixtures.ts`, supprimer :
```typescript
projet: "Projets",
```

- [ ] **Étape 4 : demo-fixtures.ts — supprimer l'entrée projet**

Dans `apps/web/src/components/search/demo-fixtures.ts`, supprimer l'objet entier :
```typescript
{
  entityId: "entity-3",
  typeId: "projet",
  typeName: "Projet",
  filePath: "Projets/supernote-pkm.md",
  title: "Supernote PKM",
  excerpts: ["Application de gestion de connaissances. MVP en cours."],
  score: 0.82,
  semantic: false,
  tags: ["dev", "produit"],
},
```

- [ ] **Étape 5 : Vérifier la compilation**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Étape 6 : Commit**

```bash
git add apps/web/src/components/search/FilterChips.tsx \
        apps/web/src/components/search/ResultCard.tsx \
        apps/web/src/components/search/fixtures.ts \
        apps/web/src/components/search/demo-fixtures.ts
git commit -m "feat(remove-projet): retirer projet des composants de recherche"
```

---

## Task 4 : Supprimer le type seed et les relations

**Fichier :**
- Modifier : `apps/web/src/lib/vault-worker/seed-default-types.ts`

- [ ] **Étape 1 : Supprimer `projetFields`**

Localiser et supprimer le tableau complet :
```typescript
const projetFields: SeedField[] = [
  { id: "proj_name", name: "name", label: "Nom", kind: "text", required: true },
  { id: "proj_status", name: "status", label: "Statut", kind: "status", options: [...] },
  { id: "proj_start", name: "start_date", label: "Début", kind: "date" },
  { id: "proj_end", name: "end_date", label: "Fin prévue", kind: "date" },
  { id: "proj_priority", name: "priority", label: "Priorité", kind: "rating", min: 1, max: 5 },
  { id: "proj_budget", name: "budget", label: "Budget", kind: "currency", currencyCode: "EUR" },
  { id: "proj_progress", name: "progress", label: "Avancement", kind: "progress" },
  { id: "proj_description", name: "description", label: "Description", kind: "markdown" },
  { id: "proj_created_at", name: "createdAt", label: "Créé le", kind: "createdAt" },
  { id: "proj_updated_at", name: "updatedAt", label: "Modifié le", kind: "updatedAt" },
];
```

- [ ] **Étape 2 : Retirer le type `"projet"` de `DEFAULT_ENTITY_TYPES`**

Dans le tableau `DEFAULT_ENTITY_TYPES`, supprimer la ligne :
```typescript
{ id: "projet", name: "Projet", plural: "Projets", icon: "Layers", color: "#8B5CF6", fields: projetFields, defaultPath: "Projets", fileNamePattern: "{name}", defaultView: "kanban" },
```

- [ ] **Étape 3 : Retirer les 4 relations impliquant `"projet"` de `DEFAULT_RELATION_TYPES`**

Supprimer ces 4 objets :
```typescript
{ id: "rel_personne_projet", forwardLabel: "contribue à", inverseLabel: "a pour contributeur", sourceTypeId: "personne", targetTypeId: "projet", cardinality: "many_to_many" },
{ id: "rel_interaction_projet", forwardLabel: "concerne", inverseLabel: "a pour interaction", sourceTypeId: "interaction", targetTypeId: "projet", cardinality: "many_to_many" },
{ id: "rel_note_projet", forwardLabel: "associée à", inverseLabel: "a pour note", sourceTypeId: "note", targetTypeId: "projet", cardinality: "many_to_many" },
{ id: "rel_org_projet", forwardLabel: "sponsor de", inverseLabel: "sponsorisé par", sourceTypeId: "organisation", targetTypeId: "projet", cardinality: "many_to_many" },
```

- [ ] **Étape 4 : Vérifier la compilation**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Étape 5 : Commit**

```bash
git add apps/web/src/lib/vault-worker/seed-default-types.ts
git commit -m "feat(remove-projet): supprimer le type seed projet et ses relations"
```

---

## Task 5 : Retirer les entrées éditeur

**Fichiers :**
- Modifier : `packages/editor/src/extensions/slashMenu.tsx`
- Modifier : `apps/web/src/components/notes/EntityLinkPicker.tsx`

- [ ] **Étape 1 : slashMenu — supprimer l'entrée "Lier un projet"**

Dans `packages/editor/src/extensions/slashMenu.tsx`, supprimer l'objet :
```typescript
{
  title: "Lier un projet",
  subtext: "Wikilink vers un projet",
  typeId: "projet",
  typeLabel: "projet",
  icon: "P",
  keywords: "projet",
  insert: WIKILINK_INSERT,
},
```

- [ ] **Étape 2 : slashMenu — retirer `projet` de `MENTION_TYPE_ICONS`**

Dans `MENTION_TYPE_ICONS`, supprimer :
```typescript
projet: "📋",
```

- [ ] **Étape 3 : EntityLinkPicker — retirer `projet` de `TYPE_FILTER_LABELS`**

Dans `apps/web/src/components/notes/EntityLinkPicker.tsx`, supprimer depuis `TYPE_FILTER_LABELS` :
```typescript
projet: "Lier un projet",
```

- [ ] **Étape 4 : Vérifier la compilation**

```bash
cd packages/editor && npx tsc --noEmit 2>&1 | head -30
cd apps/web && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Étape 5 : Commit**

```bash
git add packages/editor/src/extensions/slashMenu.tsx \
        apps/web/src/components/notes/EntityLinkPicker.tsx
git commit -m "feat(remove-projet): retirer projet du menu slash et de l'entity picker"
```

---

## Task 6 : Nettoyer les heuristiques IA

**Fichiers :**
- Modifier : `packages/ai/src/auto-tag/heuristic.ts`
- Modifier : `packages/ai/src/classifier/heuristic-classify.ts`

- [ ] **Étape 1 : auto-tag — supprimer le pattern project**

Dans `packages/ai/src/auto-tag/heuristic.ts`, supprimer la ligne :
```typescript
{ pattern: /\b(projet|project|milestone|sprint|roadmap)\b/i, concept: "project" },
```

- [ ] **Étape 2 : classifier — supprimer l'entrée Projet**

Dans `packages/ai/src/classifier/heuristic-classify.ts`, supprimer l'objet complet :
```typescript
{
  typeName: "Projet",
  patterns: [
    /\b(projet|project|objectifs?|goals?|milestones?|roadmap|livrable|deliverable)\b/i,
    /\b(budget|timeline|équipe|team|stakeholders?)\b/i,
  ],
},
```

- [ ] **Étape 3 : Vérifier la compilation et les tests**

```bash
cd packages/ai && npx tsc --noEmit 2>&1 | head -20
cd packages/ai && npx vitest run 2>&1 | tail -20
```
Résultat attendu : aucune erreur de compilation, tests qui passaient avant passent toujours (les tests de classifier référençant "Projet" peuvent échouer — les corriger à l'étape suivante).

- [ ] **Étape 4 : Corriger les tests IA si nécessaire**

Si des tests dans `packages/ai/src/classifier/classifier.test.ts` ou `packages/ai/src/auto-tag/tagger.test.ts` utilisent le type `"Projet"` ou `"project"` comme valeur attendue, les supprimer ou adapter pour ne plus les attendre.

Exemple — si un test contient :
```typescript
expect(result.typeName).toBe("Projet");
```
Supprimer ce cas de test ou le remplacer par une assertion sur un autre type.

- [ ] **Étape 5 : Relancer les tests**

```bash
cd packages/ai && npx vitest run 2>&1 | tail -20
```
Résultat attendu : tous les tests passent.

- [ ] **Étape 6 : Commit**

```bash
git add packages/ai/src/auto-tag/heuristic.ts \
        packages/ai/src/classifier/heuristic-classify.ts \
        packages/ai/src/classifier/classifier.test.ts \
        packages/ai/src/auto-tag/tagger.test.ts
git commit -m "feat(remove-projet): supprimer les heuristiques IA liées au type projet"
```

---

## Task 7 : Retirer le template Brief de projet

**Fichier :**
- Modifier : `packages/templates/src/seeds/index.ts`

- [ ] **Étape 1 : Supprimer `PROJECT_BRIEF` et son entrée dans `SEED_TEMPLATES`**

Dans `packages/templates/src/seeds/index.ts` :

**1a.** Supprimer la constante entière :
```typescript
export const PROJECT_BRIEF: Template = {
  id: "seed-project-brief",
  name: "Brief de projet",
  description: "Project brief with objectives, context, deliverables and stakeholders",
  icon: "briefcase",
  body: "# {{prompt:Nom du projet?}}\n\n## Objectifs\n{{cursor}}\n\n## Contexte\n\n## Livrables\n\n## Stakeholders\n{{contact:personne}}",
};
```

**1b.** Dans `SEED_TEMPLATES`, supprimer `PROJECT_BRIEF` :
```typescript
// Avant :
export const SEED_TEMPLATES: readonly Template[] = [
  DAILY_JOURNAL,
  MEETING_NOTES,
  RECIPE,
  PROJECT_BRIEF,
] as const;

// Après :
export const SEED_TEMPLATES: readonly Template[] = [
  DAILY_JOURNAL,
  MEETING_NOTES,
  RECIPE,
] as const;
```

- [ ] **Étape 2 : Vérifier la compilation et les tests**

```bash
cd packages/templates && npx tsc --noEmit 2>&1 | head -20
cd packages/templates && npx vitest run 2>&1 | tail -20
```

Si des tests référencent `PROJECT_BRIEF` ou `"seed-project-brief"`, les adapter de la même façon.

- [ ] **Étape 3 : Commit**

```bash
git add packages/templates/src/seeds/index.ts
git commit -m "feat(remove-projet): supprimer le template Brief de projet"
```

---

## Task 8 : Nettoyer les fixtures de démo

**Fichiers :**
- Modifier : `apps/web/src/components/views/demo-fixtures.ts`
- Modifier : `apps/web/src/components/views/fixtures.ts`

- [ ] **Étape 1 : views/demo-fixtures.ts — supprimer la vue "Projets actifs"**

Supprimer l'objet complet :
```typescript
{
  id: "view-002",
  name: "Projets actifs",
  kind: "kanban",
  entityTypeId: "project",
  resultCount: 0,
  filters: [{ fieldId: "status", operator: "neq", value: "archived" }],
  groupBy: "status",
  createdAt: "2026-01-15T10:00:00Z",
  updatedAt: "2026-04-25T11:00:00Z",
},
```

- [ ] **Étape 2 : views/fixtures.ts — retirer l'entrée project**

Localiser et supprimer :
```typescript
project: "Projet",
```

- [ ] **Étape 3 : Vérifier la compilation**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Étape 4 : Commit**

```bash
git add apps/web/src/components/views/demo-fixtures.ts \
        apps/web/src/components/views/fixtures.ts
git commit -m "feat(remove-projet): nettoyer les fixtures de démo"
```

---

## Task 9 : Vérification finale

- [ ] **Étape 1 : Recherche résiduelle**

```bash
grep -r "projet\|Projets\|/projets" \
  apps/web/src apps/web/src packages/ai/src packages/editor/src packages/templates/src \
  --include="*.ts" --include="*.tsx" \
  --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist \
  -l
```
Parcourir les fichiers retournés. Les occurrences légitimes restantes sont :
- Des mentions dans des commentaires de code non liées à la fonctionnalité (ex. exemples dans du code de path parsing — voir `hooks.ts`)
- Des fixtures de tests unitaires non liées au type entité projet

Corriger tout résidu fonctionnel.

- [ ] **Étape 2 : Compilation complète du monorepo**

```bash
cd /home/ange/supernote && npx tsc --build 2>&1 | head -50
```
Résultat attendu : 0 erreur.

- [ ] **Étape 3 : Suite de tests complète**

```bash
cd /home/ange/supernote && npx vitest run 2>&1 | tail -30
```
Résultat attendu : tous les tests passent.

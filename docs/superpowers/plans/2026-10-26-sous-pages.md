# Sous-pages (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** `/page` crée une sous-page dont la carte vit dans la note parente. On entre dans la sous-page en cliquant, sur autant de niveaux que voulu, avec un fil d'Ariane, l'imbrication dans l'arbre et la mention « dans X » dans la liste. Desktop et mobile.

**Architecture :**
- La hiérarchie vit dans `fields.parentId` de la sous-page, rangée dans le même dossier que sa parente.
- La carte est un bloc éditeur `subpage { noteId }`, sérialisé `[subpage id="…"]`. Son rendu est délégué à l'hôte, comme `embed` et `databaseView`.
- Une seule route worker est ajoutée, `entities.subpageDescendants`. Elle donne au déplacement une descendance exhaustive.

**Tech Stack :** BlockNote 0.50 (Tiptap/ProseMirror), React, tRPC sur Web Worker (sqlite-wasm), HeroUI v3 via `@supernote/ui`, Playwright.

**Spec :** `docs/superpowers/specs/2026-10-26-sous-pages-design.md`. La phase 2 (partager un wiki par lien) aura son propre plan une fois la phase 1 livrée. Elle touche l'authentification du partage et doit partir du code réel de la phase 1.

## Global Constraints

- HeroUI v3 via `@supernote/ui`. Les boutons icône ont un Tooltip et un `aria-label`. Pas de toast de succès : un toast ne sert qu'à une erreur orpheline.
- `@supernote/editor` et `@supernote/ipc` sont consommés par leur `dist/` : lancer `pnpm build:packages` après chaque modification de leur source.
- Zéro test unitaire, ni `*.test.ts` ni vitest. On vérifie avec `pnpm typecheck`, `pnpm lint` et Playwright. Un seul run e2e à la fois, en arrière-plan.
- Le mobile (< 768 px) est traité dans la même tâche que le desktop : pas de débordement horizontal, cibles tactiles d'au moins 32 px.
- Commentaires en français, seulement pour le pourquoi. TypeScript strict, sans `any`.
- ProseMirror : jamais de `setAttribute` dans le sous-arbre de l'éditeur. Le rendu de la carte passe par React.
- Texte affiché : `Page` (repli sans hôte et titre de l'entrée du menu slash), `Sans titre`, `Page introuvable`, `dans <titre parent>`.
- Commits sur la branche du ticket uniquement. L'intégration sur main, le push et le déploiement attendent la demande explicite d'Amaury.
- **Arbre partagé :** la session `supernote-26` refond `NoteEditor.tsx`, `FileTree.tsx` et `app/notes/[id]/page.tsx`. Les tâches 1 à 3 n'y touchent pas. Les tâches 4 et 5 commencent seulement après accord de cette session (message via SendMessage), et rebasent sur sa livraison.

## Review Focus

1. **Cycle de `parentId`** (A → B → A, écrit par la synchro ou à la main) : l'arbre affiche A et B au premier niveau, sans boucle ni gel, et le fil d'Ariane s'arrête. Test dans la tâche 3 (liste) et la tâche 5 (arbre).
2. **Parente archivée** : la sous-page apparaît au premier niveau de son dossier, et le fil d'Ariane n'affiche pas la parente archivée. Test dans la tâche 4.
3. **Ligne `[subpage …]` mal formée ou collée dans du texte** (`voir [subpage id="x"] ici`, `[subpage]`) : elle reste du texte, l'éditeur ne plante pas, et le round-trip la conserve telle quelle. Test dans la tâche 1.
4. **Plus de 3 ancêtres sur téléphone** : le fil d'Ariane affiche le premier ancêtre, `…`, puis la parente directe, sur une seule largeur d'écran. Test dans la tâche 4.
5. **Carte vers une note supprimée** : `Page introuvable` grisée, sans erreur en console, et le bloc reste supprimable. Test dans la tâche 4.

---

### Task 1 : Bloc `subpage` et entrée slash « Page » (paquet éditeur)

**Files :**
- Create : `packages/editor/src/blocks/subpage.tsx`
- Modify : `packages/editor/src/schema.ts`, `packages/editor/src/index.ts`, `packages/editor/src/types.ts` (props de l'éditeur, à côté de `renderEmbed`), `packages/editor/src/SupernoteEditor.tsx` (provider à côté d'`EmbedProvider`, passage aux items slash), `packages/editor/src/extensions/slashMenu.tsx` (`getSupernoteSlashMenuItems`), `packages/editor/src/serialization/serialize.ts` (à côté de `case "databaseView"`), `packages/editor/src/serialization/parse.ts` (à côté de la reconnaissance de `[databaseView …]`, ligne ~177)
- Test : `tests/e2e/22-sous-pages.spec.ts` (nouveau)

**Interfaces :**
- Produces :
  - `subpageBlockSpec` : type `"subpage"`, `propSchema: { noteId: { default: "" } }`, `content: "none"`.
  - `type SubpageRenderer = (props: { noteId: string }) => React.ReactNode` et `SubpageProvider({ renderer: SubpageRenderer | null, children })`. Sans renderer, le bloc rend `<div data-subpage-fallback>Page</div>`.
  - Trois props éditeur optionnelles : `createSubpage?: () => Promise<string | null>`, `onOpenSubpage?: (noteId: string) => void`, `renderSubpage?: SubpageRenderer`.
  - Markdown : la ligne entière `[subpage id="<noteId>"]`.
  - L'élément racine rendu par le bloc porte `data-subpage-id`, que l'hôte lit.

- [ ] **Step 1 : Écrire le test e2e qui échoue.** Dans `22-sous-pages.spec.ts`, describe desktop, viewport 1600×900, `bootCloud` :

```ts
test("[subpage] : repli « Page », round-trip exact, ligne mal formée gardée en texte", async ({ page }) => {
  const body = 'Intro\n\n[subpage id="01FANTOME"]\n\nvoir [subpage id="x"] ici\n\n[subpage]\n\nFin';
  const id = await seedNote(page, { title: "Hôte", body, folder: "Wiki" });
  await openNote(page, id);
  await expect(page.locator("[data-subpage-id='01FANTOME']")).toBeVisible();
  await page.getByText("Fin").click();
  await page.keyboard.type(" !");
  await expect.poll(async () => (await workerCall<{ body: string }>(page, "query", "entities.get", { id })).body)
    .toContain('[subpage id="01FANTOME"]');
  const saved = (await workerCall<{ body: string }>(page, "query", "entities.get", { id })).body;
  expect(saved).toContain('voir [subpage id="x"] ici');
  expect(saved).toContain("[subpage]");
});
```

Dans cette tâche, l'hôte ne fournit pas encore `renderSubpage`. Le test vérifie donc aussi le repli : `[data-subpage-fallback]` contient `Page`.

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue.** `pnpm build:packages && pnpm test:e2e tests/e2e/22-sous-pages.spec.ts -g "round-trip"`, en arrière-plan. Attendu : FAIL, `[data-subpage-id='01FANTOME']` est introuvable, parce que la ligne reste un paragraphe.

- [ ] **Step 3 : Implémenter le bloc, le provider, la sérialisation et le parse.** Le parse ne reconnaît que la ligne entière, après trim : `/^\[subpage id="([^"]+)"\]$/`. Il dé-échappe l'attribut comme le fait `databaseView`, et toute autre forme reste du texte. Le serialize utilise `escapeAttr`.

- [ ] **Step 4 : Ajouter l'entrée slash « Page ».** Elle n'existe que si `createSubpage` est fourni. Alias : `page`, `sous-page`, `wiki`. Signature : `getSupernoteSlashMenuItems(editor, openPicker, onAskAi?, subpage?: { create: () => Promise<string | null>; open: (noteId: string) => void })`. Au clic :
  1. `await create()`, puis s'arrêter si le résultat est `null` ;
  2. insérer `{ type: "subpage", props: { noteId } }` comme les autres blocs non textuels (le bloc courant vide est remplacé) ;
  3. appeler `open(noteId)`.

  `SupernoteEditor` passe ce quatrième argument depuis les props, via des refs pour garder `getItems` stable.

- [ ] **Step 5 : Relancer le test.** Même commande. Attendu : PASS. Puis `pnpm typecheck && pnpm lint`, attendu : 0 erreur.

- [ ] **Step 6 : Commit.** `feat(editor): bloc sous-page [subpage id] et entrée slash « Page »`

---

### Task 2 : Route `entities.subpageDescendants` et déplacement avec la descendance

**Files :**
- Modify : `packages/ipc/src/schemas/entities.ts`, `packages/ipc/src/router/entities.router.ts` (à côté de `moveIfFree`), `apps/web/src/lib/vault-worker/worker-router.ts` (fonction à côté d'`entitiesListByDateRange`, entrée dans la table ligne ~3878), `apps/web/src/components/notes/hooks.ts` (`useMoveNote`, ligne ~676)
- Test : `tests/e2e/22-sous-pages.spec.ts`

**Interfaces :**
- Produces :
  - `entities.subpageDescendants`, en query. Input `{ id: string }`, output `{ items: Array<{ id: string; filePath: string }> }`. Elle renvoie les descendants joignables par `fields.parentId` **en ne traversant que des notes du même dossier que `id`**. La racine est exclue de la sortie.
  - `useMoveNote().moveNote(id, folder)` garde sa signature et son retour. Elle déplace désormais aussi cette descendance.

- [ ] **Step 1 : Écrire le test e2e qui échoue.**

```ts
test("déplacer une page emmène sa descendance du même dossier, pas l'enfant rangé ailleurs", async ({ page }) => {
  const p = await seedNote(page, { title: "Wiki racine", body: "", folder: "Wiki" });
  const c = await seedNote(page, { title: "Domaine", body: "", folder: "Wiki", fields: { parentId: p } });
  const g = await seedNote(page, { title: "Sous-domaine", body: "", folder: "Wiki", fields: { parentId: c } });
  const d = await seedNote(page, { title: "Rangée ailleurs", body: "", folder: "Ailleurs", fields: { parentId: p } });
  const loop = await seedNote(page, { title: "Boucle", body: "", folder: "Wiki", fields: { parentId: g } });
  await workerCall(page, "mutation", "entities.update", { id: c, fields: { parentId: loop } }); // cycle c → loop → g → c
  const { items } = await workerCall<{ items: { id: string }[] }>(page, "query", "entities.subpageDescendants", { id: p });
  expect(items.map((i) => i.id)).toEqual([]); // c n'est plus enfant de p
  await workerCall(page, "mutation", "entities.update", { id: c, fields: { parentId: p } });
  const after = await workerCall<{ items: { id: string }[] }>(page, "query", "entities.subpageDescendants", { id: p });
  expect(after.items.map((i) => i.id).sort()).toEqual([c, g, loop].sort());
  await seedNote(page, { title: "Témoin", body: "", folder: "Archives" }); // le dossier cible doit exister dans l'arbre
  // Geste réel : glisser la rangée « Wiki racine » sur la rangée du dossier « Archives »,
  // avec le même helper de drag que 21-notes-dnd.spec.ts (le réutiliser, ne pas en écrire un autre).
  for (const id of [p, c, g, loop]) {
    await expect.poll(async () => (await workerCall<{ filePath: string }>(page, "query", "entities.get", { id })).filePath)
      .toMatch(/^Archives\//);
  }
  expect((await workerCall<{ filePath: string }>(page, "query", "entities.get", { id: d })).filePath).toMatch(/^Ailleurs\//);
});
```

Avant d'écrire le drag, vérifier que `entities.update` fusionne `fields` (lire la route worker). Sinon, passer l'objet complet.

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue.** `pnpm test:e2e tests/e2e/22-sous-pages.spec.ts -g "descendance"`. Attendu : FAIL, la route est inconnue du worker.

- [ ] **Step 3 : Ajouter le contrat IPC et la route worker.** Côté worker, une seule requête suffit : `SELECT id, filePath, json_extract(fields, '$.parentId') AS parentId FROM entity WHERE vaultId = ? AND json_extract(fields, '$.parentId') IS NOT NULL`. Le parcours en largeur se fait en JS depuis `id`, avec un ensemble `visited` et un filtre sur le dossier (`filePath` sans son dernier segment) égal à celui de la racine. La garde de cycle porte sur la racine aussi : un nœud qui revient sur `id` est ignoré.

- [ ] **Step 4 : Étendre `useMoveNote`.** Lire la descendance **avant** de déplacer la racine, puisque le filtre porte sur son dossier d'origine. Déplacer ensuite la racine, puis chaque descendant avec le même `moveIfFree({ id, folder })`, et invalider `entities.get` pour chacun. Si la racine ne bouge pas (`moved: false`), ne rien déplacer d'autre.

- [ ] **Step 5 : Relancer.** `pnpm build:packages`, puis le test. Attendu : PASS. Lancer aussi `pnpm test:e2e tests/e2e/21-notes-dnd.spec.ts` (non-régression du glisser-déposer), puis `pnpm typecheck && pnpm lint`.

- [ ] **Step 6 : Commit.** `feat(notes): déplacer une page emmène ses sous-pages du même dossier`

---

### Task 3 : Logique d'imbrication partagée et mention « dans X » dans la liste

**Files :**
- Create : `apps/web/src/lib/subpages.ts`
- Modify : `apps/web/src/components/notes/NoteListItem.tsx` (à côté de `mountLabel`, ligne ~601), `apps/web/src/components/notes/NoteList.tsx` (passe le libellé)
- Test : `tests/e2e/22-sous-pages.spec.ts`

**Interfaces :**
- Produces :
  - `parentIdOf(fields: Record<string, unknown> | undefined): string | null` renvoie une chaîne non vide, ou `null`.
  - `nestSubpages<T extends { id: string; title: string; folderPath: string; fields?: Record<string, unknown> }>(notes: readonly T[]): { topLevel: T[]; childrenOf: Map<string, T[]> }`. Une note est enfant si sa parente est dans `notes`, dans le même `folderPath`, sans archivage (`fields.archivedAt`) et sans cycle (remonter la chaîne dans `notes` ne revient pas sur elle). Sinon elle est au premier niveau. L'ordre d'entrée est conservé.
  - `NoteListItem` gagne `parentLabel?: string`, rendu en texte discret `dans <parentLabel>`.

- [ ] **Step 1 : Écrire le test e2e qui échoue.**

```ts
test("liste du dossier : la sous-page porte « dans <parent> », un cycle n'en porte pas", async ({ page }) => {
  const p = await seedNote(page, { title: "Wiki", body: "", folder: "Wiki" });
  await seedNote(page, { title: "Domaine RH", body: "", folder: "Wiki", fields: { parentId: p } });
  const a = await seedNote(page, { title: "Cycle A", body: "", folder: "Wiki" });
  const b = await seedNote(page, { title: "Cycle B", body: "", folder: "Wiki", fields: { parentId: a } });
  await workerCall(page, "mutation", "entities.update", { id: a, fields: { parentId: b } });
  await page.goto("/notes?folder=Wiki");
  const row = page.getByRole("listitem").filter({ hasText: "Domaine RH" });
  await expect(row.getByText("dans Wiki")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Cycle A" }).getByText(/^dans /)).toHaveCount(0);
});
```

Ajuster le rôle des rangées s'il diffère : lire `NoteListItem`.

- [ ] **Step 2 : Lancer le test et vérifier qu'il échoue.** Attendu : FAIL, `dans Wiki` est absent.

- [ ] **Step 3 : Implémenter `lib/subpages.ts` et le libellé.** `NoteList` calcule le libellé avec `nestSubpages` sur ses notes : seule une note qui est enfant au sens de `nestSubpages` reçoit `parentLabel` = titre de la parente, ce qui exclut le cycle.

- [ ] **Step 4 : Relancer en desktop, puis en mobile (390 px).** Attendu : PASS. En mobile, la mention ne crée pas de débordement : pas de scroll horizontal mesuré par `document.documentElement.scrollWidth <= 390`. Puis `pnpm typecheck && pnpm lint`.

- [ ] **Step 5 : Commit.** `feat(notes): mention « dans <page> » des sous-pages dans la liste`

---

### Task 4 : Carte, création, fil d'Ariane (hôte, touche `NoteEditor.tsx`)

**Démarrer seulement après l'accord de `supernote-26`** (voir Global Constraints).

**Files :**
- Create : `apps/web/src/components/notes/SubpageCard.tsx`, `apps/web/src/components/notes/SubpageCrumbs.tsx`, `apps/web/src/components/notes/useSubpages.ts`
- Modify : `apps/web/src/components/notes/NoteEditor.tsx`. Diff minimal :
  - props `createSubpage`, `onOpenSubpage`, `renderSubpage` sur `SupernoteEditor` ;
  - prop `trailing?: React.ReactNode` sur `FolderBreadcrumb`, rendue après les segments. Quand le chemin est vide, la `nav` s'affiche quand même s'il y a un `trailing`.
- Test : `tests/e2e/22-sous-pages.spec.ts`

**Interfaces :**
- Consumes :
  - tâche 1 : les props éditeur et `data-subpage-id` ;
  - tâche 3 : `parentIdOf`.
- Produces :
  - `useCreateSubpage(parent: { id: string; folderPath: string }): () => Promise<string | null>`. Elle passe par `useCreateNote` avec `title: "Sans titre"` et `fields: { parentId: parent.id }`, dans le dossier de la parente. Une erreur donne `null`.
  - `useNoteAncestors(parentId: string | null): Array<{ id: string; title: string }>`, de la racine vers la parente directe. Les ancêtres sont lus par `utils.entities.get.fetch`. La chaîne s'arrête si une note est introuvable, si elle a `fields.archivedAt`, sur un id déjà vu, ou à une profondeur de 32.
  - `SubpageCard({ noteId }: { noteId: string })` :
    - titre vivant lu par `trpc.entities.get.useQuery({ id: noteId }, { retry: false })`, `Sans titre` si vide ;
    - compteur des enfants, compté dans `useNoteList(null)` : `shortcut: compte sur la liste client plafonnée à 500, passer par une route worker si un wiki dépasse` ;
    - clic ou Entrée : `router.push(\`/notes/${noteId}?folder=${encodeURIComponent(folderPath)}\`)` ;
    - erreur de lecture : carte grisée `Page introuvable` avec `data-state="missing"` ;
    - hauteur minimale de 32 px.
  - `SubpageCrumbs({ parentId }: { parentId: string | null })` : un lien par ancêtre, séparés par le même chevron que `FolderBreadcrumb`. Sous 768 px et au-delà de 3 ancêtres, elle affiche le premier, `…` (avec `aria-label` listant les titres masqués), puis la parente directe.
- Dans NoteEditor, `onOpenSubpage(noteId)` annule le debounce en cours, puis `await updateNote(note.id, titleRef.current, bodyRef.current)`, puis navigue vers la sous-page. Le `onChange` de l'éditeur est synchrone, donc `bodyRef` contient déjà la carte. En cas d'échec, on reste sur la parente et on affiche le toast d'erreur existant.

- [ ] **Step 1 : Écrire les tests e2e qui échouent** (desktop) :
  - `"/page crée, ouvre la sous-page, et la carte survit au rechargement"` : taper `/page` puis Entrée dans « Wiki ». L'URL devient `/notes/<nouvel id>` et le titre `Sans titre` a le focus. Taper le titre `Domaine RH`, revenir par le fil d'Ariane. La carte `[data-subpage-id]` affiche `Domaine RH` (test 3 de la spec : le renommage met à jour la carte). Recharger, la carte est toujours là.
  - `"trois niveaux : le fil d'Ariane montre les deux ancêtres cliquables"` : seed Wiki → Domaine → Sous-domaine, ouvrir Sous-domaine. Les liens `Wiki` et `Domaine` sont visibles, cliquer `Wiki` ouvre Wiki.
  - `"parente supprimée ou archivée : la sous-page reste accessible, le fil d'Ariane s'arrête"` : supprimer la parente avec `entities.delete`, ouvrir l'enfant, aucun ancêtre affiché. Archiver une autre parente, même attente.
  - `"carte vers une note supprimée : « Page introuvable »"` : `[data-subpage-id] [data-state=missing]` affiche `Page introuvable`, et le bloc se supprime au clavier (sélection du bloc + Retour arrière).

  En mobile, describe 390×844, `hasTouch` :
  - `"mobile : /page, carte ≥ 32 px, fil replié au-delà de 3 ancêtres, pas de débordement"`. Avec 4 ancêtres, le fil affiche `…`, la hauteur de la carte (`boundingBox`) est ≥ 32 et `scrollWidth <= 390`.

- [ ] **Step 2 : Lancer et vérifier l'échec.** Attendu : FAIL, l'entrée « Page » est absente du menu slash, faute de `createSubpage` côté hôte.

- [ ] **Step 3 : Implémenter les trois nouveaux fichiers, puis le diff minimal de `NoteEditor.tsx`.** `renderSubpage` est un `useCallback` stable qui rend `<SubpageCard noteId={noteId} />`.

- [ ] **Step 4 : Relancer `22-sous-pages.spec.ts`.** Attendu : tout PASS. Non-régression : `02-write-note.spec.ts` et `20-qol-notes.spec.ts`, puis `pnpm typecheck && pnpm lint`.

- [ ] **Step 5 : Commit.** `feat(notes): sous-pages, carte, création /page et fil d'Ariane`

---

### Task 5 : Imbrication dans l'arbre (touche `FileTree.tsx`)

**Démarrer seulement après l'accord de `supernote-26`.**

**Files :**
- Modify : `apps/web/src/components/notes/FileTree.tsx` :
  - `buildNotesByFolder` (ligne ~317) ne garde que les notes de premier niveau ;
  - `NoteRows` (ligne ~2334) rend les enfants ;
  - un contexte expose `childrenOf`.
- Test : `tests/e2e/22-sous-pages.spec.ts`

**Interfaces :**
- Consumes : `nestSubpages` et `parentIdOf` (tâche 3).
- Produces : l'état déplié de chaque note dans `localStorage["supernote.notes.tree.subpagesExpanded"]`, sur le modèle d'`EXPANDED_STORAGE_KEY` : un tableau d'ids, lecture et écriture dans un try/catch. **Par défaut, une note qui a des enfants est repliée**, pour qu'un wiki de 50 pages n'encombre pas l'arbre (anti-objectif de la spec).

- [ ] **Step 1 : Écrire le test e2e qui échoue.**
  - `"arbre : la sous-page se range sous sa parente, chevron replié par défaut, un cycle reste au premier niveau"` :
    - seed Wiki → Domaine dans `Wiki`, plus un cycle A ↔ B ;
    - la rangée `Domaine` est absente du premier niveau ;
    - la rangée `Wiki` a `aria-expanded="false"` ;
    - un clic sur le chevron montre `Domaine` indenté (`depth` + 1) ;
    - l'état survit au rechargement ;
    - `Cycle A` et `Cycle B` sont visibles au premier niveau.
  - En mobile, sur `/notes` sans dossier (l'arbre plein écran) : mêmes attentes, chevron ≥ 32 px, `scrollWidth <= 390`.

- [ ] **Step 2 : Lancer et vérifier l'échec.** Attendu : FAIL, `Domaine` est au premier niveau.

- [ ] **Step 3 : Implémenter.** Le chevron reprend les mêmes gestes et attributs que celui des dossiers : `aria-expanded`, Flèche droite et gauche. `NOTES_PER_FOLDER_CAP` porte sur `topLevel`.

- [ ] **Step 4 : Relancer `22-sous-pages.spec.ts`, `13-dossiers.spec.ts` et `21-notes-dnd.spec.ts`.** Attendu : PASS. Puis `pnpm typecheck && pnpm lint`.

- [ ] **Step 5 : Commit.** `feat(notes): sous-pages imbriquées sous leur parente dans l'arbre`

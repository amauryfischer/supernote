# Audit complet Supernote — 1ᵉʳ juillet 2026

Audit multi-dimensions (8 passes parallèles : architecture, données/worker, perf front, UX cœur, UX mail, features périphériques, qualité/sécu, mobile). Lecture seule, aucun code modifié. Priorisation impact/effort.

## TL;DR

L'app est architecturalement saine (pas de cycles, code splitting bon, sanitization mail exemplaire, 800+ tests verts, typecheck OK) mais souffre de quatre pathologies transverses :

1. **Filet de sécurité inexistant** : CI 100 % rouge depuis ≥2 semaines (fix 1 ligne), zéro ErrorBoundary, zéro télémétrie erreurs, ESLint fantôme, zéro CSP.
2. **Risques de perte de données réels** : coffre cloud OPFS évictable sans `storage.persist()` (canvas/pièces jointes n'existent nulle part ailleurs), zéro transaction SQL, un bug undo mail qui fait disparaître des emails, un modal schéma qui détruit la config des champs au save, des templates jamais persistés.
3. **Le freeze mobile a un suspect n°1 identifié** : `entities.list` clone 500–10 000 entités **avec body complet** worker→main thread, couplé à `invalidateQueries()` global sur chaque vault-ready/batch sync, sur des listes non virtualisées. L'Accueil rapatrie ~40 000 entités pour 4 compteurs.
4. **Beaucoup d'UI qui promet et ne tient pas** : palette 10/13 commandes stubs, Paramètres > Raccourcis édite des raccourcis inexistants, SecurityTab/ApiTab/BackupTab échouent à l'exécution, config de colonnes invisible (memo), ~25 mutations sans feedback d'erreur, /recherche orpheline.

Le mobile viole la règle parité sur ~6 surfaces (liste mail en lecture seule au doigt), mais **tous les patterns correctifs existent déjà dans le repo** (swipe notes, long-press todos, popover Eisenhower).

---

## Tier 0 — Fixes immédiats (chacun ≤ ½ journée, impact fort)

| # | Fix | Fichiers | Pourquoi |
|---|---|---|---|
| 0.1 | **Réparer la CI** : supprimer `version: 11` du workflow (conflit avec `packageManager`) | `.github/workflows/ci.yml:16-18` | 100 % des runs rouges depuis ≥2 semaines ; tout le reste du filet en dépend |
| 0.2 | **`navigator.storage.persist()`** au montage d'un coffre OPFS/cloud + statut affiché | grep vide dans `apps/web/src` | Éviction navigateur = perte définitive canvas + pièces jointes (hors op-log) |
| 0.3 | **Undo-delete mail** : `flushOutboxInner` doit appliquer `addLabelIds` après `untrashThread` | `lib/mail-sync.ts:217-228` | L'email « restauré » re-disparaît au sync suivant — perte silencieuse |
| 0.4 | **Memo de `Cell`** : inclure les props de config kind-spécifiques dans le comparateur | `components/bases/Cell.tsx:250-263` | Toute la config colonne (format, options, currency…) semble morte — c'est le vrai « gap Cell display » |
| 0.5 | **FieldEditorModal** : spread `{...field}` au save au lieu d'extras codés en dur | `components/schemas/FieldEditorModal.tsx:79-90` | « Enregistrer » détruit outputKind/relations/min/max/defaultValue du champ |
| 0.6 | **FTS tags** : relire `entity_tag` quand `tags === undefined` dans `entitiesUpdate` | `worker-router.ts:1193-1200` | Chaque update de corps efface les tags de l'index → recherche par tag dégrade en session |
| 0.7 | **Index SQL manquants** : `CREATE INDEX IF NOT EXISTS` sur `relation_edge(sourceId/targetId)`, `mention(sourceId/targetId)`, `entity_tag(tagId)`, `entity(vaultId, updatedAt)` | `lib/vault-worker/db-schema.ts:316-335` | Backlinks/relations/tags scannent les tables ; s'applique au prochain boot sans migration |
| 0.8 | **DocxViewer** : `DOMPurify.sanitize(result.html)` avant injection | `attachments/viewers/DocxViewer.tsx:161` | Seul `dangerouslySetInnerHTML` non sanitizé du repo (XSS via .docx piégé) |
| 0.9 | **SettingsContext** : `useMemo` sur la value du provider | `settings/SettingsContext.tsx:91` | Provider racine recréé à chaque render → cascade de re-renders |
| 0.10 | **Escape palette** : normaliser `esc`→`escape` + lire l'état via ref | `CommandSurface.tsx:65-77`, `lib/keyboard/normalize.ts:32-37` | Escape ne ferme pas la palette ; deux hints UI mensongers |
| 0.11 | **Binding email→todo** : `removeBinding` dans le `handleDelete` de /todos + élagage reconcile | `app/todos/page.tsx:711-724`, `lib/mail-todo-binding.ts:288-290` | Todo supprimée = email invisible partout (ni inbox ni todos) |
| 0.12 | **iframe Google Sheets** : attribut `sandbox` | `packages/editor/src/blocks/googleSheet.tsx:252` | Durcissement gratuit |
| 0.13 | **Groupement en table** : ajouter `table` à `showGroupPivot` | `BaseToolbar.tsx:64-65` | Feature complète implémentée, inaccessible |
| 0.14 | **Recherche unifiée tactile** : entrée MoreDrawer + action header /mail | `mobile/MoreDrawer.tsx`, `mail/page.tsx` | Cmd+Shift+K est le seul déclencheur — feature invisible sur mobile |

## Tier 1 — Chantiers courts (1–3 jours chacun)

### 1.1 Observabilité prod (débloque le dossier freeze mobile)
- ErrorBoundary racine + handlers `unhandledrejection`/`error` branchés sur le store du freeze-watchdog (`FreezeReportBanner`).
- Compléter le watchdog : heartbeat `sn:freeze:lastAlive` ~5 s (aujourd'hui impossible de dater/mesurer un gel), attribution des longtasks, breadcrumbs sur refetch react-query/batchs sync/triage mail/montage DataGrid, upload auto au boot suivant (`sendBeacon` vers `server.mjs`).
- Surface persistante dans /parametres pour relire un rapport (bannière actuelle éphémère).
- Fichiers : `lib/diagnostics/freeze-watchdog.ts`, `FreezeReportBanner.tsx`, `main.tsx`, `server.mjs`.

### 1.2 Régime de données (suspect n°1 du freeze)
- Variante `entities.listSummaries` **sans body** (excerpt calculé côté worker) pour toutes les listes — `NoteListItem` n'utilise que 120 chars.
- Invalidation ciblée par router au lieu de `queryClient.invalidateQueries()` global sur vault-ready/index-progress (`lib/trpc/Provider.tsx:73-99`).
- Endpoints d'agrégation SQL pour l'Accueil (`VaultStatsWidget` 4×10 000, `TodayWidget` 2×5 000 + parsing bodies) et pagination réelle sur /todos (2×5 000).
- Corriger `total` faux de `entities.list` (COUNT non filtré, `worker-router.ts:717`) et `relations.listAll` inexistant dans le dispatch (« Unknown procedure » silencieux).

### 1.3 Transactions SQL worker
- Helper `runInTransaction(db, fn)` (BEGIN IMMEDIATE/COMMIT/ROLLBACK) autour de chaque handler de mutation : `entitiesCreate/Delete`, `syncApplyOps`, `mailSyncUpsert`, `mailApplyLocalMutation`.
- Double gain : intégrité (worker tué mi-écriture = états partiels aujourd'hui) + perf (1 commit au lieu de centaines sur les batchs mail).

### 1.4 Câbler la palette + raccourcis morts
- 10/13 commandes = stubs `console.info` (`lib/commands/seed.ts`) : câbler `router.push`/`useShellChrome` (trivial), retirer le reste.
- Supprimer le binding global Cmd+D (stub qui shadow le « recopier vers le bas » du DataGrid) et Cmd+Shift+F, ou les implémenter.
- /recherche est orpheline (zéro lien dans l'app) : implémenter `search.open` + entrée sidebar/MoreDrawer.
- Résoudre le conflit Cmd+Alt+N (notifications vs nouvelle note).
- Paramètres > Raccourcis : section fantôme (édite des raccourcis que personne ne lit) → brancher le ShortcutProvider sur `settings.shortcuts` ou passer en lecture seule de la vérité.

### 1.5 Feedback d'échec systémique
- ~25 mutations fire-and-forget ou catch console-only : création de note (bouton +, FAB, Cmd+N), mutations tags, application de template, personnalisations de note, sync des montages `@mounts` (`onStatus: () => {}`), erreurs FTS avalées à 3 niveaux (toujours « Aucun résultat »).
- L'outillage existe (`withMutationFeedback`, `useToast` @supernote/ui) — il n'est consommé nulle part sur ces surfaces. Unifier les 3 systèmes de toast au passage.
- Distinguer erreur/état vide dans RightPanel, recherche, StackedColumns (wikilink inexistant = spinner infini).

### 1.6 Triage mail tactile
- Liste mail = lecture seule au doigt : triage/sélection/tags accessibles uniquement clavier + clic droit (iOS ne déclenche jamais `contextmenu`).
- Long-press → bottom-sheet réutilisant `MailRowContextMenu` (via `useLongPress` existant de todos) + option swipe archive/done (pattern `NoteListItem`).
- Réactiver sélection multiple mobile (pattern long-press todos) et « Ajouter un tag » dans le menu.

### 1.7 Purge du code mort (~15k LOC)
- Packages jamais importés : `voice`, `ocr`, `git`, `crypto`, `cli`, `api`, `plugin-sdk`, `finance`, `import`, `db` (+ `packages/views` fantôme) — la couche « Electron fantôme » dont tous les endpoints jettent `notImplemented`.
- UI trompeuse branchée en prod : SecurityTab (mutations qui échouent toutes), ApiTab (token pour serveur jamais démarré), export ZIP BackupTab (`MOCK_EXPORTS`), drop audio/image NoteEditor (toast 60 s puis erreur garantie — ou le fixer via le chemin du paste qui marche, cf. N4).
- `graph-page/` + `section-stub/` (zéro import), deps fantômes (`@supernote/finance` dans apps/web), 3 branches locales 100 % mergées (`feat/vault-mounts`, `feat/quality-pass`, `feat/mail-overlay`).
- Route `/command-demo` atteignable en prod.

### 1.8 Sécurité serveur + deps
- CSP + security headers dans `server.mjs` (`send()`) : deuxième couche XSS quasi gratuite (attention sql.js-wasm → `wasm-unsafe-eval`, GIS, connect-src Gmail/Drive/Unsplash).
- Activer les Dependabot security alerts (désactivées — personne n'est notifié) ; migrer `xlsx` (prototype pollution/ReDoS sans patch npm, dans le bundle client) vers build SheetJS patché ou `exceljs` ; bump dompurify transitif.
- Après fix CI : merger les bumps patch/minor ; zod 4 et react-router 7 = chantiers dédiés, pas des merges dependabot.

## Tier 2 — Chantiers moyens (semaine ±)

### 2.1 Virtualisation des listes chaudes
`@tanstack/react-virtual` sur `MailOverlayList` (500 lignes montées) et `DataGrid` d'abord, puis NoteList/todos. Zéro virtualisation aujourd'hui hors fenêtrage maison de FolderIconPickerGrid.

### 2.2 Robustesse mail (outbox, token, write-path)
- Outbox : ne pas compter les échecs réseau comme attempts (5 triages offline = op `failed` définitive), backoff par op, listeners `online`/`visibilitychange` → flush (aujourd'hui rien ne part au retour réseau sans action utilisateur), poll 5 s → event-driven (`MAIL_OUTBOX_EVENT` existe).
- Token : wrapper 401 dans `gmailFetch` (purge cache + retry), état global « reconnexion Gmail requise » au lieu d'échecs épars silencieux (badge à 0, mirror figé, popups GIS bloquées hors geste).
- Unifier le write-path : les mutations du fil ouvert (TriageBar, labels, étoile, markRead) contournent l'outbox → divergences mirror/Gmail durables + non-durabilité offline.
- Snooze : réveil uniquement au mount de /mail (app fermée = email perdu de vue), aucune UI « Reportés », store mono-appareil → interval+visibilitychange + section Reportés, idéalement label Gmail dédié.
- Rafraîchissement inbox en session (aucun aujourd'hui — le badge sidebar se met à jour, pas la liste) ; undo pour les actions bulk ; purge à la déconnexion (corps d'emails restent lisibles dans OPFS + tokens des autres scopes en cache).
- Inbox >200 fils : indicateur de troncature (mirror borné 4×50, aucun « Charger plus » en mode mirror).

### 2.3 Bases : boucher les promesses non tenues
- `defaultValue` écrit sous `name`, lu par `id` → jamais visible (`worker-router.ts:812-826` vs `DataGrid.tsx:1271`).
- `required`/`unique` persistés, jamais validés ; FormView : inputs non typés (select/relation = texte brut → valeurs hors options).
- **Ouvrir une fiche depuis les vues** : `onOpen` jamais câblé (Kanban/Gallery/List/Calendar) — le geste cœur du modèle Notion/Coda n'existe pas. Câbler vers la DetailView existante en drawer.
- Undo de suppression de ligne recrée avec nouvel id + body vide → relations cassées silencieusement.
- Kanban tactile : popover « Déplacer vers… » (pattern MailEisenhowerBoard).
- Unifier les 3 éditeurs de champ (dont kind `ai` impossible à créer et effacé au resave) ; FormulaInputEditor à la place du textarea nu de ColumnEditorSidebar ; filtre `eq ""` qui vide la grille ; clic d'en-tête qui écrase le multi-tri ; `READONLY_KINDS` en 4 copies divergentes.

### 2.4 Templates : persister ou avouer
Aucune route `templates.*` dans le worker — tout le CRUD tombe en fallback mémoire silencieux (`SEED_TEMPLATES` + useState), tout est perdu au rechargement. Implémenter les routes worker (L) ; a minima bandeau « mode non persisté » (S). + Découvrabilité : ni sidebar, ni palette, ni flux de création de note. + Édits perdus au changement de sélection sans confirmation.

### 2.5 Passe parité mobile dédiée
Une passe unique plutôt que des correctifs dispersés : détail /tags `hidden md:block` (tap sans effet), ColumnEditorSidebar hover-only dans l'overlay mobile (pattern correctif : `NoteCover.tsx:300`), /ai + /pomodoro absents du MoreDrawer, sous-pages finance sans chrome (boutons HTML nus ~28px), déplacement/renommage de note impossibles au doigt, édition doodle double-clic only, popovers filtres/tri 360-520px qui débordent, hit targets <32px (étoile mail 19px), paddings `px-10` secs, badge non-lus mail absent du mobile, onboarding cassé sur mobile.

### 2.6 ESLint réel + backend sync typé
- ESLint 9 flat config racine (typescript-eslint + react-hooks) : le lint web = `echo`, 19 scripts pointent un binaire absent, ~165 casts d'échappement non surveillés (concentrés frontière BlockNote).
- `sync-backend.mjs`/`sync-store.mjs` (serveur push/SSE/Postgres — le code le plus critique pour l'intégrité multi-clients) → TS dans `packages/sync`, tests sur le store (dedup opId, seq, purge, compaction).

## Tier 3 — Fond (chantiers structurels, à planifier)

- **Découper `worker-router.ts`** (4 606 LOC, 64 routes, 10 domaines) en modules par domaine → débloque la testabilité du cœur data (quasi zéro test aujourd'hui ; sql.js s'instancie sous vitest node). Migrations navigateur : `PRAGMA user_version` + liste ordonnée au lieu de la détection ad hoc à échecs avalés.
- **Source de vérité `Field` dans core** : zod discriminé dans `@supernote/core`, IPC dérivé, adapters réduits à la traduction de noms — supprime la taxe « 4 points de modification par propriété ». + Résorber `ipc/result` (le TODO pointe `core/result` qui existe) et l'inversion de couche `ipc→ai`.
- **Unifier slugify/deriveTitle** (3 implémentations divergentes, drift `nom` déjà constaté = fichiers introuvables/dupliqués possibles) dans `@supernote/core/paths` + tests accents/espaces.
- **Miroir FSA** : export full-DB à chaque mutation, amplifié par le mirror mail dans la même DB → coalescing ou tables mail hors miroir. Boot : `ftsRebuild` inconditionnel O(N) à chaque démarrage → conditionner.
- **Sync LWW** : horloge murale du device, granularité entité (édition concurrente = perte d'un côté entier) → stamper côté serveur au minimum ; décider la sémantique delete des entités montées (seule mutation non gatée par provenance).
- **Raccourcis centralisés** : ~90 % des raccourcis contournent le ShortcutProvider (scopes = code mort) ; garde clavier mail incomplète (frappe `e`/`#` derrière une modale trie quand même) ; porter la nav j/k du mail sur NoteList/recherche/sidebar ; cheat-sheet `?` globale (app+mail+bases, aujourd'hui éditeur only, zéro hint sur les raccourcis mail).
- **Blindage images mail** : images distantes chargées auto (tracking pixels) + `background-image:url()` non couvert → placeholder + « Afficher les images » par expéditeur.
- **E2E en CI** : 7 specs Playwright existants jamais exécutés en CI (job non bloquant au début) + `format:check`.
- **Décisions produit à trancher** : geler finance/habits/journal (fonctionnels, suffisants), garder automations/ai/canvas/templates/notifications (dépendances réelles), N1 formule inline (event `formula-inline-commit` sans aucun listener — travail utilisateur jeté), contact 360 (fixtures mensongères en mode dégradé, boutons morts), éditeur de formule inline vs modal.

## Points positifs vérifiés (ne pas « corriger »)

- Chaîne sécurité mail exemplaire : DOMPurify strict + anti-clickjacking + anti-CRLF headers + pièces jointes en Blob + IA nourrie de texte brut uniquement.
- OAuth memory-only (jamais localStorage), cache par scope avec marge d'expiration.
- Code splitting : routes lazy, BlockNote/Excalidraw/sql.js hors bundle initial (2 fuites : import statique `NotePortal`→éditeur, `UnifiedSearchModal` dans RootLayout).
- Moteur motion rAF auto-suspendu, cleanups de timers systématiques, shell chrome bien memo-isé.
- Tests : formulas 344, apps/web 804 (mail bien couvert), typecheck 23/23.
- Mirror mail : tables dédiées hors `entity`/FTS, volumétrie bornée, index corrects.
- vault-mounts entièrement mergé dans main avec gates de provenance (sauf delete).

## Chiffres

| Dimension | Findings | Critiques | Hautes |
|---|---|---|---|
| Architecture/dette | 14 | 0 | 4 |
| Données/worker/sync | 13 | 1 | 5 |
| Perf front | 9 | 2 | 1 |
| UX surfaces cœur | ~55 | 4 | ~18 |
| UX mail/todos/contacts | 14 | 1 | 4 |
| Features périphériques | 6 groupes | — | 2 |
| Qualité/tests/sécu | 11 | 1 | 3 |
| Mobile | 16 | 1 | 4 |

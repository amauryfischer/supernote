# Flux — le journal comme porte d'entrée (design)

Date : 2026-09-03
Statut : design validé, prêt pour plan d'implémentation

## Contexte & objectif

Brainstorm de différenciation face à Coda/Notion/Obsidian. Quatre paris de
paradigme proposés — flux vs page, conversation vs navigation, zéro-rangement,
coin vs plateforme. Pari retenu : **A, le flux, pas la page**. Aucun des trois
concurrents ne peut le copier sans renier son propre modèle (Notion/Coda
exigent une structure avant l'écriture ; Obsidian n'a ni CRM ni finance ni mail
dans son graphe).

Objectif v1 : transformer l'entrée par défaut de Supernote d'une page vierge en
un flux chronologique qui **alimente automatiquement** le graphe d'entités
existant (contacts, todos) sans jamais rien créer sans confirmation explicite.

## État actuel (ce qui existe déjà — à réutiliser, pas reconstruire)

- `/journal` (`apps/web/src/app/journal/page.tsx`, `[date]/page.tsx`) : note
  quotidienne fonctionnelle (éditeur + sidebar calendrier, template
  `DAILY_JOURNAL`). Gatée (`NavGate: "journal"` dans
  `lib/navigation/catalog.ts:80`), rangée en position secondaire (groupe
  "knowledge" desktop, tiroir `MoreDrawer` mobile).
- `/capture` (`apps/web/src/app/capture/page.tsx`) : popup de capture, écrit
  pour une `BrowserWindow` Electron absente du repo (pivot SPA déjà fait,
  aucun dossier `electron/`). Routée (`router.tsx:153`) mais liée nulle part ;
  `window.close()` est un no-op dans un onglet normal. Code mort.
- `/` (Accueil, `apps/web/src/app/page.tsx`) : rend `WritingSurface`, un banc
  de test éditeur sans vault — jamais pensé comme un accueil produit.
- `packages/ai` (`@supernote/ai`) : **le moteur d'extraction existe déjà**,
  complet, utilisé en prod sur le mail :
  - `createActionExtractor()` expose `.extractActions(text)` (Ollama + repli
    heuristique regex — détecte TODO/FIXME/« il faut »/« je dois » avec
    assignee/deadline/priority) et `.extractEntityMentions(text,
    candidateEntities)` (Ollama + repli fuzzy heuristique — résout des
    mentions en texte libre contre une liste d'entités **existantes**
    fournie).
  - Consommé aujourd'hui uniquement par `lib/mail-ai.ts` (variante de prompt
    dédiée aux fils mail) et `ChatPanel.tsx`. Jamais branché sur les
    notes/le journal.
  - **Limite importante** : `extractEntityMentions` résout des mentions
    contre une liste d'entités *déjà existantes* qu'on lui fournit — il ne
    propose pas de créer une entité totalement nouvelle. La détection
    « personne jamais vue » n'existe pas.
- `indexMentions` (`vault-worker/worker-router.ts`) : pipeline de résolution
  pour la syntaxe explicite `@mention`/`[[lien]]` — prend le relais une fois
  qu'un texte libre est transformé en lien explicite.

## Décisions (validées)

### 1. Promotion de la route d'accueil

`/` rend désormais le Journal au lieu de `WritingSurface`. `WritingSurface`
reste dans le code (outil de debug éditeur documenté) mais change de route —
déplacé vers un chemin non listé en nav (ex. `/dev/writing-surface`), pas
supprimé.

`/journal` sort du gate `NavGate` et de sa position secondaire ; devient la
cible de l'item "Accueil" existant (desktop et bottom nav mobile — 4 slots
déjà pleins, on repointe l'existant, on n'en ajoute pas un).

Notes/Bases/CRM/Finance inchangés en dessous : additif, pas une refonte du
modèle de données (tout est déjà entité + relation).

### 2. Extraction avec confirmation — brancher l'existant, pas en reconstruire un

Sur l'entrée du jour, debounced sur l'édition (même logique que l'auto-save
existant, appelé depuis le composant `JournalEditor` — Ollama est un fetch
HTTP local, pas une opération SQLite, donc pas besoin du vault worker) :

- `extractEntityMentions(texte, candidats)` où `candidats` = contacts/
  organisations existants du vault (requête `entities.list` sur les typeIds
  pertinents). Un match → chip de suggestion sous le paragraphe
  (« Julie → lier au contact ? »).
- `extractActions(texte)` → chip équivalente pour chaque action détectée
  (« Rappeler Julie — créer une tâche ? », deadline/assignee pré-remplis si
  détectés).

Acceptation :
- Mention acceptée → le span est réécrit en `[[Julie]]` dans le markdown
  source ; `indexMentions` (déjà existant) prend le relais normalement. Aucun
  nouveau chemin de création d'entité.
- Action acceptée → `entities.create` avec le typeId todo existant (même
  mutation que `/capture` aujourd'hui), pré-rempli depuis `ExtractedAction`.

Rejet → la chip disparaît, rien n'est créé, pas de liste noire persistée en v1
(YAGNI — si le même rejet revient trop souvent au même endroit, traité en v2).

Dégradation : `ollama.isAvailable()` déjà géré par `ActionExtractor` — Ollama
absent → repli heuristique (regex) automatique, pas d'erreur visible ;
heuristique vide → aucune chip, silencieux.

**Hors scope v1, explicite** : pas de détection de nouvelle entité jamais vue
(limite actuelle d'`extractEntityMentions`) — seulement la liaison vers des
contacts/organisations qui existent déjà. Étendre l'extracteur pour proposer
des créations serait un changement de `@supernote/ai` (nouveau prompt +
schema), pas du simple branchage : à instruire séparément si le v1 valide
l'usage.

### 3. Capture unifiée

`/capture` (mort, Electron) supprimé — fichier + route. Remplacé par un
raccourci clavier global côté app (pas de fenêtre séparée) qui ouvre un
mini-éditeur flottant écrivant directement dans l'entrée du jour (même entité
que le Journal du jour, pas un Inbox séparé).

## Flux de données (extraction)

```
JournalEditor (édition)
  → debounce (même fenêtre que l'auto-save)
  → apps/web/src/lib/ai/journal-extract.ts (nouveau, fin — orchestration
    uniquement, pas de logique d'extraction)
      → entities.list (candidats contacts/orgs)
      → @supernote/ai createActionExtractor().extractEntityMentions(...)
      → @supernote/ai createActionExtractor().extractActions(...)
  → état local JournalEditor (candidats en mémoire, jamais persistés avant
    accord)
  → UI : chip sous le paragraphe concerné
  → accept mention → réécriture markdown → indexMentions (existant)
  → accept action → entities.create typeId todo (existant)
  → reject → drop, pas de trace
```

Aucune migration de schéma : les candidats sont éphémères (état client), rien
n'est écrit tant que l'utilisateur n'a pas confirmé.

## Tests (e2e Playwright — politique zéro test unitaire)

- `/` affiche le Journal du jour (pas `WritingSurface`).
- Taper un texte mentionnant un contact existant → chip de suggestion
  apparaît ; accepter → lien `[[...]]` dans le texte + entité liée en base.
- Taper « je dois rappeler X » → chip action ; accepter → todo créé avec le
  bon texte.
- Rejeter une chip → aucune création, chip disparaît.
- Raccourci de capture rapide → texte apparaît dans l'entrée du jour courant.
- Mobile : bottom nav "Accueil" ouvre le Journal ; FAB écrit dans l'entrée du
  jour.
- Caveat : ces tests dépendent d'Ollama disponible en environnement CI pour
  l'extraction LLM — prévoir soit un Ollama de test, soit valider uniquement
  le chemin heuristique (repli regex) en CI et traiter le chemin Ollama comme
  vérification manuelle.

## Ce qui a changé depuis le cadrage verbal initial

- L'extraction n'est pas à construire : `@supernote/ai`
  (`createActionExtractor`) fait déjà tout le gros du travail (Ollama + repli
  heuristique), utilisé aujourd'hui pour le mail uniquement. Le travail réel
  est du branchage + UI de suggestion, pas un moteur d'IA.
- Scope resserré en conséquence : liaison vers entités existantes uniquement
  (pas de proposition de nouvelle entité — limite actuelle de l'extracteur).
- Ajouté « pour presque rien » : extraction d'actions/todos (`extractActions`),
  même mécanique de chip, même extracteur déjà branché.

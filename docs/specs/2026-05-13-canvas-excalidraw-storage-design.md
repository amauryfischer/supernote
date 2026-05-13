# Stockage natif `.excalidraw` pour les canvas

**Date :** 2026-05-13
**Statut :** Design — en attente de plan d'implémentation
**Auteur :** Amaury Fischer

## Problème

Les canvas Supernote (autonomes et vues canvas de notes) sont stockés sous
forme de JSON sérialisé dans le frontmatter YAML d'un fichier `.md`. Cela
empêche tout outil externe — notamment `excalidraw.com` que l'utilisateur
souhaite pouvoir utiliser — de lire ou modifier le canvas. Le vault FSA
perd ainsi une partie de sa promesse d'« ouvrabilité externe ».

## Objectif

Faire que tout canvas créé dans Supernote soit aussi un fichier
`.excalidraw` standard, ouvrable et modifiable sur `excalidraw.com` (ou
toute autre app compatible). Les modifications externes doivent
re-rentrer dans Supernote sans perte d'information.

## Non-objectifs

- Suppression du format Obsidian `.canvas` ou compatibilité bidirectionnelle
  avec Obsidian Canvas (différent format JSON — laissé pour plus tard si
  besoin)
- Édition live multi-utilisateurs via le backend Excalidraw+
- Support du plugin Obsidian-Excalidraw (`.excalidraw.md`) — peut être
  ajouté ultérieurement comme variante de sérialisation

## Approche

### Format de fichier cible

Format natif Excalidraw, extension `.excalidraw` :

```json
{
  "type": "excalidraw",
  "version": 2,
  "source": "supernote",
  "elements": [/* ExcalidrawElement[] */],
  "appState": { "viewBackgroundColor": "#ffffff", "gridSize": null },
  "files": {}
}
```

C'est exactement ce qu'`excalidraw.com` accepte par drag-drop / Open file.

### Modèle de stockage dans le vault

| Type d'entité Supernote | Avant | Après |
|---|---|---|
| Canvas autonome | `Canvas/MonCanvas.md` (JSON dans `fields.data`) | `Canvas/MonCanvas.md` (metadata only) + `Canvas/MonCanvas.excalidraw` |
| Note avec vue canvas | `Inbox/note.md` (JSON dans `fields.canvas`) | `Inbox/note.md` (markdown body + metadata) + `Inbox/note.excalidraw` |
| Note sans vue canvas | `Inbox/note.md` | `Inbox/note.md` *(inchangé)* |

Le `.md` reste la **seule source de vérité pour les metadata Supernote**
(id, type, tags, fields custom). Il porte aussi le body markdown éditable
pour les notes. Le `.excalidraw` est généré côte à côte avec le même
basename. Le `.md` référence son `.excalidraw` frère via un champ
`canvasFile` en frontmatter :

```yaml
---
id: 01HX...
type: note
name: Réunion équipe
canvasFile: réunion-équipe.excalidraw
tags: [meeting]
---
# Markdown body…
```

### Conversion `CanvasDocument ↔ ExcalidrawFile`

Une nouvelle bibliothèque `packages/canvas/src/excalidraw/` expose :

```ts
function toExcalidraw(doc: CanvasDocument): ExcalidrawFile
function fromExcalidraw(file: ExcalidrawFile): CanvasDocument
```

**Round-trip des nodes typés Supernote** (text, file, link, group, crm,
query) : chaque node devient un couple `{ rectangle, text }` Excalidraw
groupés. Chaque élément porte un `customData` Excalidraw standard :

```ts
customData: {
  supernote: {
    nodeType: "crm",            // type Supernote original
    nodeId: "node-abc",          // id du node Supernote
    // payload-spécifique :
    entityId: "entity-1",        // pour crm
    query: "tag:projet",         // pour query
    file: "...", url: "...",     // pour file / link
  }
}
```

Excalidraw préserve `customData` à travers ses propres save/load — c'est
un champ documenté et stable. La reconversion (`fromExcalidraw`) lit ces
marqueurs et reconstruit les nodes typés Supernote ; les éléments sans
marqueur tombent dans `excalidrawElements` du CanvasDocument (calque libre).

**Edges** : convertis en `arrow` Excalidraw avec `customData.supernote.edgeId`
et binding `startBinding` / `endBinding` vers les éléments correspondants.

### Bug à corriger en passant

`packages/canvas/src/serializer/index.ts:210` — `serializeCanvas` n'écrit
pas les `excalidrawElements`. Le calque libre est perdu sur sauvegarde. À
fixer avant la migration sinon on migrerait des documents tronqués.

### Storage layer (vault-worker)

`apps/web/src/lib/vault-worker/worker-router.ts` :

- **Création / mise à jour** d'une entité ayant un champ `data` (canvas
  standalone) ou `canvas` (vue canvas d'une note) :
  1. Parser le JSON du champ en `CanvasDocument`
  2. Convertir en `ExcalidrawFile` via `toExcalidraw`
  3. Écrire le fichier `.excalidraw` côte à côte (même dossier, même basename)
  4. Stripper le JSON du frontmatter, écrire `canvasFile: <basename>.excalidraw`
  5. Persister normalement le `.md`

- **Lecture** d'une entité au boot / re-scan :
  1. Lire le `.md` + frontmatter
  2. Si `canvasFile` présent, lire le `.excalidraw` frère
  3. `fromExcalidraw` → reconstituer `CanvasDocument` → réinjecter dans
     `fields.data` / `fields.canvas` pour le code consommateur existant

L'API tRPC consommée par l'éditeur (`entities.get`, `entities.update`)
reste inchangée ; la transformation est interne au worker. Le code UI
n'a donc rien à savoir du split.

### Migration

Au démarrage du vault-worker, après l'indexation, parcourir les
`entity` rows ayant un `fields.data` ou `fields.canvas` JSON non vide
**sans** `canvasFile` correspondant :

1. Parser le JSON
2. Écrire le `.excalidraw` frère
3. Update du frontmatter `.md` : retirer `data` / `canvas`, ajouter
   `canvasFile`
4. Update de la row `entity` (fields blob)

Idempotente : si `canvasFile` existe déjà, skip. Sûre à rejouer.

### UI

- L'éditeur canvas (`apps/web/src/app/canvas/[id]/page.tsx`) reste
  inchangé — c'est juste un consommateur de l'API.
- Le bouton `Export PNG` non implémenté est remplacé par une mention
  discrète dans la toolbar : « Aussi disponible : `<basename>.excalidraw`
  dans votre vault » avec une icône qui copie le chemin / révèle dans
  l'OS file picker (si supporté).
- Aucun bouton « ouvrir dans excalidraw.com » n'est nécessaire : le
  fichier est déjà là, l'utilisateur l'ouvre lui-même via drag-drop.
  (On peut en ajouter un plus tard si l'UX le demande.)

## Composants

```
packages/canvas/src/excalidraw/
  index.ts                      # exports publics
  to-excalidraw.ts              # CanvasDocument → ExcalidrawFile
  from-excalidraw.ts            # ExcalidrawFile → CanvasDocument
  types.ts                      # ExcalidrawFile, ExcalidrawElement (subset)
  custom-data.ts                # schema customData.supernote + parsers
  __tests__/
    round-trip.test.ts          # propriété : fromExcalidraw(toExcalidraw(d)) === d
    excalidraw-fixtures.test.ts # parsing de fichiers .excalidraw réels
    supernote-fixtures.test.ts  # CanvasDocument réalistes

apps/web/src/lib/vault-worker/
  canvas-file-bridge.ts         # read/write d'un .excalidraw frère
  migration-canvas-excalidraw.ts # migration idempotente
  worker-router.ts              # hook dans entitiesCreate / entitiesUpdate / load
```

## Flux de données

```
[UI éditeur] --CanvasDocument--> [tRPC entities.update]
                                       |
                                       v
                              [vault-worker entitiesUpdate]
                                       |
                       +---------------+---------------+
                       v                               v
              [DB row entity.fields                [canvas-file-bridge]
               sans le JSON canvas]                 toExcalidraw()
                                                         |
                                                         v
                                          [FSA: <basename>.excalidraw]

[FSA: <basename>.excalidraw] --fromExcalidraw--> [CanvasDocument]
                                                       |
                                                       v
                                              [tRPC entities.get
                                               renvoie fields.data ou
                                               fields.canvas reconstitué]
```

## Cas d'erreur

| Cas | Comportement |
|---|---|
| `.excalidraw` frère absent alors que `canvasFile` est en frontmatter | Logger, retourner CanvasDocument vide, ne PAS supprimer la référence (l'utilisateur a peut-être déplacé/renommé le fichier — il pourra le recoller) |
| `.excalidraw` corrompu (JSON invalide) | Logger, retourner CanvasDocument vide, garder le fichier intact |
| Édition externe : l'utilisateur supprime tous nos `customData` | Round-trip dégrade gracieusement — les éléments deviennent du calque libre dans `excalidrawElements` ; aucune perte de dessin |
| Édition externe : l'utilisateur supprime des éléments groupés (rectangle d'un node CRM mais pas son texte) | Le node CRM est reconstruit avec ce qui reste ; si tout est supprimé, le node disparaît (cohérent avec « l'utilisateur a explicitement supprimé ») |
| Collision de basename lors de la création | Suffixe `-2`, `-3`… (même règle que la création de `.md` actuelle) appliquée aux DEUX fichiers en lockstep |
| Migration : `.excalidraw` existe déjà avec contenu différent | Skip migration pour cette entity, logger ; l'utilisateur résoudra manuellement |

## Tests

- **Unitaires** (`packages/canvas/src/excalidraw/__tests__/`) :
  round-trip de `CanvasDocument` arbitraires ; parsing de fichiers
  `.excalidraw` exportés par excalidraw.com (fixtures) ; conservation
  de `customData` sur round-trip Excalidraw→Excalidraw simulé.
- **Intégration vault-worker** : create canvas → vérifier deux fichiers
  écrits ; mutate → vérifier les deux mis à jour ; rename → lockstep.
- **Migration** : seed un vault avec ancien format → run migration →
  vérifier `.excalidraw` créés et frontmatter nettoyés ; rerunner →
  no-op.
- **E2E manuel** : créer un canvas dans Supernote, ouvrir le `.excalidraw`
  généré sur excalidraw.com, modifier, recharger dans Supernote, vérifier
  que les modifs sont visibles et que les nodes typés survivent.

## Risques

1. **Stabilité de `customData` Excalidraw** — c'est documenté mais on
   doit valider avec une fixture round-trip réelle (load on excalidraw.com,
   save, re-parse).
2. **Performance migration** sur un gros vault — la migration touche le
   FSA et la DB pour chaque canvas. Vérifier qu'elle ne bloque pas le
   boot ; possiblement déférer en background avec progress.
3. **Conflits de write** — si l'utilisateur édite le `.excalidraw`
   externement pendant que Supernote tourne, les changements seront
   écrasés au prochain save UI. Pas de mécanisme de merge prévu — c'est
   un usage « édition séquentielle » comme avec n'importe quel fichier
   du vault. À documenter clairement.

## Décisions

- **Format** : `.excalidraw` natif (pas `.canvas` Obsidian) — priorité
  à l'ouverture excalidraw.com qui est la demande explicite.
- **Source de vérité metadata** : reste le `.md` frontmatter. Le
  `.excalidraw` ne porte que les éléments visuels. Pas de duplication.
- **Stockage DB** : `fields.data` / `fields.canvas` continuent d'exister
  côté tRPC pour ne pas casser l'UI ; ils sont reconstitués à la lecture
  depuis le `.excalidraw`. La DB ne stocke plus le JSON canvas en
  permanence (réduit la taille du index, évite la dérive `.md`↔DB).
- **Migration** : one-shot au boot, idempotente, non destructive.

# Bases — Database type Notion/Coda/AppFlowy avec vues inline

**Date :** 2026-05-13
**Statut :** Phase 1 — Foundation (en cours d'implémentation)

## Contexte

Le système de **Schémas** (EntityType, Field, Entity, RelationType, RelationEdge) est déjà en place côté infrastructure :
- DDL SQLite complet (`entity_type`, `entity`, `relation_type`, `relation_edge`)
- 32 *FieldKind* supportés (text, longtext, number, currency, date, select, multiselect, relation, formula, rollup, lookup, status…)
- 14 *EntityType* seedés (personne, organisation, interaction, note, daily, tag, account, asset, loan, snapshot, goal, canvas, routine, todo)
- CRUD entities exposé via worker `entities.list/get/create/update/delete/search`

**Manquant :**
- Aucune UI pour manipuler les *rows* d'un EntityType (la grille tabulaire à la Notion / Coda n'existe pas)
- Aucune persistance de configurations de vue (filtres, tris, projection de colonnes, regroupements)
- Aucun moyen d'insérer une vue inline dans une note BlockNote

Les composants `packages/views/*` qui existaient (commit `60ee184`) ont été supprimés — le présent travail repart de zéro avec un modèle Coda explicite.

## Vocabulaire

| Terme UI | Terme technique | Description |
|----------|------------------|-------------|
| **Schéma** | `EntityType` | Définition du modèle (champs, validations, workflows) |
| **Base** | `EntityType` *vu côté utilisateur* | Une Base = un Schéma + son ensemble d'entries |
| **Entry / Ligne** | `Entity` | Une row dans la Base |
| **Vue** | `ViewDefinition` (nouveau) | Représentation filtrée / triée / projetée d'une Base |
| **Vue inline** | bloc BlockNote `databaseView` | Vue embarquée dans une note |
| **Vue nommée** | row `view` SQLite | Vue sauvegardée au niveau de la Base, réutilisable |

Une Base ≠ nouvelle entité technique : on continue d'utiliser l'`EntityType` existant. La nouveauté est la table `view` et la couche UI.

## Modèle de vue (inspiré Coda)

Une **Vue** est une projection paramétrée d'une Base. Plusieurs vues d'une même Base coexistent partout dans l'app (page Base dédiée, vues inline dans des notes, dashboards…). Les modifications sur les *entries* sont propagées : éditer une cellule dans une vue se reflète dans toutes les autres vues de la même Base.

```ts
interface ViewDefinition {
  id: string;
  typeId: string;          // FK → EntityType (la Base)
  name: string;
  icon?: string;
  kind: ViewKind;          // "table" | "board" | "gallery" | "calendar" | "list"
  filters: FilterClause[]; // AND par défaut
  sorts: SortClause[];     // multi-niveaux
  visibleFields: string[]; // fieldIds visibles (ordre = ordre d'affichage)
  hiddenFields: string[];  // explicitement masqués (le reste = visible si pas dans visibleFields)
  groupByField?: string;   // fieldId pour board/list groupés
  rowHeight: "short" | "normal" | "tall";
  isSystem: boolean;       // vue par défaut auto-créée (non supprimable)
}

interface FilterClause {
  fieldId: string;
  op: "eq" | "neq" | "contains" | "starts_with" | "gt" | "lt" | "gte" | "lte" | "is_empty" | "is_not_empty" | "in" | "not_in";
  value?: unknown;
}

interface SortClause {
  fieldId: string;
  direction: "asc" | "desc";
}
```

### Vues nommées vs vues inline

- **Vue nommée** : row dans la table `view`, accessible partout via son `id`. Au moins une vue par défaut (`isSystem: true`, `kind: "table"`) auto-créée à la première visite d'une Base.
- **Vue inline ad-hoc** : un bloc `databaseView` dans une note peut soit pointer une vue nommée (`viewId`), soit embarquer une `inlineView: ViewDefinition` complète dans ses props (sans row SQLite). C'est la sémantique Coda : on peut filtrer/trier/projeter localement sans polluer la liste de vues globales.

## Persistance

### Nouvelle table SQLite `view`

```sql
CREATE TABLE IF NOT EXISTS "view" (
    "id" TEXT PRIMARY KEY,
    "vaultId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'table',
    "filters" TEXT NOT NULL DEFAULT '[]',
    "sorts" TEXT NOT NULL DEFAULT '[]',
    "visibleFields" TEXT NOT NULL DEFAULT '[]',
    "hiddenFields" TEXT NOT NULL DEFAULT '[]',
    "groupByField" TEXT,
    "rowHeight" TEXT NOT NULL DEFAULT 'normal',
    "isSystem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT NOT NULL,
    "updatedAt" TEXT NOT NULL,
    FOREIGN KEY ("vaultId") REFERENCES "vault" ("id") ON DELETE CASCADE,
    FOREIGN KEY ("typeId") REFERENCES "entity_type" ("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "view_typeId_idx" ON "view"("typeId");
```

### Bloc BlockNote `databaseView`

Stockage dans le markdown de la note via une frontmatter-like embedding BlockNote (cf. blocks `callout`, `embed`). Schéma de props :

```ts
{
  baseId: string;        // entityTypeId
  viewId?: string;       // ref à une vue nommée
  inlineView?: ViewDefinition;  // vue ad-hoc locale (sans persistance globale)
}
```

Si `viewId` est défini, on hydrate depuis la table `view`. Sinon, `inlineView` contient la config. Un bouton « Convertir en vue nommée » permet de promouvoir une vue inline.

## Contrats IPC (tRPC)

### Nouveau router `views`

- `views.list({ typeId? })` → `ViewDefinition[]`
- `views.get({ id })` → `ViewDefinition`
- `views.create(viewInput)` → `ViewDefinition`
- `views.update(viewInput)` → `ViewDefinition`
- `views.delete({ id })` → `{ id, deleted }`
- `views.ensureDefault({ typeId })` → `ViewDefinition` (idempotent ; crée la vue système si absente)

### Extension `entities`

- `entities.queryForView({ typeId, filters, sorts, limit?, offset? })` → `{ items: Entity[], total }`
  - Source de vérité unique : on récupère toutes les entities du typeId, on filtre/trie côté worker en JS (les fields étant en JSON, on ne peut pas pousser facilement les filtres en SQL pour tous les FieldKinds — on commencera en mémoire, optimisable plus tard).

## Composants UI

### `<DataGrid>` (apps/web/src/components/bases/DataGrid.tsx)

Grille type Notion / Coda :
- Header de colonnes : nom + icône kind, menu (trier, masquer, renommer, supprimer)
- Cellules éditables inline (double-clic ou Enter)
- Ligne « + Add row » en bas
- Bouton « + Add column » en fin de header
- Row height variable
- Pas de virtualisation phase 1 (jusqu'à ~500 rows ça passe)

### `<CellRenderer>` / `<CellEditor>`

Switch sur `field.kind`. Phase 1 couvre :
`text`, `longtext`, `number`, `currency`, `percent`, `rating`, `bool`, `date`, `datetime`, `url`, `email`, `phone`, `select`, `multiselect`, `status`, `createdAt`, `updatedAt`.

Reportés phase 2 : `relation` (a besoin d'un picker entity), `formula`, `rollup`, `lookup`, `file`, `image`.

### `<ViewTabs>` / `<ViewSwitcher>`

Tabs en haut de la page Base pour switcher entre les vues nommées, + bouton « + Nouvelle vue » et menu « Configurer la vue actuelle » (renommer, supprimer, dupliquer, changer kind).

### `<FilterMenu>` / `<SortMenu>`

Phase 1 : UI affichée mais boutons « Ajouter un filtre / un tri » sont stubés (le worker accepte déjà la query). Implémentation interactive en phase 2.

## Page standalone `/bases/:typeId`

Layout :
- Header : icône + nom (pluriel) du Schéma, bouton « + Nouvelle entry »
- Sous-header : `<ViewTabs>` + outils (filter, sort, hide, group, row-height)
- Body : composant de vue polymorphe (`<DataGrid>` pour `kind: "table"` ; placeholders pour autres kinds)

Route ajoutée dans `apps/web/src/router.tsx` :
```ts
{ path: "bases/:typeId", lazy: lazyPage(() => import("./app/bases/[typeId]/page")) }
```

Sidebar : entrée « Bases » qui pointe vers `/schemas` (qui devient le hub où on choisit une Base à explorer). Garder `/schemas/*` pour la définition technique du schéma.

## Bloc BlockNote `databaseView`

Custom block React (cf. patterns `callout`, `embed` dans `packages/editor/src/blocks/`) :
- Props : `{ baseId, viewId?, inlineView? }`
- État initial vide : le bloc affiche un picker « Sélectionner une Base » puis « Sélectionner une vue ou créer une vue inline »
- Une fois configuré : embed `<DataGrid>` directement
- Slash menu : `/base` → insère un bloc vide

Sérialisation markdown : block sérialise vers `<!-- databaseView baseId="X" viewId="Y" -->` (round-trip via les blocks BlockNote custom).

## Phasage

### Phase 1 (cette session) — Foundation
- DDL `view`, types core, IPC contracts, worker handlers
- DataGrid lecture + édition de cellules (kinds simples)
- Page `/bases/:typeId` avec vue par défaut auto
- Bloc inline `databaseView` minimal (référence vue nommée uniquement, pas encore d'éditeur inline-view)
- Slash menu `/base`

### Phase 2 — Interactivité vues
- FilterMenu / SortMenu interactifs (multi-clauses)
- Hide/Show fields drag-and-drop
- Vues multiples nommées + duplication
- Vues inline ad-hoc avec promotion → vue nommée

### Phase 3 — View kinds supplémentaires
- KanbanView (board) avec groupBy
- GalleryView (cards)
- CalendarView (date field)
- ListView (groupé)

### Phase 4 — Champs avancés
- RelationField inline picker
- Formula / Rollup / Lookup runtime
- File / Image cells

### Phase 5 — Performance
- Virtualisation lignes (>500)
- Indexation partielle SQL pour filtres simples
- Memoization rendering cellules

## Limites assumées Phase 1

- Pas de tri/filtre interactif (le worker accepte les paramètres mais l'UI ne les édite pas encore)
- Pas de virtualisation : performances dégradées au-delà de ~1k rows
- Pas d'undo/redo sur les éditions de cellules
- Pas de sélection multi-rows
- Bloc inline : pas encore d'éditeur de vue inline locale (juste référence à une vue nommée)
- `relation`, `formula`, `rollup`, `lookup`, `file`, `image` non éditables (rendus en lecture seule)

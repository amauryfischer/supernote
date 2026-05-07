# Canvas et Knowledge Graph

## Canvas

Le canvas est une surface spatiale infinie où tu peux poser des notes, des entités, des dessins et les relier visuellement.

```
[screenshot: canvas avec entités reliées, dessins Excalidraw, et flèches typées]
```

### Deux couches superposées

Le canvas Supernote combine deux librairies :

**Couche 1 — Excalidraw (dessin libre)**
- Formes géométriques, textes, flèches, sticky notes
- Dessin à main levée (freehand)
- Export SVG/PNG

**Couche 2 — React Flow (nodes typés)**
Par-dessus Excalidraw, une couche de nodes structurés :

| Type de node | Description |
|---|---|
| `EntityCard` | Carte compacte d'une entité (Personne, Projet, Note…) |
| `NoteEmbed` | Contenu complet d'une note |
| `QueryNode` | Résultat live d'une requête |
| `TextNode` | Texte libre formaté |
| `MediaNode` | Image, vidéo |
| `IframeNode` | Contenu web embarqué |

---

### Créer un canvas

- Sidebar > "Nouveau canvas" ou `/canvas` dans une note
- Un fichier `.canvas` est créé dans le vault (format JSON compatible Obsidian)

### Ajouter des éléments

| Action | Comment |
|---|---|
| Ajouter une EntityCard | Glisser depuis la sidebar, ou `+` > "Entité" |
| Ajouter une note | Glisser depuis la sidebar, ou double-clic sur la surface |
| Dessiner | Activer le mode Excalidraw (bouton crayon) |
| Ajouter un Query node | `+` > "Query" |

### Relier des entités

Relie deux EntityCards avec une flèche → une modale s'ouvre pour choisir le **type de relation** entre ces deux types d'entités. Confirme → un `RelationEdge` est créé et persisté dans les frontmatters des deux entités.

C'est la façon la plus visuelle de construire le graphe de ton CRM ou de ta connaissance.

---

### Formats et compatibilité

Les fichiers `.canvas` sont compatibles avec **Obsidian**. Les nodes Supernote spécifiques (`sn-entity`, `sn-query`, `sn-formula`) sont ignorés gracieusement par Obsidian. Les nodes standard (`file`, `text`, `link`, `group`) fonctionnent dans les deux sens.

Quand Obsidian ouvre un canvas Supernote :
- Les notes/liens s'affichent normalement
- Les EntityCards et QueryNodes sont ignorés (pas d'erreur)

Quand Supernote ouvre un canvas Obsidian :
- Tout s'affiche normalement
- Les nodes Supernote ajoutent leurs fonctionnalités spécifiques

---

### Fonctionnalités canvas

| Fonctionnalité | Description |
|---|---|
| Frames | Groupes visuels nommés |
| Layout auto | Dagre (hiérarchique) ou Force-directed |
| Mini-map | Navigation dans les grands canvas |
| Mode présentation | Défile entre les frames comme des slides |
| Zoom | Molette + `Cmd+0` pour recentrer |
| Multi-sélection | `Shift+clic` ou rectangle de sélection |

---

## Knowledge Graph

Le Knowledge Graph est une visualisation force-directed de toutes les connexions entre entités dans ton vault.

```
[screenshot: knowledge graph avec clusters de notes et contacts reliés]
```

### Accéder au graph

Sidebar > "Graph" ou `Cmd+G`.

### Ce que le graph montre

- Chaque entité = un noeud (couleur par type)
- Chaque wikilink / mention / relation = une arête
- Les clusters révèlent les zones de ta connaissance
- La taille des noeuds reflète le nombre de connexions (backlinks)

### Interactions

| Action | Résultat |
|---|---|
| Clic sur un noeud | Ouvre l'entité |
| Survol | Affiche le nom et les connexions directes |
| Drag | Repositionne le noeud (temporaire) |
| Scroll | Zoom in/out |
| `Cmd+F` dans le graph | Recherche et surligne un noeud |

### Filtres du graph

Le panneau de droite permet de filtrer :
- Par type d'entité
- Par tag
- Par profondeur de connexion (1, 2, 3 sauts)
- Masquer les noeuds orphelins (sans connexion)

### Performance

Pour les grands vaults (>5000 entités), Supernote bascule automatiquement vers un rendu WebGL via `react-force-graph-2d`. Les animations restent fluides.

---

## Canvas inline dans les notes

Dans n'importe quelle note, tape `/canvas` pour insérer un canvas inline — une surface de dessin miniature directement dans le corps de ta note. Double-clique dessus pour l'ouvrir en plein écran.

Utile pour : croquis de conception, diagramme de décision, mind map rapide.

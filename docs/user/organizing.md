# Organiser ses notes et entités

## Dossiers

Le vault est un dossier ordinaire sur ton disque. Supernote respecte l'arborescence de fichiers et la reflète dans la sidebar.

Tu peux créer des sous-dossiers librement :

```
Notes/
├── Lectures/
│   ├── 2026/
│   └── Non lus/
├── Idées/
└── Archives/
```

Quelques règles :
- Les dossiers préfixés `.` sont cachés dans la sidebar (sauf `.supernote/` qui est toujours accessible via Settings)
- Le dossier `_assets/` est géré par Supernote (ne pas renommer)
- Le dossier `Daily/` a un comportement spécial : Supernote y crée une note par jour à l'ouverture

### Déplacer des entités

Glisser-déposer dans la sidebar, ou clic droit > "Déplacer". Supernote met à jour tous les wikilinks qui pointaient vers l'entité.

---

## Tags

Les tags sont **hiérarchiques**. Le séparateur est `/` :

```
#client
#client/actif
#client/prospect
#projet/2026/Q2
```

Tags dans le frontmatter :
```yaml
tags: [client/actif, "projet/2026/Q2", perso]
```

Tags dans le corps :
```
Cette note concerne un #client/actif important.
```

### Parcourir par tags

La sidebar a une section "Tags" qui affiche l'arbre hiérarchique. Cliquer sur un tag ouvre une vue filtrée sur toutes les entités qui le portent.

### Créer un tag avec description

Dans Settings > Tags, tu peux ajouter une description à chaque tag. L'IA utilise ces descriptions pour décider quels tags suggérer automatiquement.

---

## Vues

Une **vue** est une requête sauvegardée avec un mode d'affichage. Elle s'ouvre en un clic depuis la sidebar.

### Types de vues

| Vue | Idéal pour |
|---|---|
| Table | Comparaison, édition inline de nombreuses entités |
| Kanban | Workflow par statut ou par catégorie |
| Galerie | Entités avec images (contacts, projets) |
| Calendrier | Entités avec champ date |
| Timeline/Gantt | Projets avec dates de début et fin |
| Graph | Explorer les connexions entre entités |
| Map | Entités avec champs géographiques |
| Dashboard | Combinaison de widgets (metrics, charts, lists) |

### Créer une vue

1. Depuis n'importe quelle liste d'entités, clique sur "Sauvegarder la vue" (icône disquette en haut)
2. Donne-lui un nom — elle apparaît dans la sidebar sous "Vues"
3. Les vues sont stockées dans `.supernote/views/` (fichiers JSON)

### Filtres et tris

Dans n'importe quelle vue, clique sur "Filtrer" pour ajouter des conditions :

```
type = Interaction
  AND participants inclut @Jean Dupont
  AND date > il y a 30 jours
```

Les opérateurs disponibles dépendent du type de champ : `=`, `!=`, `>`, `<`, `contient`, `est vide`, `est dans`, etc.

---

## Recherche

### Quick switcher (`Cmd+K`)

Ouvre une palette de commandes : tape n'importe quoi pour trouver des notes, des entités, des vues, des commandes.

```
[screenshot: quick switcher avec résultats mélangés notes + contacts + actions]
```

### Recherche avancée (`Cmd+Shift+F`)

Supporte des opérateurs de recherche :

| Opérateur | Exemple | Description |
|---|---|---|
| `type:` | `type:Personne` | Filtre par type d'entité |
| `tag:` | `tag:client/actif` | Filtre par tag |
| `field:` | `field:email:jean@` | Filtre sur un champ |
| `path:` | `path:Contacts/` | Filtre par chemin de fichier |
| `created:` | `created:>2026-01-01` | Par date de création |
| `modified:` | `modified:<7d` | Modifié il y a moins de N jours |
| `relation:` | `relation:employe-par:Acme` | Via relation typée |
| `in:` | `in:Projets/Alpha` | Dans un dossier donné |

Recherche sémantique : cocher "Recherche intelligente" pour inclure des résultats conceptuellement proches même sans correspondance exacte.

---

## Schémas et types d'entités

### Voir et modifier les schémas

Ouvre "Schémas" depuis la sidebar ou `Cmd+,` > Schémas. Tu peux :

- Créer un nouveau type d'entité avec ses champs
- Modifier les champs existants (drag-drop pour réordonner)
- Définir les états de workflow (draft / actif / archivé…)
- Configurer les validations par champ

### Types seed inclus

| Type | Chemin par défaut | Usage |
|---|---|---|
| Note | `Notes/` | Prise de notes libre |
| Daily | `Daily/YYYY/MM-DD.md` | Journal quotidien |
| Personne | `Contacts/` | Fiche CRM contact |
| Organisation | `Organisations/` | Fiche CRM société |
| Projet | `Projets/` | Projet avec workflow |
| Interaction | `Interactions/` | Log de réunion/appel/email |
| Account | `Finance/Comptes/` | Compte bancaire |
| Asset | `Finance/Actifs/` | Actif patrimonial |
| Loan | `Finance/Prets/` | Prêt |
| Snapshot | `Finance/Snapshots/` | Bilan patrimonial |
| Goal | `Finance/Objectifs/` | Objectif financier |

Tous ces types sont modifiables. Tu peux ajouter des champs, changer les icônes, créer tes propres types.

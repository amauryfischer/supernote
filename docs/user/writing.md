# Ecrire dans Supernote

Supernote utilise **BlockNote** (basé sur ProseMirror/Tiptap) — un éditeur par blocs enrichi d'extensions custom. Chaque paragraphe, titre, image ou tableau est un bloc indépendant qu'on peut déplacer, transformer et référencer.

---

## Les blocs disponibles

### Blocs standard
| Bloc | Raccourci ou slash |
|---|---|
| Texte | (défaut) |
| Titre 1 / 2 / 3 | `# ` / `## ` / `### ` en début de ligne |
| Liste à puces | `- ` ou `/list` |
| Liste numérotée | `1. ` ou `/ordered` |
| Checklist | `[ ] ` ou `/todo` |
| Toggle / accordéon | `/toggle` |
| Citation | `> ` ou `/quote` |
| Séparateur | `/divider` |
| Code | ` ``` ` ou `/code` |
| Tableau markdown | `/table` |

### Blocs media
| Bloc | Raccourci |
|---|---|
| Image | `/image` ou glisser-déposer |
| Audio / note vocale | `/audio` ou glisser-déposer |
| Vidéo | `/video` |
| Fichier | `/file` |

Images et fichiers sont copiés dans `_assets/` du vault.

### Blocs avancés
| Bloc | Description | Raccourci |
|---|---|---|
| Callout | Encadré coloré (info / warning / danger / quote) | `/callout` |
| Mermaid | Diagramme texte (flowchart, sequence, gantt…) | `/mermaid` |
| KaTeX | Formule mathématique LaTeX | `/math` |
| Excalidraw inline | Dessin libre rapide | `/draw` |
| Canvas inline | Point d'entrée vers un canvas complet | `/canvas` |
| Entity card | Carte compacte d'une entité | `/entity` |
| Query block | Résultat live d'une requête (table, kanban…) | `/query` |
| Formula block | Calcul live Coda-like | `/formula` |
| Button block | Bouton qui déclenche une automation | `/button` |
| Synced block | Bloc partagé entre plusieurs notes | `/synced` |

---

## Le slash menu `/`

Tape `/` n'importe où dans une note pour ouvrir la palette de blocs. Tape quelques lettres pour filtrer. Les blocs récemment utilisés apparaissent en premier.

```
[screenshot: slash menu avec blocs listés et champ de recherche]
```

---

## Wikilinks et mentions

### Lier une note ou entité
```
[[Nom de la note]]
[[Jean Dupont]]          → lien vers la personne Jean Dupont
[[Jean Dupont|Jean]]     → affichage personnalisé
```

L'autocomplétion s'ouvre dès que tu tapes `[[`. Elle cherche dans toutes tes notes et entités.

### Mentions `@personne`
```
@Jean     → autocomplète sur les Personnes du CRM
```
Une mention crée un lien bidirectionnel et apparaît dans la timeline de Jean.

### Tags `#topic`
```
#client/important    → tag hiérarchique
#2026
```

### Transclusion (embed)
```
![[Note existante]]    → affiche le contenu complet de la note
![[Jean Dupont]]       → affiche la carte compacte de Jean
```

---

## Query block

Un Query block affiche les résultats d'une requête sur tes entités, en direct. Exemple :

```
/query
type: Interaction
filter: participants = @Jean AND date > 2026-01-01
sort: date desc
view: table
columns: [date, kind, summary]
```

Le résultat se met à jour chaque fois que les données changent.

---

## Formula block

Calcule des valeurs depuis tes entités :

```
/formula
SUM(filter(Account, currency = "EUR").current_balance)
```

Affiche le total de tes comptes en euros, mis à jour en temps réel.

---

## Raccourcis de l'éditeur

| Action | macOS | Win/Linux |
|---|---|---|
| Gras | `Cmd+B` | `Ctrl+B` |
| Italique | `Cmd+I` | `Ctrl+I` |
| Souligné | `Cmd+U` | `Ctrl+U` |
| Barré | `Cmd+Shift+S` | `Ctrl+Shift+S` |
| Code inline | `Cmd+E` | `Ctrl+E` |
| Lien | `Cmd+K` | `Ctrl+K` |
| Annuler | `Cmd+Z` | `Ctrl+Z` |
| Rétablir | `Cmd+Shift+Z` | `Ctrl+Shift+Z` |
| Nouveau bloc | `Enter` | `Enter` |
| Supprimer bloc vide | `Backspace` | `Backspace` |
| Déplacer bloc haut | `Cmd+Shift+↑` | `Ctrl+Shift+↑` |
| Déplacer bloc bas | `Cmd+Shift+↓` | `Ctrl+Shift+↓` |
| Sélectionner le bloc | Clic sur la poignée | Clic sur la poignée |
| Transformer le bloc | Clic droit > Transformer | Clic droit > Transformer |

Pour la liste complète : [Raccourcis clavier](keyboard-shortcuts.md).

---

## Drag and drop

Chaque bloc a une **poignée** (6 points) qui apparaît au survol à gauche. Glisse-la pour :

- Réordonner les blocs dans la note
- **Déplacer un bloc vers une autre note** (glisser vers l'onglet de la note cible)

---

## Sauvegarde et sync

- Sauvegarde automatique au fil de la frappe (debounce 500ms)
- Les fichiers `.md` sont écrits de façon atomique (écriture dans un temp file, rename)
- Chaque sauvegarde déclenche une reindexation incrémentale en arrière-plan
- Un commit git est créé automatiquement toutes les 5 minutes si le vault a changé

### Édition externe (VS Code, Obsidian)

Si tu modifies un fichier depuis un éditeur externe pendant que Supernote tourne, le watcher détecte le changement et reindex le fichier automatiquement. Si le fichier est ouvert dans Supernote au moment de la modification, une bannière s'affiche pour comparer et réconcilier.

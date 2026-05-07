# Import et Export

## Importer depuis Notion

Exporte ton espace Notion en ZIP (Settings Notion > Export > "Markdown & CSV"), puis dans Supernote :

1. `Cmd+K` > "Importer" > "Depuis Notion"
2. Sélectionne le fichier ZIP
3. Supernote parse les pages Markdown, les databases CSV, et les propriétés

Ce qui est importé :
- Pages et sous-pages → Notes
- Databases → EntityTypes (Supernote crée un type par database avec les colonnes comme champs)
- Propriétés : text, number, select, multi-select, date, url, email, checkbox, relation
- Images et fichiers joints (copiés dans `_assets/`)
- Tags de Notion → tags Supernote

Ce qui n'est pas importé :
- Commentaires
- Historique de versions
- Permissions

---

## Importer depuis Obsidian

Ouvre directement ton vault Obsidian dans Supernote :

1. Settings > Vaults > "Ajouter un vault"
2. Sélectionne le dossier de ton vault Obsidian
3. Supernote indexe les fichiers `.md` et `.canvas` existants

Supernote lit nativement :
- Frontmatter YAML
- Wikilinks `[[...]]`
- Tags `#tag`
- Fichiers `.canvas` (format Obsidian natif)
- Dossiers et structure

Les plugins Obsidian ne sont pas importés (système de plugins différent), mais le contenu des notes reste intact.

**Migration progressive** : tu peux utiliser les deux en même temps. Les fichiers sont partagés — Obsidian et Supernote lisent/écrivent les mêmes `.md`.

---

## Importer des contacts (vCard)

Importe des contacts depuis n'importe quel carnet d'adresses :

1. Exporte tes contacts en `.vcf` (vCard) depuis Contacts macOS, Google Contacts, Outlook, etc.
2. Dans Supernote : `Cmd+K` > "Importer" > "Contacts vCard"
3. Sélectionne le fichier `.vcf`

Champs importés : nom, prénoms, emails, téléphones, anniversaire, organisation, notes, photo.

Chaque contact devient une entité `Personne` dans `Contacts/`.

---

## Importer des données financières (OFX / CSV)

### OFX / QFX

Format standard des banques françaises et internationales (compatible Quicken, Bankin, etc.) :

1. Finance > Comptes > clic sur un compte > "Importer"
2. Sélectionne un fichier `.ofx` ou `.qfx`
3. Supernote met à jour le solde et peut créer des notes de transaction

### CSV bancaire

Si ta banque exporte en CSV :

1. Finance > Comptes > "Importer CSV"
2. Mappe les colonnes (date, montant, libellé, solde)
3. La configuration de mapping est sauvegardée par banque

---

## Exporter

### Exporter une note

Clic droit sur une note > "Exporter" :
- **Markdown** : fichier `.md` brut (c'est déjà le format natif)
- **PDF** : rendu haute fidélité via impression Chromium
- **HTML** : page web autonome avec styles inline

### Exporter une entité

Sur n'importe quelle fiche d'entité, menu `...` > "Exporter" :
- **JSON** : toutes les données structurées
- **Markdown** : frontmatter + corps
- **vCard** : pour les Personnes

### Exporter une vue

Depuis n'importe quelle vue (Table, Kanban…), clic "Exporter" :
- **CSV** : colonnes configurables
- **JSON** : données brutes avec relations
- **Markdown** : tableau markdown

### Exporter le vault entier

Settings > Vault > "Exporter" :
- **Zip du vault** : copie de tous les fichiers `.md`, `.canvas`, et `_assets/` (sans la DB SQLite ni le `.git/`)
- Utile pour archiver ou migrer vers un autre outil

---

## Importer un thème Obsidian

Settings > Apparence > "Importer un thème Obsidian" :
- Sélectionne le fichier `.css` d'un thème Obsidian
- Supernote applique les variables CSS compatibles (best-effort)
- Les variables non reconnues sont ignorées sans erreur

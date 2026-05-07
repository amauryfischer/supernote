# CRM — Contacts, Organisations, Projets, Interactions

Le CRM de Supernote n'est pas un module séparé — c'est le même système d'entités typées que partout ailleurs. Tes contacts sont des fichiers `.md` dans `Contacts/`, avec un frontmatter structuré, un corps markdown libre, et des relations vers d'autres entités.

---

## Les 4 types seed

### Personne

Fiche d'un individu dans ton réseau.

**Champs inclus :**

| Champ | Type | Description |
|---|---|---|
| `name` | texte (requis) | Nom complet |
| `photo` | image | Photo |
| `emails` | email[] | Un ou plusieurs emails |
| `phones` | phone[] | Un ou plusieurs téléphones |
| `birthday` | date | Anniversaire |
| `organization` | relation → Organisation | Employeur actuel |
| `role` | texte | Poste / rôle |
| `relationship_type` | select | ami / famille / collègue / client / prospect / fournisseur / autre |
| `linkedin` | url | Profil LinkedIn |
| `twitter` | url | Twitter/X |
| `github` | url | GitHub |
| `tags` | tags | Tags libres |

Corps markdown : notes libres, contexte, historique de la relation.

Exemple de fichier `Contacts/Jean Dupont.md` :

```yaml
---
id: 01HXAMPLE1234567
type: personne
fields:
  name: Jean Dupont
  emails: [jean@example.com]
  phones: ["+33 6 12 34 56 78"]
  birthday: 1985-03-12
  organization: "[[Acme Corp]]"
  role: Directeur commercial
  relationship_type: client
  linkedin: https://linkedin.com/in/jeandupont
tags: [client/actif, paris]
---

Jean gère les achats chez Acme. Très réactif par email, préfère les réunions courtes.
On s'est rencontrés à la conf Devoxx 2024.
```

---

### Organisation

Fiche d'une société, association ou institution.

**Champs inclus :**

| Champ | Type | Description |
|---|---|---|
| `name` | texte (requis) | Nom |
| `logo` | image | Logo |
| `website` | url | Site web |
| `industry` | select | Secteur |
| `address` | longtext | Adresse |
| `members` | relation → Personne (1↔n) | Membres / employés connus |

---

### Projet

Projet avec workflow d'états.

**Champs inclus :**

| Champ | Type | Description |
|---|---|---|
| `name` | texte (requis) | Nom |
| `status` | workflow | idea / active / blocked / done / archived |
| `description` | longtext | Description |
| `start_date` | date | Début |
| `due_date` | date | Échéance |
| `members` | relation → Personne (n↔n) | Participants |
| `organizations` | relation → Organisation (n↔n) | Orgs impliquées |

---

### Interaction

Log d'un échange avec une ou plusieurs personnes.

**Champs inclus :**

| Champ | Type | Description |
|---|---|---|
| `kind` | select (requis) | appel / réunion / email / café / visio / autre |
| `date` | datetime (requis) | Date et heure |
| `duration_minutes` | number | Durée en minutes |
| `participants` | relation → Personne (n↔n, requis) | Participants |
| `organization` | relation → Organisation | Société concernée |
| `project` | relation → Projet | Projet concerné |
| `location` | texte | Lieu |
| `summary` | longtext | Résumé |

Corps markdown : compte-rendu détaillé, prochaines étapes, etc.

---

## Créer un contact

**Via la sidebar :**
1. Clic droit sur "Contacts" > "Nouvelle Personne"
2. Remplis les champs dans le panneau de droite
3. Écris tes notes dans le corps

**Via une mention :**
Tape `@Jean` dans n'importe quelle note → si Jean n'existe pas, une option "Créer Jean Dupont" apparaît.

**Via import :**
Voir [Import / Export](import-export.md) pour importer des vCards, des exports LinkedIn, etc.

---

## Mentions et liaisons automatiques

Quand tu écris `@Jean Dupont` dans une note :

- Un lien bidirectionnel est créé entre la note et la fiche de Jean
- L'interaction apparaît dans la timeline de Jean (panneau "Backlinks" de sa fiche)
- L'IA peut aussi détecter "réunion avec Jean" dans le texte et proposer de créer une `@mention`

---

## Timeline d'un contact

Ouvre la fiche d'une Personne. Le panneau de droite > "Timeline" affiche :

- Toutes les **Interactions** qui l'incluent comme participant
- Toutes les **notes** qui le mentionnent (`@Jean` ou `[[Jean Dupont]]`)
- Dans l'ordre chronologique inverse

```
[screenshot: fiche Personne avec timeline à droite — interactions et mentions]
```

---

## Vue "À relancer"

La routine seed "Suivi à relancer" génère une vue des contacts sans interaction depuis plus de X jours. Pour configurer :

1. Ouvre "Routines" dans la sidebar
2. Clique sur "Suivi à relancer"
3. Règle le délai (défaut : 30 jours) et le filtre (ex : `relationship_type = client`)

---

## Relations typées

Tu peux créer tes propres types de relations entre entités. Exemple :

- `mentor` / `mentoré par` entre deux Personnes
- `investisseur dans` / `investisseur` entre Personne et Organisation
- `sponsor` / `sponsorisé par` entre Organisation et Projet

Pour créer un type de relation : Settings > Schémas > Relations > "Nouvelle relation".

Chaque relation peut aussi porter des champs (ex : la relation `travaille chez` peut avoir un champ `depuis` de type date).

---

## Vues CRM incluses

| Vue | Description |
|---|---|
| Contacts — Table | Tous tes contacts, colonnes configurables |
| Contacts — Galerie | Grandes cartes avec photo |
| Organisations | Table avec membres |
| Projets — Kanban | Projets par statut |
| Interactions — Calendrier | Interactions sur calendrier |
| À relancer | Contacts sans interaction récente |
| Réseau — Graph | Graphe de relations entre personnes et orgs |

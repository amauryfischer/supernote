# Surcouche mail Supernote — design

Date : 2026-06-25
Statut : design validé, prêt pour plan d'implémentation

## Contexte & objectif

L'intégration Gmail (P1-P4) expose un flux brut : `/mail` liste des threads à plat
(expéditeur/sujet/date). On veut une **surcouche propre à Supernote** par-dessus
ce flux : une transformation côté app qui **regroupe** les emails et offre une
navigation en **3 volets** (miller columns). C'est le 1ᵉʳ effet d'une couche
extensible (config future : quels labels/expéditeurs grouper).

## Décisions (validées)

- **Précédence** : label d'abord. Un email portant un label user groupé va dans
  le groupe-label ; sinon groupe-expéditeur ; sinon ligne seule.
- **Déclencheur** : automatique — tout label user OU expéditeur ayant **≥2**
  emails dans la vue est groupé. Pas d'UI de config en v1.
- **Clé contact** : **expéditeur** (`from.email`) pour l'inbox reçue.

## Architecture

Séparation nette :
- `lib/gmail.ts` fournit les données brutes à plat (+ labels).
- `lib/mail-overlay.ts` **(nouveau, pur)** = la surcouche : `buildMailOverlay`.
- L'UI 3-volets consomme le résultat.

La surcouche est une **fonction pure** → testable et extensible : v1 prend la
liste + les labels user ; une config persistée (règles) pourra la paramétrer plus
tard sans toucher l'UI.

## Données (lib/gmail.ts)

- `ThreadListItem` gagne `labelIds: string[]` (union des labelIds des messages du
  thread, déjà présents en réponse `format=metadata`).
- Nouveau `listLabels(clientId)` → `GET /labels`, filtre `type === "user"` →
  `{ id, name }[]` (labels système INBOX/UNREAD/CATEGORY_*/… exclus).

## Surcouche (lib/mail-overlay.ts, pur)

```ts
type OverlayRow =
  | { kind: "single"; item: ThreadListItem }
  | { kind: "group"; groupType: "label" | "sender"; key: string; title: string;
      count: number; items: ThreadListItem[]; date: string };

function buildMailOverlay(
  items: ThreadListItem[],
  userLabels: Map<string, string>, // labelId → name
): OverlayRow[];
```

Algorithme :
1. **Groupes-label** : pour chaque label user présent sur ≥2 items, créer un
   groupe. Un item multi-label rejoint le **plus gros** groupe-label (tie-break
   déterministe : taille puis nom). Items consommés.
2. **Groupes-expéditeur** : sur les items restants, chaque `from.email` avec ≥2
   items → un groupe-sender (title = nom court de l'expéditeur).
3. **Lignes seules** : le reste.
4. **Tri** : par date la plus récente (date d'un groupe = son item le plus récent).
   `count` = nb d'items ; `date` = max des dates.

Pure : pas de fetch, déterministe (pas de `Date.now`/random).

## Composition de ligne

```
[badge N] Titre                                   <date courte>
Objet (de l'item le plus récent)
```
- **Groupe-label** : Titre = nom du label (+ icône tag), badge = count.
- **Groupe-sender** : Titre = nom court de l'expéditeur, badge = count.
- **Single** : Titre = nom court de l'expéditeur, pas de badge.
- Ligne 2 = objet de l'item le plus récent ; date = la plus récente, alignée fin.

## Navigation 3 volets (miller)

- **Volet 1** : `MailOverlayList` (groupes + singles).
- Clic **single** → ouvre directement le **contenu** (volet 3) ; volet 2 masqué.
- Clic **groupe** → **volet 2** = `MailGroupList` (les X items, lignes
  émetteur/objet/date) → clic item → **volet 3**.
- **Volet 3** : `EmailThreadView` (existant) sur le thread sélectionné.
- **Desktop** : colonnes côte à côte, apparaissant au fur et à mesure du drill.
- **Mobile (<768px)** : un volet à la fois + bouton retour (drill).

État : `{ selectedGroupKey?: string; selectedThreadId?: string }`. Single →
selectedThreadId (pas de group). Groupe → selectedGroupKey ; item → +selectedThreadId.

## Gestion d'erreurs

- `listLabels` échoue → on continue **sans** groupes-label (groupes-sender +
  singles seulement) ; pas de blocage.
- `getThread` (volet 3) échoue → message d'erreur in-volet (calque existant).
- Token expiré → erreurs remontées comme dans `EmailPicker` (toast/lien settings).

## Tests (vitest)

- `buildMailOverlay` : précédence label>sender, seuil ≥2, multi-label tie-break,
  singles, tri par date, count/date d'un groupe, liste vide, labels absents.
- `listLabels` : filtre type user (fetch mocké).
- `ThreadListItem.labelIds` : union des labelIds (fetch mocké).
- UI : pas de test unitaire (pages non testées dans le repo) ; vérif typecheck + manuel.

## Hors périmètre (YAGNI)

- UI de config de la surcouche (auto en v1 ; point d'extension prévu).
- Groupes par destinataire (To) / vue « envoyés ».
- Actions de masse sur un groupe (archiver tout, etc.).
- Tri/filtre custom au-delà de la date.
- Pagination au-delà du `maxResults` de la recherche.

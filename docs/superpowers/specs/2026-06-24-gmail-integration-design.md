# Intégration Gmail — design

Date : 2026-06-24
Statut : design validé, prêt pour plans d'implémentation (un par phase)

## Contexte & objectif

L'app possède déjà une intégration Google complète (Drive + Docs/Sheets/Slides)
entièrement **client-side** : OAuth via Google Identity Services (GIS), token en
mémoire (~1 h), appels REST fetch directs (CORS), bloc embed BlockNote
(`googleSheet`) avec renderer délégué, et surfaces de création (FAB mobile,
menu dossier, EmptyEditor) gatées par l'état de connexion.

On veut une **intégration « mail » (Gmail)** qui décalque ces patterns, couvrant
quatre finalités :

1. **Lecture** — rechercher / consulter ses emails depuis l'app.
2. **Embed** — référencer un email dans une note (bloc, façon `googleSheet`).
3. **Compose** — créer un brouillon Gmail (« nouvel email » / « emailer cette note »).
4. **Capture** — transformer un email en entité (note ou ligne de base).

Provider = **Gmail uniquement** (l'app est déjà 100 % Google + client-side ;
IMAP/Outlook exigeraient un backend, hors périmètre — extension parallèle future).

## Contrainte structurante : scopes Gmail « restricted »

Différence fondamentale avec Drive. `drive.file` est un scope **non-sensible**
(zéro vérification Google). **Gmail n'a aucun scope étroit équivalent** : même
*lire* exige `gmail.readonly`, un scope **restricted**.

Décision retenue : **mode « testing »** (usage perso/interne).

- Pas d'audit CASA, pas de vérification Google.
- Contrepartie acceptée : bandeau « app non vérifiée » au consent + **tokens
  expirant après 7 jours** (re-login hebdomadaire pour les fonctions Gmail).
- Les utilisateurs Gmail doivent figurer dans la liste « test users » de l'écran
  de consentement OAuth du projet Google Cloud.

Scopes demandés :

| Scope | Usage | Type |
|---|---|---|
| `gmail.readonly` | Lecture, embed, capture | restricted |
| `gmail.compose` | Création de brouillons (P3) | restricted |

`gmail.send` (envoi direct) **écarté** : draft-first suffit, rien n'est envoyé
sans confirmation de l'utilisateur dans Gmail.

### Consentement incrémental (isolation du scope)

On **réutilise le Client ID Google existant** (`settings.googleDrive.clientId`),
mais on ne fusionne **pas** les scopes Gmail dans `OAUTH_SCOPE` : sinon tout
utilisateur Drive serait forcé au consentement Gmail. On demande les scopes
Gmail via un **token client séparé** (consentement incrémental GIS), avec une
connexion Gmail indépendante de la connexion Drive.

Prérequis projet Google Cloud (à documenter dans l'UI) : activer **Gmail API**
dans le même projet que Drive/Sheets, ajouter les scopes Gmail à l'écran de
consentement, déclarer les test users.

## Architecture — décalque des patterns Drive/Sheets

| Brique existante | Équivalent Gmail | Fichier cible |
|---|---|---|
| `lib/google-drive.ts` (GIS, token mémoire, fetch CORS) | `lib/gmail.ts` | `apps/web/src/lib/gmail.ts` |
| `searchFiles` / `fetchSheetData` | `searchThreads` / `getThread` / `getMessage` / `createDraft` | `lib/gmail.ts` |
| Bloc `googleSheet` + `GoogleSheetProvider` | Bloc `gmailMessage` + `GmailProvider` | `packages/editor/src/blocks/gmail.tsx` |
| `GoogleSheetView` (renderer hôte) | `GmailMessageView` + `EmailThreadView` | `apps/web/src/components/notes/` |
| `useCreateDriveDoc` → `createDriveFile` → `window.open` | `useCreateDraft` → `createDraft` → `window.open` | `apps/web/src/components/notes/hooks.ts` |
| `GoogleDriveTab` settings | section/onglet Gmail | `apps/web/src/components/settings/tabs/` |
| Gate `driveConnected` | gate `gmailConnected` | `notes/page.tsx`, surfaces |

### Refactor partagé (token par scope)

`requestAccessToken` dans `google-drive.ts` cache aujourd'hui **un** token. On le
généralise pour cacher **un token par ensemble de scopes** (clé = scope string),
afin que Drive et Gmail coexistent sans s'écraser. `lib/gmail.ts` réutilise ce
moteur via `requestAccessToken(clientId, { scope: GMAIL_SCOPE })`.

## Settings

Étendre les settings (localStorage via `SettingsContext`) :

```ts
interface GmailSettings {
  connectedEmail: string; // compte Gmail relié ; vide = déconnecté
  // clientId réutilisé depuis googleDrive.clientId
}
```

UI : section « Gmail » (nouvel onglet ou extension de l'onglet Google) avec
bouton **Connecter** (`requestAccessToken(clientId, { scope: GMAIL_SCOPE, prompt: "consent" })`
→ `getGmailProfile()` pour l'email), bouton **Déconnecter**, et un encart
explicatif sur le mode testing + le prérequis « activer Gmail API ». HeroUI v3.

## `lib/gmail.ts` — API client

Fonctions pures fetch (CORS direct sur `gmail.googleapis.com`, Bearer token) :

- `searchThreads(clientId, query, maxResults=20)` →
  `GET /gmail/v1/users/me/threads?q=<query>` → `{ id, snippet, historyId }[]`.
- `getThread(clientId, threadId)` → `GET .../threads/{id}?format=full` →
  thread + messages.
- `getMessage(clientId, messageId, format="full")` → message brut.
- `parseMessage(raw)` → `EmailMessage` normalisé (voir modèle ci-dessous) :
  extrait `subject`, `from`, `to`, `date`, `snippet`, et corps (préfère
  `text/html`, sinon `text/plain`, décodé base64url ; pièces jointes listées en
  métadonnées, non téléchargées en MVP).
- `createDraft(clientId, { to?, subject, body, bodyHtml? })` →
  construit un message RFC 822, encode base64url, `POST .../drafts` →
  `{ draftId, messageId }`.
- `getGmailProfile(clientId)` → `GET .../profile` → `emailAddress`.

Modèle normalisé :

```ts
interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: { name: string; email: string };
  to: { name: string; email: string }[];
  date: string;       // ISO
  snippet: string;
  bodyHtml?: string;  // sanitisé avant rendu
  bodyText?: string;
  webLink: string;    // https://mail.google.com/mail/u/0/#all/<messageId>
}
```

**Sécurité rendu** : tout `bodyHtml` Gmail est **sanitisé** (DOMPurify ou
équivalent déjà présent dans le repo ; sinon rendu `bodyText` only). Pas de
chargement d'images distantes par défaut (pixels traceurs) — option « afficher
les images » par message.

## Phase 1 — Lecture (socle)

Surface : route **`/mail`** décalquée sur la page notes.

- Barre de recherche (syntaxe Gmail : `from:`, `is:unread`, etc.) → `searchThreads`.
- Liste de threads (sujet, expéditeur, date, snippet) — HeroUI `Listbox`/`Card`.
- Panneau lecteur : `EmailThreadView` rend le thread sélectionné (messages
  empilés, corps sanitisé, « Ouvrir dans Gmail »).
- **Mobile** : liste plein écran → lecteur en navigation (drawer/overlay) ;
  `useMobileTitle("Mail")`, recherche dans le header mobile. Pas de débordement
  horizontal, hit-targets ≥32px.
- Composant réutilisable **`EmailPicker`** (recherche + sélection d'un email),
  réutilisé par P2 (embed) et P4 (capture).

Gate : surfaces masquées si `gmailConnected === false`
(`!!settings.gmail?.connectedEmail && !!settings.googleDrive?.clientId`).

## Phase 2 — Bloc embed email

Décalque exact de `googleSheet`.

- Bloc `gmailMessage` dans `@supernote/editor`, `propSchema { id, threadId, url }`.
- État vide : bouton « Choisir un email » → appelle `GmailProvider.pickEmail()`
  (callback hôte ouvrant `EmailPicker`) → renseigne les props. (Contrairement à
  Sheets, on ne colle pas d'URL : les URLs Gmail sont opaques → picker.)
- Rendu : délégué à `GmailProvider.renderGmailMessage(id)` côté hôte
  (`GmailMessageView`) → carte (sujet, from, date, snippet/corps tronqué, lien
  « Ouvrir dans Gmail »). **Fallback** (pas de provider / non connecté / mobile
  étroit) → carte minimale avec sujet + lien.
- Sérialisation markdown : `[gmail id="…" thread="…" url="…"]`
  (même mécanique que `databaseView`/`googleSheet`).
- Enregistrement : `packages/editor/src/blocks/index.ts`, case dans
  `serialization/serialize.ts`, entrée slash-menu.
- Câblage hôte : prop `renderGmailMessage` + `pickEmail` sur `SupernoteEditor`,
  branchées dans `NoteEditor` via `GmailProvider` (calque `GoogleSheetProvider`).

## Phase 3 — Compose (draft-first)

`useCreateDraft()` (calque `useCreateDriveDoc`).

Surfaces :

- **« Nouvel email »** : dans `NewItemSheet` (FAB mobile) + EmptyEditor / menu —
  gate `gmailConnected`. Demande destinataire/sujet (modal HeroUI) →
  `createDraft` → `window.open` du brouillon Gmail + toast.
- **« Emailer cette note »** : action dans le menu de note (desktop) +
  `MoreDrawer` (mobile). Sérialise la note (markdown → texte/HTML) en corps,
  titre → sujet → `createDraft` → ouvre Gmail.

Aucun envoi depuis l'app : l'utilisateur relit/envoie dans Gmail.

## Phase 4 — Capture email → entité

La plus lourde (touche le worker entités). Réutilise `EmailPicker`.

Cibles :

- **Email → note** : crée une entité note (markdown depuis `bodyText`/`bodyHtml`
  converti), titre = sujet, métadonnées (from/date) en frontmatter ou propriétés.
  Passe par le chemin de création de note existant (worker `entities`).
- **Email → ligne de base** : mappe les champs email (from, subject, date,
  snippet) vers une base/table existante. Mécanique worker calquée sur l'import
  Coda (champs keyés par `name`, pas de zod runtime — cf. `project_coda_import`),
  avec une UI de mapping de champs minimale.

Surface : action « Capturer depuis Gmail » → `EmailPicker` (multi-sélection) →
choix cible (nouvelle note vs base + mapping) → écriture worker.

Note : si l'implémentation s'avère trop large, P4 obtient son **propre sous-spec**
au moment de son plan.

## Flux de données (résumé)

```
Settings → Connecter Gmail
  → requestAccessToken(clientId, {scope: GMAIL_SCOPE, prompt:"consent"})  [GIS]
  → getGmailProfile() → settings.gmail.connectedEmail

/mail (P1)
  → searchThreads(q) → liste
  → getThread(id) → EmailThreadView (corps sanitisé)

Note + bloc gmailMessage (P2)
  → pickEmail() [EmailPicker] → props {id,thread,url}
  → renderGmailMessage(id) → getMessage → GmailMessageView (fallback carte+lien)
  → sérialisé [gmail id=… thread=… url=…]

Compose (P3)
  → useCreateDraft → createDraft → window.open(draft) + toast

Capture (P4)
  → EmailPicker → choix cible → worker entities.create (note | ligne base)
```

## Gestion d'erreurs

- Token expiré (7 j) → re-auth silencieuse ; si échec → toast « Reconnecter
  Gmail » pointant vers les settings.
- 401/403 API → carte/bandeau d'erreur + lien « Ouvrir dans Gmail » (fallback
  gracieux, jamais d'écran blanc — calque du fallback iframe Sheets).
- Quota Gmail API dépassé → message explicite + retry manuel.
- `bodyHtml` non sanitisable → repli sur `bodyText`.

## Tests (vitest)

- `lib/gmail.ts` : `parseMessage` (multipart, base64url, html vs text, headers
  manquants), construction RFC 822 de `createDraft` (encodage, en-têtes), parse
  des réponses `searchThreads`/`getThread` (fixtures Gmail API).
- Sérialisation bloc : round-trip `[gmail …]` ↔ block (calque tests googleSheet).
- Pas de tests réseau réels (fetch mocké).

## Hors périmètre (YAGNI)

- Envoi direct (`gmail.send`), labels/modify, archivage, suppression.
- Téléchargement de pièces jointes (métadonnées seulement en MVP).
- Multi-provider (Outlook/IMAP).
- Vérification Google / passage en production publique (décision séparée).
- Sync bidirectionnelle / miroir de boîte mail.

## Ordre de livraison

P1 (socle : OAuth scope + `lib/gmail.ts` + refactor token par scope + `/mail` +
`EmailPicker`) → P2 (embed) → P3 (compose) → P4 (capture). Chaque phase = son
propre plan d'implémentation (writing-plans), livrée et validée avant la suivante.

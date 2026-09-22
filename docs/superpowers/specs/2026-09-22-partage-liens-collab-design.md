# Partage par lien et co-édition temps réel — design

*2026-09-22*

## Objectif

Partager une **note** ou un **fil d'email** par un lien public :

- ouvert à tous, ou protégé par **mot de passe** ;
- **durée limitée** au choix (ou sans limite) ;
- en **lecture seule** ou **lecture + écriture** (notes seulement) ;
- note partagée **en direct** : les visiteurs voient les modifications et les curseurs des autres en temps réel, et un invité en écriture édite en même temps que le propriétaire.

Décisions de cadrage (validées) :

| Question | Décision |
|---|---|
| Un invité peut-il éditer quand le propriétaire n'a pas Supernote ouvert ? | **Oui.** Le serveur garde le document partagé ; les appareils du propriétaire récupèrent les modifications à la prochaine ouverture. |
| Combien de liens par ressource ? | **Plusieurs**, chacun avec son mode, son mot de passe, sa durée, retirable séparément. |
| Partager un email publie quoi ? | **Le fil entier**, texte seul, sans pièces jointes, **figé** au moment de la création. Lecture seule uniquement. |
| Lien note en lecture seule ? | **En direct** (même page que l'écriture, verrouillée côté serveur). |

## Existant et ce qu'on en fait

`apps/web/share-backend.mjs` + `share-store.mjs` publient aujourd'hui un **instantané HTML** d'une note (`PUT /api/share/:entityId`, page `/s/:slug`), republié à chaque sauvegarde par `ShareNotePanel`.

- ⚠️ Pas de notion de propriétaire : sans `SYNC_TOKEN` (cas de la prod), quiconque connaît un `entityId` peut republier ou retirer le partage. Le risque est faible (ULID non devinable, jamais exposé), mais le nouveau modèle le supprime.
- La table `share` est **conservée en lecture** : les anciens liens `/s/:slug` continuent de servir leur page figée. Les routes `PUT`/`DELETE /api/share/:entityId` et `ShareNotePanel` sont **retirés**.
- `yjs` et `y-prosemirror` sont déjà dépendances de `apps/web`, inutilisés. BlockNote 0.50 porte nativement la co-édition Yjs (`collaboration: { fragment, provider, user }`, curseurs et libellés inclus) et `blocksToYDoc` pour amorcer un document.

## Techno retenue

**Yjs (CRDT) + Hocuspocus auto-hébergé dans `server.mjs` + persistance Postgres.**

| Option | Pour | Contre |
|---|---|---|
| **Hocuspocus 4** (retenue) | Serveur WebSocket Yjs MIT, se greffe sur le `http.Server` existant (`upgrade` → adaptateur `crossws/adapters/node` → `handleConnection`), hook `onAuthenticate` (lecture seule **imposée côté serveur** via `connectionConfig.readOnly`), extension Database pour stocker l'état. Même conteneur, même Postgres. | Un process de plus à surveiller dans le conteneur. |
| y-websocket brut | Minimal | Auth, lecture seule, persistance, fermeture sur révocation : tout à écrire à la main. |
| SaaS (Liveblocks, Y-Sweet, PartyKit) | Zéro serveur | Dépendance externe payante, contenu des notes hors de notre infra. |

Plafond connu : un seul conteneur Scalingo. Passer à plusieurs conteneurs exigera `@hocuspocus/extension-redis`.

## Modèle de données (serveur)

Nouveau `share-store` à double moteur (SQLite `file:` / Postgres), même forme que `sync-store.mjs`.

**`share_resource`** — une ressource partagée (une note ou un fil)

| Colonne | Type | Rôle |
|---|---|---|
| `id` | texte, 16 octets aléatoires base64url | identifiant public du document (nom Hocuspocus) |
| `kind` | `note` \| `email` | |
| `ownerKeyHash` | texte | SHA-256 de la clé propriétaire (32 octets aléatoires, jamais stockée en clair) |
| `title` | texte | affiché sur la page invitée |
| `snapshot` | JSON, nullable | fil d'email figé ; `null` pour une note |
| `createdAt`, `updatedAt` | entier ms | |

**`share_link`** — un lien vers une ressource

| Colonne | Type | Rôle |
|---|---|---|
| `slug` | texte, 12 octets aléatoires base64url, PK | `/s/<slug>` |
| `resourceId` | texte | → `share_resource.id` |
| `mode` | `read` \| `write` | `write` refusé pour `kind = email` |
| `passwordHash` | texte, nullable | scrypt, même format que les mots de passe de salon |
| `expiresAt` | entier ms, nullable | `null` = sans limite |
| `label` | texte, nullable | repère libre (« pour Paul ») |
| `createdAt`, `revokedAt` | entier ms | révocation = `revokedAt` posé, la ligne reste pour l'historique |

**`collab_doc`** — état Yjs d'une note partagée : `resourceId` PK, `state` (binaire, `Y.encodeStateAsUpdate`), `updatedAt`. Écrit par l'extension Database de Hocuspocus (debounce natif).

**`share_blob`** — images publiées d'une note : (`resourceId`, `path`) PK, `bytes`, `createdAt`. Supprimées avec la ressource.

**`share_meta`** — clé/valeur du store de partage.

**Secret serveur** : `SHARE_SECRET` (env) signe les jetons d'accès ; à défaut, généré au premier démarrage et stocké dans `share_meta` pour survivre aux redéploiements.

Noms de colonnes en `snake_case` minuscule dans les deux moteurs (Postgres replie les identifiants non quotés en minuscules).

## API serveur

Montée par `server.mjs` et le middleware de dev `vite.config.ts`, seulement si `DATABASE_URL` est défini (garantie « zéro surface » inchangée).

**Propriétaire** — en-tête `x-share-owner: <ownerKey>`

| Route | Rôle |
|---|---|
| `POST /api/share/resources` `{ kind, title, snapshot? }` | crée la ressource → `{ id, ownerKey }` (seule fois où la clé sort) |
| `PUT /api/share/resources/:id/doc` (binaire) | amorce le document Yjs d'une note (refusé si déjà amorcé) |
| `PATCH /api/share/resources/:id` `{ title }` | renomme (appelé, débouncé, quand le titre de la note change pendant le partage) |
| `DELETE /api/share/resources/:id` | arrête le partage : supprime ressource, liens, document ; coupe les connexions |
| `GET /api/share/resources/:id/links` | liste des liens (sans hash) |
| `POST /api/share/resources/:id/links` `{ mode, password?, expiresAt?, label? }` | crée un lien → `{ slug }` |
| `PATCH /api/share/links/:slug` `{ password?, expiresAt?, label? }` | modifie (mot de passe `null` = le retirer) |
| `DELETE /api/share/links/:slug` | révoque, coupe les connexions ouvertes par ce lien |
| `PUT /api/share/resources/:id/blob?path=` | publie une image de la note (voir Images) |

**Invité**

| Route | Rôle |
|---|---|
| `GET /api/share/links/:slug/meta` | `{ kind, mode, title, needsPassword }`, ou `410 { reason: "expired" \| "revoked" }`, `404` |
| `POST /api/share/links/:slug/unlock` `{ password? }` | vérifie le mot de passe (vide si lien public) → `{ accessToken, resourceId, kind, mode }` |
| `GET /api/share/links/:slug/content` | fil d'email figé (jeton d'accès requis) |
| `GET /api/share/links/:slug/blob?path=` | image de la note (jeton d'accès requis) |

**Jeton d'accès** : HMAC-SHA256(`SHARE_SECRET`) sur `slug + exp + pv`, `exp = min(expiresAt du lien, maintenant + 12 h)`, `pv` = empreinte courte du hash de mot de passe (changer le mot de passe invalide les jetons émis). Porté en `Authorization: Bearer` (HTTP) et en `token` (Hocuspocus). Revérifié à chaque usage contre l'état du lien (révoqué, expiré).

**Anti-force brute** : même garde que `checkVaultPassword` (`sync-backend.mjs`), 10 échecs par lien et par adresse → blocage 15 min. Hachage scrypt, vérification, `clientIp` et compteur d'échecs sont extraits dans `apps/web/password.mjs`, importé par les deux backends.

**WebSocket** `wss://<hôte>/collab` → Hocuspocus. `onAuthenticate({ documentName, token })` :

- `owner:<ownerKey>` → accepté si le hash correspond à la ressource `documentName` ;
- sinon jeton d'accès → lien valide, non révoqué, non expiré, rattaché à `documentName` ; `connectionConfig.readOnly = mode === "read"` ;
- contexte retourné `{ slug }` : une révocation parcourt `documents.get(resourceId).connections` et ferme celles dont `context.slug` correspond.

Révocation, modification de mot de passe et suppression ferment immédiatement les connexions concernées. Un balayage toutes les 60 s ferme celles dont le lien a expiré. Taille de message WebSocket plafonnée (`maxPayload` 5 Mo).

## Côté propriétaire (app)

### Où vit la clé propriétaire

- **Note** : deux champs de frontmatter texte, `shareId` et `shareKey`, effacés par `""`. Les champs d'entité n'acceptent pas d'objet (`FieldValueSchema`), deux chaînes évitent de toucher au contrat IPC. Ils suivent la synchro de coffre existante (cloud ou git) vers les autres appareils du propriétaire, ce qui est nécessaire : chaque appareil doit ouvrir la note en co-édition avec les droits propriétaire. La clé transite donc aussi par le journal de synchro en ligne, sur le même serveur. ⚠️ Un coffre git poussé sur un dépôt public expose la clé ; le panneau de partage le signale.
- **Email** : `localStorage` `supernote.share.email`, table `"<accountId>:<threadId>"` → `{ resourceId, ownerKey }`. Le miroir mail est un cache jetable (un effacement le resynchronise depuis Gmail) : la clé n'y survivrait pas. Un partage d'email se gère depuis l'appareil qui l'a créé.

### Panneau « Partager »

Un composant commun `SharePanel` (HeroUI v3, `Popover` sur desktop, `MobileSheet` sous 768 px), ouvert depuis :

- l'en-tête de note (remplace `ShareNotePanel`), et une action « Partager » dans la top bar mobile de la note (`useMobileHeaderActions` de `app/notes/[id]/page.tsx`) ;
- la barre d'actions du fil mail (bouton icône + Tooltip), et le menu « Plus » sur mobile.

Contenu :

1. Liste des liens : mode (Lecture / Écriture), cadenas si mot de passe, échéance (« expire dans 3 j », « expiré »), libellé ; actions copier, modifier, révoquer.
2. « Nouveau lien » : mode (écriture masquée pour un email), accès **Public** / **Mot de passe** (champ), durée **Sans limite / 1 h / 24 h / 7 j / 30 j / Date…**, libellé optionnel.
3. « Arrêter le partage » (supprime la ressource, confirmation destructive).

Retour d'action porté par les boutons (`lib/action-feedback.tsx`), pas de toast, sauf « Annuler » après une révocation.

### Note en mode co-édition

Déclenché quand la note porte un `shareId` non vide :

1. **Premier lien d'une note** : `POST /resources` → `markdownToYUpdate(body)` (éditeur headless + `blocksToYDoc`, fragment `"document-store"`) → `PUT /resources/:id/doc` → écriture de `shareId` et `shareKey`.
2. `SupernoteEditor` gagne une prop optionnelle `collaboration` (fragment, provider, user) passée à `useCreateBlockNote`. L'éditeur est **remonté** (clé) au passage en mode co-édition, `useCreateBlockNote` ayant des dépendances vides. Rebuild du dist `@supernote/editor` requis. En co-édition, `initialContent` n'est pas passé (le document vient de Yjs) et l'ajout automatique d'un paragraphe après un bloc de base est coupé (chaque client l'ajouterait, d'où des doublons). L'éditeur n'est monté qu'après la première synchro du provider (ou le chargement `y-indexeddb` hors ligne), pour ne jamais taper dans un document vide.
3. `HocuspocusProvider` (`/collab`, `name = shareId`, `token = owner:<shareKey>`) + **`y-indexeddb`** : les modifications hors ligne du propriétaire sont gardées localement et fusionnées (CRDT) à la reconnexion.
4. Le markdown reste dérivé : le `onChange` existant continue d'écrire le fichier `.md`. Le fichier reflète donc toujours la dernière version connue, y compris les modifications des invités dès que le propriétaire ouvre la note.
5. Tant qu'un partage existe, **le document Yjs fait foi** : le remontage de l'éditeur sur changement externe du body (`NoteEditor.tsx`, `externalBodyVersion`) est coupé en co-édition. Une modification du `.md` hors de Supernote (éditeur externe, commit git) est écrasée à la prochaine ouverture. Limite documentée.
6. Le titre reste hors co-édition (champ de l'en-tête, propriétaire seul).
7. Présence : pastilles des personnes connectées dans l'en-tête de note (awareness), desktop et top bar mobile.
8. « Arrêter le partage » : suppression serveur, retrait du frontmatter, éditeur remonté en mode normal sur le markdown courant.

### Email

« Partager » construit le snapshot `{ subject, messages: [{ from, to, date, bodyText }] }` à partir du fil ouvert (`bodyText` uniquement : jamais de HTML, règle XSS du projet), `POST /resources { kind: "email", snapshot }`, puis création du lien. Lecture seule, figé.

## Côté invité

**Entrée Vite dédiée** `share.html` → `src/share/main.tsx`, servie par le serveur pour `/s/*` quand le slug appartient à `share_link` (sinon ancienne page `share`, sinon 404). Aucun coffre, aucun worker, aucun service worker : un bundle éditeur + provider, chargé en quelques centaines de ko. `public/sw.js` exclut `/s/`. `<meta name="robots" content="noindex">` ; la CSP (Report-Only) des pages HTML statiques s'applique, `connect-src 'self'` couvrant le WebSocket de même origine.

Parcours :

1. `meta` → lien expiré ou révoqué : page « Ce lien a expiré » / « Ce lien a été retiré ».
2. `needsPassword` → formulaire mot de passe (`Input` + `Button`), erreur inline, message de blocage après trop d'échecs.
3. `unlock` → jeton en `sessionStorage` (par slug).
4. **Note** : `SupernoteEditor` en mode co-édition (`token = jeton d'accès`), `editable = mode === "write"`.
   - Écriture : pseudo demandé à la première visite (`localStorage`), couleur dérivée du pseudo, curseur et libellé visibles des autres.
   - Lecture : pas de pseudo, pas de curseur diffusé ; voit les curseurs des éditeurs.
   - Blocs dépendants du coffre : vue de base et formule reçoivent des props `renderDatabaseView` / `renderFormula` invitées qui rendent l'encart « Contenu lié au coffre, non disponible » (sans elles, `SupernoteEditor` rend un bloc vide). Intégration de note, croquis et email Gmail ont déjà leur carte de repli. Les props des blocs ne sont jamais modifiées : le nœud Yjs reste intact pour le propriétaire.
   - Liens internes (mention, wikilink) : la page invitée neutralise les clics sur les liens relatifs dans l'éditeur, qui mèneraient vers l'app du propriétaire.
   - Envoi d'images par l'invité : non (hors périmètre).
5. **Email** : `content` → fil rendu en texte (échappement React), un bloc par message.
6. Déconnexion serveur (révocation, expiration) → bandeau « Accès retiré », éditeur verrouillé.

Mobile d'emblée : page invitée pleine largeur, `px-4 md:px-10`, défilement natif sans barre fixe en bas (le navigateur amène le curseur au-dessus du clavier, rien à gérer).

### Images

Les images d'une note référencent des chemins de coffre, illisibles pour un invité. À la création du partage et à chaque image ajoutée ensuite, le propriétaire publie les octets (`PUT /resources/:id/blob`, limite 10 Mo par image, stockage dans `share_blob`). L'éditeur invité résout `resolveFileUrl` vers `GET /links/:slug/blob`.

## Erreurs et cas limites

| Cas | Comportement |
|---|---|
| Serveur de partage absent (`DATABASE_URL` non défini) | bouton « Partager » masqué (même sonde `_info` qu'aujourd'hui) |
| Propriétaire hors ligne | co-édition locale via `y-indexeddb`, fusion à la reconnexion ; création/révocation de liens désactivée avec message |
| Lien expiré pendant une session | connexion coupée sous 60 s, bandeau côté invité |
| Clé propriétaire rejetée (ressource supprimée depuis un autre appareil) | la note repasse en mode normal, frontmatter nettoyé |
| Deux appareils propriétaires amorcent en même temps | `PUT /doc` refusé si déjà amorcé ; le second rejoint le document existant |
| Document Yjs > 5 Mo | message refusé par le serveur, erreur visible côté client |

## Vérification

`pnpm typecheck`, plus un nouveau spec e2e `tests/e2e/07-share.spec.ts` (backend SQLite `DATABASE_URL=file:` dans le `webServer` Playwright, deux contextes navigateur) :

1. lien écriture public : l'invité tape, le propriétaire voit le texte et le libellé du curseur de l'invité ;
2. lien lecture : l'invité ne peut pas modifier, et une écriture forcée côté client n'est pas propagée (lecture seule serveur) ;
3. lien avec mot de passe : refus puis accès ;
4. lien expiré et lien révoqué : page dédiée, connexion ouverte coupée ;
5. partage d'email : la page affiche le fil, sans HTML interprété ;
6. mobile : page invitée sans débordement horizontal.

Pas de test unitaire (politique du projet).

## Découpage d'implémentation

1. **Serveur** : store v2, API propriétaire et invité, jetons, anti-force brute factorisé, Hocuspocus sur `/collab`, routage `/s/*`, retrait des routes `PUT`/`DELETE` historiques.
2. **Éditeur** : prop `collaboration` de `SupernoteEditor`, fallbacks invités des blocs liés au coffre, rebuild dist.
3. **Entrée invitée** `share.html` : meta, mot de passe, note live, email, états expiré/retiré.
4. **App propriétaire** : `SharePanel`, mode co-édition des notes (frontmatter, provider, `y-indexeddb`, présence), partage d'email, images.
5. **e2e** `07-share.spec.ts`, puis déploiement (WebSocket Scalingo vérifié en prod).

Nouvelles dépendances : `@hocuspocus/server`, `@hocuspocus/extension-database`, `@hocuspocus/provider` (4.7), `crossws`, `y-indexeddb` ; `yjs` ajouté à `@supernote/editor` pour l'amorçage.

## Hors périmètre

Pièces jointes d'email, envoi d'images par un invité, commentaires, historique des versions, comptes utilisateurs, plusieurs conteneurs serveur, co-édition du titre.

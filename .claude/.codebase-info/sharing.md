# Partage par lien et co-édition

*Last Updated: 2026-09-23*

Une note ou un fil de mail se partage par lien public, avec ou sans mot de passe, avec ou sans date d'expiration. Une note se partage en lecture ou en écriture, et s'édite à plusieurs en temps réel, curseurs visibles. Un fil de mail est un instantané figé, en texte seul et en lecture seule.

Le serveur n'existe que si `DATABASE_URL` est défini, comme la synchronisation en ligne. Tout vit dans le même conteneur que le serveur statique.

## Carte des fichiers

| Rôle | Fichier |
|---|---|
| API REST `/api/share/*`, jetons, liens v1 | `apps/web/share-backend.mjs` |
| Stockage SQLite ou Postgres | `apps/web/share-store.mjs` |
| Serveur Yjs sur le WebSocket `/collab` | `apps/web/collab-server.mjs` |
| scrypt et anti-force brute, partagés avec la synchro | `apps/web/password.mjs` |
| Page invité, 2ᵉ entrée Vite, sans coffre ni worker | `apps/web/share.html`, `apps/web/src/share/` |
| Client propriétaire | `apps/web/src/lib/share/shareApi.ts`, `emailShares.ts`, `noteImages.ts` |
| Code commun propriétaire et invité | `apps/web/src/lib/share/collab.ts`, `types.ts` |
| Dialogue de gestion des liens | `apps/web/src/components/share/ShareDialog.tsx` |
| Co-édition côté propriétaire | `apps/web/src/components/notes/useNoteCollab.ts`, `NoteEditor.tsx` |
| Amorçage et relecture Yjs | `packages/editor/src/collab.ts` (`markdownToYUpdate`, `yFragmentToMarkdown`, `COLLAB_FRAGMENT = "document-store"`) |

## Modèle

Une **ressource** (`note` ou `email`) porte une clé propriétaire, dont le serveur ne garde que le hash. Elle a **plusieurs liens**. Chacun a son slug, son mode (`read` ou `write`, `write` réservé aux notes), son mot de passe facultatif, son expiration, son libellé et sa révocation douce (`revokedAt`).

- Pour une note, l'état Yjs est dans `collab_doc`, et les images publiées sont dans `share_blob`.
- Pour un mail, l'instantané est dans la ressource elle-même : 200 messages au plus, sans pièces jointes.

La clé propriétaire vit côté client :
- **Note** : champs de frontmatter `shareId` et `shareKey`. ⚠️ Un coffre git publié en public expose cette clé, et elle transite aussi par le journal de la synchro en ligne.
- **Mail** : `localStorage["supernote.share.email"]`, indexé par compte et par fil.

## Authentification

- **Propriétaire** : en-tête `x-share-owner: <ownerKey>`, comparé en temps constant.
- **Invité** : `GET /links/:slug/meta` est public (type, mode, titre, besoin d'un mot de passe). `POST /links/:slug/unlock` vérifie le mot de passe, puis renvoie un jeton `slug.exp.pv.sig` signé en HMAC. Le jeton vit 12 h au plus et jamais au-delà de l'expiration du lien. `pv` est la version du mot de passe : en changer invalide les jetons déjà émis. Côté invité, le jeton est gardé en `sessionStorage`, un par slug.
- **Anti-force brute** : 10 échecs par portée et par adresse IP, verrou de 15 min. Le compteur est réservé avant `await verifyPassword`, sinon des tentatives parallèles le contournent. Il est en mémoire, par conteneur.
- **Secret de signature** : `SHARE_SECRET`. Sans cette variable, un secret est généré et gardé dans `share_meta`.

## Co-édition

Hocuspocus 4.7.0 est branché par `crossws` sur l'événement `upgrade` du serveur HTTP. En prod, c'est `server.mjs` ; en dev, c'est le plugin `shareDevServer` de `vite.config.ts`, qui ne touche qu'à `/collab` pour laisser passer le HMR de Vite.

- `documentName` = id de la ressource. Le jeton vaut `owner:<ownerKey>` pour le propriétaire, ou le jeton d'accès pour un invité.
- **La lecture seule est imposée par le serveur** (`connectionConfig.readOnly`) : les écritures d'un lecteur n'atteignent ni les autres clients ni le stockage.
- Un refus porte une raison : `gone` (ressource disparue), `forbidden` ou `unavailable` (panne). ⚠️ Seul `gone` autorise le propriétaire à oublier sa clé, sinon une panne de base l'effacerait.
- La révocation, le changement de mot de passe et un balayage toutes les 60 s coupent les connexions concernées en fermant **tout le socket**. ⚠️ Il faut donc un `HocuspocusProvider` par note, avec son propre `url`, et jamais de `websocketProvider` partagé.
- Messages plafonnés à 5 Mo. Au `SIGTERM`, les stockages en attente sont vidés, en 8 s au plus.
- ponytail : les documents vivent en mémoire d'un seul conteneur ; pour en avoir plusieurs, il faut `@hocuspocus/extension-redis`.

## Côté propriétaire

`useNoteCollab` ouvre le provider et une copie hors ligne `y-indexeddb` nommée `supernote-collab-<id>`, purgée à l'arrêt du partage.

- **Démarrage** : l'état Yjs est calculé avant de créer la ressource, pour ne pas laisser de ressource orpheline si la conversion échoue.
- **Ouverture** : à l'état `ready`, `yFragmentToMarkdown` recale le `.md` sur l'état Yjs, pour récupérer les frappes faites par les invités pendant l'absence du propriétaire. BlockNote n'émet aucun `onChange` au montage.
- **Arrêt** : refusé tant que le provider n'a pas synchronisé avec le serveur, sinon les frappes des invités seraient perdues.

## Pièges

⚠️ **En co-édition, l'état Yjs fait foi et réécrit le corps de la note.** Tout ce qui écrit le `.md` hors de l'éditeur est écrasé. La garde commune est `refuseIfShared` (`lib/share/sharedNoteGuard.ts`) : `useTodoSync` (`toggleTodoDone`, `updateTodoMetadata`), l'outil IA `updateNote` et `NotePortal` (lecture seule) refusent d'écrire sur une note partagée. Ne sont pas encore gardés : le dépôt de fichiers dans l'arbre, la migration des todos.

⚠️ **Un invité en écriture choisit le markdown, donc les chemins d'image.** `noteImages.ts` ne publie que les images sous `ATTACHMENTS_DIR` (`lib/attachments-path.ts`), sans `..`, en png, jpeg, gif, webp ou avif ; `PUT /blob` refuse toute extension absente de `IMAGE_TYPES`. Élargir l'un des deux rouvre la lecture de n'importe quel fichier du coffre.

⚠️ **L'awareness d'un pair est une entrée non fiable injectée dans `style`.** Le curseur BlockNote et la sélection y-prosemirror y interpolent `user.color` tel quel. `sanitizePeerAwareness` (`lib/share/collab.ts`) réécrit l'état des pairs en place : couleur en `#rrggbb` exactement, nom limité à 40 caractères, et elle ne lève jamais. Elle doit être inscrite **avant** le montage de l'éditeur, car les écouteurs lib0 sont appelés dans l'ordre d'inscription.

⚠️ **La prop `collaboration` n'est lue qu'au montage** (`useCreateBlockNote` a des dépendances vides). `NoteEditor` remonte l'éditeur par `key` quand il entre ou sort du mode co-édition.

- Le SVG n'est pas dans `IMAGE_TYPES` : l'invité lit les images en URL `blob:`, qui appartient à l'origine de l'app et ne porte pas la CSP de la réponse.
- Un lecteur ne publie aucune awareness (`setLocalState(null)` à la construction du provider).
- Les liens v1, des pages HTML figées de la table `share`, restent servis tels quels par `/s/<slug>`.

Vérification : `tests/e2e/07-share.spec.ts` (propriétaire et invité dans deux contextes).

Voir aussi : [communication.md](communication.md), [database.md](database.md), [entry-points.md](entry-points.md).

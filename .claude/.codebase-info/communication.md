# Communication

*Last Updated: 2026-09-22*

Trois canaux : le thread principal parle au worker, le worker parle au thread principal, et l'application parle au serveur de synchronisation.

## Thread principal vers worker

Un lien tRPC personnalisé, `browserVaultLink` dans `apps/web/src/lib/trpc/browser-link.ts`, posé sur `postMessage`.

Chaque requête reçoit un identifiant `rpc-N`, part sous la forme `{ id, path, type, input }`, et se résout via une table d'attente sur la réponse `{ id, ok, result | error }`.

| Contrainte | Valeur | Effet |
|---|---|---|
| Timeout par requête | 15 s | au-delà, l'appel échoue côté interface même si le worker travaille encore |
| Timeout d'amorçage | 30 s | réarmé à chaque tick d'indexation, donc un long réindex ne le déclenche pas |
| File d'attente | oui | les requêtes envoyées avant `VAULT_READY` sont mises en file, pas rejetées |

La mise en file est délibérée : sans elle, un appel précoce retomberait silencieusement en mode dégradé.

Le worker est un singleton de module. Un redémarrage, par exemple après un rechargement à chaud, rejoue automatiquement le dernier message d'initialisation connu. En développement il est exposé sous `window.__supernoteWorker`, ce qui est le point d'entrée pour déboguer une procédure à la main.

## Worker vers thread principal

Le protocole vit dans `worker-protocol.ts`.

| Message | Rôle |
|---|---|
| `VAULT_READY`, `VAULT_ERROR` | fin d'amorçage, succès ou échec |
| `INDEX_PROGRESS` | avancement de l'indexation, réarme le timeout |
| `ENTITY_CHANGE` | une mutation locale, relayée vers la synchronisation |
| `{ __log: "..." }` | réémission des `console.*` du worker |

Cette dernière enveloppe existe parce qu'un worker n'a pas de console partagée avec l'onglet. Sans elle, les journaux du coffre seraient invisibles.

## Synchronisation en ligne

Transport asymétrique : flux SSE descendant sur `GET /api/sync/stream`, POST montant sur `POST /api/sync/push`. Une sonde `GET /api/sync/info?vault=` précède, pour détecter si le service est actif, connaître son epoch et savoir si le salon est verrouillé (`locked`).

**Pièces jointes.** Les ops ne portent que le markdown. Les octets d'une image de note passent à part par `/api/sync/blob?vault&path` (POST pour envoyer, GET/HEAD pour lire, même authentification que le salon). `apps/web/src/lib/vault-file-adapter.ts` pousse au collage et au premier affichage si le serveur ne l'a pas (`hasBlob`/`pushBlob`), et tire l'image absente en local (`pullBlob`, `apps/web/src/lib/online-sync/client.ts`). La visionneuse de pièces jointes (`useAttachmentBlob`) lit encore en local seulement.

⚠️ **Renommage et déplacement distants.** `syncApplyOps` (`worker-router.ts`) doit supprimer l'ancien `.md` quand le chemin change : sinon le reindex toutes les 30 s re-pointe l'entité sur la copie périmée, lui redonne un `updatedAt` récent, et l'ancien titre/dossier repart vers les autres appareils. Le reindex ignore aussi une copie dont l'entité a encore son fichier courant sur disque. Toute mutation qui change `filePath` en masse (`folders.rename`, `folders.delete`) doit appeler les hooks `onEntityUpdated`/`onEntityDeleted`, seuls émetteurs d'ops. Les dossiers vides, leurs couleurs et leur ordre ne sont pas synchronisés.

**Salons protégés.** Un salon peut porter un mot de passe. Il voyage dans le champ `token` du client, le même que `SYNC_TOKEN` (en-tête `x-sync-token`, `?token=` pour le stream, faute d'en-tête possible sur `EventSource`). `POST /api/sync/join` pose le mot de passe d'un salon libre, ou vérifie celui d'un salon protégé. `GET /api/sync/vaults` liste **uniquement les salons protégés** : un salon sans mot de passe garde le comportement historique, son nom servant de secret, et n'apparaît jamais. `/info` renvoyant `locked`, le client passe en erreur « Mot de passe requis » au lieu de boucler en reconnexion.

⚠️ **Un salon libre est revendicable par quiconque connaît son nom** : `/join` y pose alors un mot de passe et verrouille les autres appareils. Pour annuler, il faut passer par SQL (`DELETE FROM sync_meta WHERE key = 'pw:<nom>'`).

| Contrainte | Valeur |
|---|---|
| Debounce de poussée | 800 ms |
| Reconnexion | exponentielle, de 2 s à 30 s |
| Journal en attente | 500 opérations ou 2 Mo |

**Garde d'epoch.** Si le serveur annonce un epoch différent de celui connu, ce qui arrive quand son journal a été réinitialisé par un redéploiement, le curseur est remis à zéro pour forcer un rejeu complet.

⚠️ **Le journal en attente est borné.** Au-delà de 500 opérations ou 2 Mo, il est jeté et un réensemencement complet est programmé, silencieusement. Le serveur dédoublonne par identifiant d'opération, donc sur-pousser est inoffensif, mais sous-pousser perd des données.

La configuration vit entièrement en `localStorage`, jamais en IndexedDB, pour ne pas avoir à faire évoluer la version partagée avec le stockage des handles de coffre.

| Clé | Contenu |
|---|---|
| `supernote.onlineSync.config` | configuration active |
| `supernote.onlineSync.bindings` | liaison par coffre |
| `supernote.onlineSync.vaults` | registre des coffres cloud connus |
| `supernote.onlineSync.clientId` | identifiant d'appareil, filtre les échos |

## Gmail

Appels REST directs depuis le navigateur, token GIS mis en cache par couverture de scopes. Tout passe par `gmailRequest` (`apps/web/src/lib/gmail.ts`) : sur 401 le token est oublié (`forgetAccessToken`, jamais `clearAccessToken` qui révoque tout le consentement) et l'appel rejoué une fois ; au second échec, l'état « reconnexion requise » est levé (`gmailReconnectRequired()`, événement `GMAIL_AUTH_EVENT`) et plus rien ne retente seul. `reconnectGmail` doit partir d'un geste utilisateur, les popups GIS sont bloquées sinon.

Les écritures (triage, labels, étoile, lu) passent par l'outbox `mail_outbox` : échec réseau, jeton, 429 ou 5xx ne comptent pas comme tentative, un refus 4xx attend avec backoff. Pas de poll : la vidange part sur `MAIL_OUTBOX_EVENT` (`lib/mail-mirror.ts`), `online`, `visibilitychange`, la reconnexion et le vault prêt. `MailFollowupRunner`, monté dans toute l'app, porte aussi le réveil des reports et les relances.

## Montages de coffres

Un coffre peut en monter d'autres comme sous-dossiers. `MountSyncManager` tient un client de synchronisation par montage. La provenance d'une entité montée est portée par la colonne `entity.sourceVaultId`.

## Côté serveur

`apps/web/server.mjs` ne monte `/api/sync/*` que si `DATABASE_URL` est défini, et ne charge `better-sqlite3` qu'à ce moment. Sans cette variable, le déploiement garde sa garantie de zéro dépendance à l'exécution.

En développement, un middleware de `vite.config.ts` monte le même backend, à la même condition.

**Back-office.** `GET /admin`, servi par `sync-backend.mjs`, rend une page HTML qui liste tous les espaces à partir de l'op-log groupé par `vault` (`store.listVaults()`), salons libres compris. Le nom d'un salon libre étant son secret, `/admin` garde un Basic Auth dédié sur `ADMIN_TOKEN`, et `public/sw.js` exclut `/admin` et `/api/*` pour que ces listes n'atterrissent jamais en Cache Storage.

**Authentification par salon.** `vaultAuthed()` garde pull, push et stream : `SYNC_TOKEN` accepté s'il est défini, sinon vérification `scrypt` du mot de passe stocké en table de méta sous `pw:<nom>` (voir [database.md](database.md)), avec un cache mémoire des vérifications réussies.

Voir aussi : [architecture.md](architecture.md), [database.md](database.md).

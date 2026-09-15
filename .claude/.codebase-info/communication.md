# Communication

*Last Updated: 2026-09-13*

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

Transport asymétrique : flux SSE descendant sur `GET /api/sync/stream`, POST montant sur `POST /api/sync/push`. Une sonde `GET /api/sync/info` précède, pour détecter si le service est actif et connaître son epoch.

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

## Montages de coffres

Un coffre peut en monter d'autres comme sous-dossiers. `MountSyncManager` tient un client de synchronisation par montage. La provenance d'une entité montée est portée par la colonne `entity.sourceVaultId`.

## Côté serveur

`apps/web/server.mjs` ne monte `/api/sync/*` que si `DATABASE_URL` est défini, et ne charge `better-sqlite3` qu'à ce moment. Sans cette variable, le déploiement garde sa garantie de zéro dépendance à l'exécution.

En développement, un middleware de `vite.config.ts` monte le même backend, à la même condition.

Voir aussi : [architecture.md](architecture.md), [database.md](database.md).

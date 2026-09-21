# Mot de passe par coffre cloud et liste cliquable à l'accueil

*2026-09-21 — statut : implémenté, vérifié en dev*

## Besoin

Sur l'écran d'accueil (choix du coffre), afficher les coffres cloud et s'y connecter d'un clic, sans retaper la clé de salon.

## Pourquoi un mot de passe

Aujourd'hui la **clé de salon est à la fois le nom et le secret**. Le serveur route par match exact (`WHERE vault = ?`) et `SYNC_TOKEN` est coupé en prod (`requiresToken: false`). Lister les salons du serveur publierait donc tous les secrets.

Décision : séparer **nom** (public, listé) et **mot de passe** (secret, par salon).

## Modèle

- Un salon a un nom et, optionnellement, un mot de passe.
- **Protégé ⇔ une entrée `pw:<nom>` existe** dans la table de méta du store (`meta` en SQLite, `sync_meta` en Postgres). Aucune migration de schéma.
- **Listé ⇔ protégé.** Invariant de sécurité : un salon sans mot de passe garde le comportement actuel (son nom sert de secret) et n'apparaît jamais dans la liste.
- Le mot de passe voyage dans le champ `token` existant, déjà plombé partout : `OnlineSyncConfig.token`, `CloudVaultEntry.token`, `CloudSetupArgs.token`, liaisons par coffre, nœuds de montage, en-tête `x-sync-token` et `?token=` du stream. Pas de nouveau champ.

## Serveur — `apps/web/sync-backend.mjs`, `apps/web/sync-store.mjs`

1. **Store** : `getVaultPassword(vault)`, `claimVaultPassword(vault, record)` (insertion atomique, `false` si déjà protégé), `listProtectedVaults()` sur la table de méta, pour les deux moteurs. `record` = `scrypt` (stdlib `node:crypto`) : `salt:hash` en hex.
2. **`vaultAuthed(vault, provided)`** remplace `authed()` sur pull, push et stream :
   - `SYNC_TOKEN` défini et fourni → accepté ;
   - salon protégé → vérification `scrypt` + `timingSafeEqual`, résultat mis en cache en mémoire (clé = salon + sha256 du mot de passe fourni) pour ne pas payer `scrypt` à chaque push ;
   - salon non protégé → comportement actuel (`!SYNC_TOKEN`).
   Pull et stream vérifient après lecture de `vault` dans la query, push après lecture du corps.
3. **`GET /api/sync/vaults`** → `{ vaults: string[] }`, noms des salons protégés triés. Soumis à `SYNC_TOKEN` s'il est défini.
4. **`POST /api/sync/join { vault, password }`** :
   - salon protégé → 200 si le mot de passe est bon, sinon 401 ;
   - salon non protégé → pose le mot de passe (création ou revendication), 201. Refus 400 sous 8 caractères. Si `SYNC_TOKEN` est défini, la revendication exige `x-sync-token` valide.
5. **`GET /api/sync/info?vault=…`** ajoute `locked: true` quand le salon est protégé et que le secret fourni ne passe pas. Permet au client de dire « mot de passe requis » au lieu de boucler en reconnexion.
6. CORS inchangé : `x-sync-token` est déjà autorisé.

## Client

1. **`lib/online-sync/client.ts`** : deux fonctions exportées, `listServerVaults(serverUrl, token)` et `joinVault(serverUrl, vaultKey, password)`. `start()` appelle `/info?vault=` ; si `locked`, statut `error` avec « Mot de passe du salon requis ou incorrect — Réglages › Synchronisation », sans ouvrir le stream.
2. **Écran d'accueil** (`PwaVaultSetup.tsx`, états `prompt` et `picking`) : bloc « Vos coffres cloud » au-dessus des cartes, quand `canCloud` :
   - coffres cloud déjà connus sur l'appareil (`recentVaults` de type `cloud`) → clic = `switchToVault(id)`, connexion immédiate ;
   - salons protégés du serveur de l'app (même origine), moins ceux déjà connus → clic = champ mot de passe en ligne → `setupCloudVault({ serverUrl: "", vaultKey, token })`.
   - Correctif lié : la branche d'amorçage `!isPwa` (téléphone) passe en `prompt` sans `refreshRecents()`, donc la liste locale serait vide sur mobile. Ajout d'un appel.
3. **Formulaire cloud** (« Nouveau coffre / autre serveur ») : « Clé de salon » devient « Nom du coffre », « Jeton (optionnel) » devient « Mot de passe ». `setupCloudVault` appelle `joinVault` après la sonde `/info` quand un mot de passe est saisi : 401 → « Mot de passe incorrect » dans le formulaire ; salon vierge ou non protégé → il devient protégé. Sans mot de passe → comportement actuel (non listé). Après une erreur, le formulaire (démonté pendant la sonde) retrouve le serveur et le nom saisis.
4. **Réglages › Synchronisation** (`SyncTab.tsx`) : « Jeton » devient « Mot de passe du salon ». Au clic sur Connexion, `joinVault` d'abord si un mot de passe est saisi. C'est le chemin de migration des salons existants et de reconnexion d'un appareil verrouillé. `enable()` (`OnlineSyncProvider.tsx`) met aussi à jour le registre cloud quand le salon ne change pas : sans ça, rouvrir ce coffre depuis la liste reprendrait l'ancien mot de passe.
5. **Montages** (`use-create-mount.ts`, `ConnectVaultModal.tsx`) : même `joinVault` avant d'écrire le nœud, libellé « Mot de passe ».

Mobile : le bloc liste est une colonne de boutons pleine largeur (cibles ≥ 44 px), dans l'overlay déjà scrollable.

## Migration

Les salons existants (`amaury`, `strategie`, `linh`…) restent ouverts et non listés tant que personne n'y pose de mot de passe. Pour en protéger un : Réglages › Synchronisation sur un appareil connecté, saisir un mot de passe, Connexion. Les autres appareils passent alors en « Mot de passe requis » et se reconnectent en saisissant le même mot de passe au même endroit.

## Limites assumées

- Le mot de passe passe dans l'URL du stream (`EventSource` ne pose pas d'en-tête), donc dans les logs du routeur. C'est déjà le cas de `SYNC_TOKEN`.
- Pas de limite de tentatives : `scrypt` (~50 ms) plus 8 caractères minimum. À ajouter si un salon est attaqué.
- Pas de changement ni de réinitialisation du mot de passe dans l'UI. Réinitialisation par SQL : `DELETE FROM sync_meta WHERE key = 'pw:<nom>'`.
- Un salon non protégé reste revendicable par quiconque connaît son nom (qui pouvait déjà le lire et l'effacer).
- Le partage de notes (`share-backend.mjs`) compare toujours `x-sync-token` à `SYNC_TOKEN` seul. Sans effet en prod (pas de `SYNC_TOKEN`).
- Serveur avec `SYNC_TOKEN` : un seul champ secret côté client, donc impossible d'y revendiquer un salon depuis l'UI.

## Vérification

- `pnpm typecheck`.
- `curl` sur le backend de dev (`/vaults`, `/join` bon et mauvais mot de passe, `/pull` protégé sans et avec secret, `/info?vault=` verrouillé).
- App en dev, deux profils navigateur : créer un coffre protégé, le voir listé depuis l'autre, clic + mauvais puis bon mot de passe, puis protéger un salon existant et constater « Mot de passe requis » sur l'autre appareil. Vue mobile émulée pour la liste.
- Pas d'e2e existant sur le flux cloud ; pas de nouveau test (politique zéro test unitaire).

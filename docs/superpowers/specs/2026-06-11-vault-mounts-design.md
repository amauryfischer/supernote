# Montages de vaults (« vault-ception ») — Design

Date : 2026-06-11 · Statut : validé (cadrage utilisateur : source = salons cloud,
édition bidirectionnelle, scope complet notes + bases)

## Objectif

Depuis un vault ouvert (le « père », quelle que soit sa source : dossier, git,
cloud), connecter d'autres vaults **cloud** (clé de salon) qui apparaissent
comme des sous-dossiers spéciaux dans Notes et dont les entités (contacts,
habitudes, todos, bases…) sont fusionnées dans les vues du père. Récursif :
un sous-vault peut lui-même monter des vaults (résolution transitive), avec
garde anti-boucle. Édition bidirectionnelle : modifier une entité montée
depuis le père pousse l'op vers le salon d'origine.

## Invariant de sûreté n°1

**Une entité de provenance X ne part JAMAIS vers un salon ≠ X.** C'est la
classe de bug « contamination croisée des salons » corrigée le 2026-06-11
(cf. architecture v2 du coffre cloud) ; chaque garde ci-dessous existe pour
maintenir cet invariant.

## Modèle de données

### Colonne de provenance

`ALTER TABLE entity ADD COLUMN sourceVaultId TEXT` (nullable, défaut NULL).

- `NULL` → entité native du vault père.
- `cloud:<server>|<key>` (le `cloudVaultId` existant) → entité répliquée
  depuis ce salon monté.
- Ajout idempotent au boot du worker (pas de mécanisme de migration
  versionnée : `ALTER TABLE` dans un try/catch « duplicate column »).
- Index : `CREATE INDEX IF NOT EXISTS idx_entity_source ON entity(sourceVaultId)`.

La provenance est **locale au père** — elle ne voyage pas dans `EntityOp`
(l'op-log d'un salon reste neutre). Elle est posée par `sync.applyOps` quand
l'appel provient d'un client de montage (champ optionnel `sourceVaultId`
ajouté à l'input tRPC — extension non-breaking).

### Entité de montage

Nouveau type système `vault_mount` (seedé `isSystem=1`, id stable
`"vault_mount"`), entités stockées dans le vault père :

```
fields: {
  serverUrl: string   // "" = même origine
  vaultKey:  string   // clé de salon normalisée (trim+lowercase)
  token:     string   // optionnel
  label:     string   // nom affiché du sous-dossier
}
```

- Réplication gratuite : les `vault_mount` natifs voyagent dans l'op-log du
  père → tous les appareils (et membres du salon père) voient les mêmes
  montages. **Conséquence assumée : le token du sous-vault est visible des
  membres du salon père** — c'est le mécanisme de partage voulu.
- Pas de fichier `.md` dédié nécessaire : entités DB + op-log comme les autres
  (filePath sous `@system/mounts/<id>.md`, exclu de l'arbre UI).

### Préfixe de chemin virtuel

Les entités montées sont stockées dans la DB du père avec
`filePath = "@mounts/<slug>/" + filePathOrigine` où `<slug>` =
`cloudRoomSlug(cloudVaultId)` (réutilisé de PwaVaultSetup, à extraire dans un
module partageable).

- Résout l'unicité `(vaultId, filePath)` face aux collisions père/montés.
- Donne le « sous-dossier » dans l'arborescence existante sans logique
  spéciale de groupement.
- Au push retour (édition locale d'une entité montée), le préfixe est
  **retiré** avant d'envoyer l'op au salon d'origine.

## Moteur de sync multi-salons

### MountSyncManager (main thread, `apps/web/src/lib/online-sync/mounts/`)

Démarre quand le vault est `ready` (dans `OnlineSyncProvider` ou un provider
frère), indépendamment du fait que le père ait lui-même une sync active.

1. **Découverte** : query worker `entities.list({type: "vault_mount"})` —
   inclut les `vault_mount` natifs ET montés (provenance ≠ NULL) pour la
   résolution transitive. Re-déclenchée quand un `ENTITY_CHANGE` concerne un
   `vault_mount` (ajout/retrait à chaud).
2. **Résolution transitive avec gardes** :
   - ensemble `visited` de `cloudVaultId` (normalisés) — déjà visité → skip
     (boucles A→B→A, diamants A→B→D + A→C→D) ;
   - profondeur max 4 ;
   - skip du salon du père lui-même (si le père est un coffre cloud) ;
   - budget max 16 montages simultanés (log au-delà).
3. **Un `OnlineSyncClient` par montage résolu** (réutilisé tel quel) :
   - `applyOps` → `sync.applyOps.mutate({ ops, sourceVaultId: mountId })` ;
   - `getSnapshot` → **interdit** : un montage ne seed jamais ; `seeded` est
     forcé à `true` et `getSnapshot` lève si appelé (ceinture) ;
   - curseurs par montage : localStorage
     `supernote.onlineSync.mountCursors.<parentVaultId>.<mountId>` =
     `{lastSeq, epoch}` (`parentVaultId` = id du vault père, pour qu'un
     switch de père reparte proprement) ;
   - `enqueue` alimenté UNIQUEMENT par les `ENTITY_CHANGE` dont le
     `sourceVaultId` égale ce montage (routage, cf. ci-dessous) ;
   - pendingOps journal séparé : `supernote.onlineSync.pending.mount.<mountId>`.
4. **Démontage** (entité `vault_mount` supprimée ou boucle de découverte ne la
   résout plus) : stop du client, purge des curseurs, et
   `sync.purgeMounted.mutate({ sourceVaultId })` (DELETE direct sans hooks —
   les entités montées disparaissent du père, le salon d'origine intact).

### Routage des écritures (bidirectionnel)

- `ENTITY_CHANGE` (worker) porte désormais `sourceVaultId` (lecture de la
  colonne avant émission).
- `OnlineSyncProvider` (client du père) **ignore** les ops avec
  `sourceVaultId ≠ null` (aujourd'hui il pousse tout — garde nouvelle).
- `MountSyncManager` route l'op vers le client du montage correspondant,
  après **dé-préfixage** du `filePath` et retrait du marquage local.
- Création DANS un sous-dossier monté (`@mounts/<slug>/…`) : le worker pose
  `sourceVaultId = <mountId>` à l'insertion (déduit du préfixe), DB-only,
  poussée vers le salon du montage qui la matérialise chez lui.
- Les ops **entrantes** d'un montage n'émettent pas d'`ENTITY_CHANGE`
  (comportement `applyOps` existant) → pas d'écho.

## Gardes worker (sûreté)

Dans `apps/web/src/lib/vault-worker/` :

1. `syncSnapshot` (seed du père) : `WHERE sourceVaultId IS NULL`.
2. `syncApplyOps` avec `sourceVaultId` fourni :
   - pose la colonne, préfixe le `filePath`, **n'écrit AUCUN fichier**
     (ni `.md` ni autre) ;
   - LWW par `ts` comme aujourd'hui ; collision d'`id` avec une entité d'une
     AUTRE provenance (y compris native) → skip + `console.warn` (ne jamais
     écraser cross-provenance).
3. Sweep phantom : `WHERE … AND sourceVaultId IS NULL` (les montées n'ont pas
   de fichier, elles seraient toutes balayées sinon).
4. Reindex : inchangé (n'adopte que des fichiers — les montées n'en ont pas).
5. Mutations standard (`entities.update/delete`) sur une entité montée :
   autorisées (c'est l'édition bidirectionnelle), `ENTITY_CHANGE` émis avec la
   provenance ; **pas d'écriture fichier** quand `sourceVaultId ≠ NULL`.
6. `sync.purgeMounted({ sourceVaultId })` : DELETE en masse sans hooks ni
   fichiers ; invalide les caches.
7. Types manquants : `applyOps` crée le type à la volée depuis
   `typeName` (`isSystem=0`, champs vides) — les défs de colonnes des types
   custom ne voyagent pas dans l'op-log (limitation V1 documentée). Les types
   SYSTÈME (personne, habit, todo, …) ont des ids stables partagés → merge
   exact.

## UI

Desktop ET mobile dans le même mouvement (règle projet).

1. **Connecter** : bouton « Connecter un vault » dans le header du FileTree
   (icône plug) + section dans Paramètres → Synchronisation ; mobile : entrée
   dans le drawer « Plus » / sous-vue vault. Form : clé de salon, serveur
   (optionnel), token (optionnel), label. Probe `/api/sync/info` avant
   création (comme CloudSetupForm). Crée l'entité `vault_mount`.
2. **FileTree** : un nœud racine par montage actif (icône `Plugs`/`Cloud`,
   teinte dédiée), contenant l'arborescence dérivée des `filePath` préfixés.
   Menu contextuel : « Déconnecter ce vault » (delete `vault_mount` →
   confirmation → purge). Statut de connexion du montage (pastille) si simple
   à exposer depuis le manager.
3. **Badge provenance** : sur `NoteListItem` et les lignes/cartes des vues
   bases (contacts, habitudes, todos), un chip discret avec le label du
   montage. Filtre « source » dans les vues bases si trivial (sinon V2).
4. **Vues bases** : aucune logique nouvelle — l'union vient de la DB. Vérifier
   seulement que les queries ne filtrent pas par accident sur la provenance.

## Ce qui ne change PAS

- Le protocole serveur (`/api/sync/*`) : zéro changement, un montage est un
  client SSE normal de son salon.
- `EntityOp` / op-log : shape inchangée.
- L'architecture v2 du coffre cloud (rooms namespacés, db-owner).

## Limites V1 (documentées)

- Types custom : entités mergées mais définitions de colonnes non
  transportées → colonnes « nues » côté père.
- Pas de gestion de droits (lecture seule par montage) — tout membre du père
  peut éditer le sous-vault. V2 : flag `readOnly` sur le montage.
- Canvas `.excalidraw` des sous-vaults : non transportés par l'op-log (comme
  pour tout salon) → aperçus canvas indisponibles côté père.
- Conflits d'id cross-provenance : skip + warn (pas de fusion).

## Tests

- Worker (vitest) : ALTER idempotent ; seed exclut les montées ; applyOps
  avec provenance (préfixe, pas de fichier, LWW, cross-provenance skip) ;
  sweep ignore les montées ; purgeMounted.
- MountSyncManager (vitest, clients mockés) : résolution transitive, boucle
  A→B→A, diamant, profondeur max, routage des ENTITY_CHANGE par provenance,
  dé-préfixage au push, démontage → purge.
- E2E manuel : deux salons dev, montage croisé, édition bidirectionnelle.

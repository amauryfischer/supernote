# Synchro d'un dossier du coffre avec un dossier Google Drive

*2026-11-06. Demande d'Amaury : « synchroniser juste un dossier ou sous-dossier sur le Drive, à un endroit de mon Drive que je choisirais ». Option retenue : synchro dans les deux sens.*

## Intention

Choisir un dossier du coffre (ou un sous-dossier), choisir un dossier de son Drive, et que les deux restent identiques : une note modifiée dans Supernote arrive sur Drive, un fichier modifié ou ajouté sur Drive revient dans Supernote. Usage visé : retrouver ou partager ces notes hors de Supernote, et pouvoir les modifier depuis Drive.

## Objectifs

1. Plusieurs liaisons possibles, chacune « dossier du coffre ↔ dossier Drive », sous-dossiers compris (arborescence recopiée).
2. Choix du dossier Drive de destination dans un navigateur de dossiers Drive.
3. Dans les deux sens : création, modification, renommage/déplacement, suppression.
4. Aucune perte silencieuse : un conflit produit une copie, une suppression passe par la corbeille Drive.
5. Desktop et mobile (règle projet) : réglage utilisable sur téléphone, synchro qui tourne aussi sur mobile en coffre cloud.

## Non-objectifs (v1)

- Conversion en Google Docs : les notes restent des `.md` sur Drive (voir « Décisions » 1).
- Images et pièces jointes des notes, canvas `.excalidraw`, fichiers non-markdown présents sur Drive : ignorés.
- Dossiers vides, couleurs et ordre de dossiers (déjà hors synchro en ligne).
- Mode dégradé (sans worker) : fonctionnalité masquée, comme les autres fonctions riches (`hasWorkerBackend()`).
- Synchro temps réel : passage périodique.

## Anti-objectifs

- Écraser une modification sans en garder trace.
- Supprimer définitivement une note des deux côtés à cause d'une seule suppression.
- Boucle d'écho : une note réécrite à l'identique qui repart sans fin entre Drive et le coffre ou entre appareils.
- Demander une popup Google hors d'un geste utilisateur.

## Décisions (mes choix, l'utilisateur a demandé de démarrer sans questions)

1. **Format sur Drive = le fichier `.md` exact du coffre** (frontmatter `id`/`type`/champs + corps), tel que `syncApplyOps` l'écrit via `serializeFrontmatter`. Sur Drive il s'ouvre et s'édite avec n'importe quel éditeur texte (« Ouvrir avec »), pas comme un Google Doc. Le frontmatter garde l'`id` : il sert à rapprocher les fichiers sur un appareil neuf.
2. **Scope `https://www.googleapis.com/auth/drive` complet**, demandé au moment où on crée la première liaison (consentement incrémental, comme Gmail). Raison : `drive.file` (déjà accordé) ne permet pas de modifier ni de mettre à la corbeille un `.md` que l'utilisateur a créé lui-même dans Drive. L'app est déjà en mode test avec des scopes restreints (Gmail), donc pas de vérification Google supplémentaire bloquante.
3. **Navigateur de dossiers maison** (modal `@supernote/ui`, `files.list` sur `mimeType = folder`, fil d'Ariane, « Créer un dossier ici »), pas Google Picker : pas de clé API ni de script en plus, et il marche sur mobile.
4. **Liaisons stockées par appareil en `localStorage`** (`supernote.driveSync.links`, clé par `vaultId`), comme `supernote.onlineSync.bindings`. Une liaison = `{ id, vaultFolder, driveFolderId, driveFolderPath, enabled }`.
5. **État de synchro dans le worker**, table locale hors op-log comme `cal_*` :
   `drive_sync_file(linkId, entityId, driveFileId, relPath, driveMd5, localHash, syncedAt)`, clé `(linkId, driveFileId)`, index `(linkId, entityId)`. `localHash` = `entity.fileHash` vu au dernier accord ; `driveMd5` = `md5Checksum` Drive vu au dernier accord.
6. **Détection côté Drive par listage récursif** du dossier lié à chaque passe (`files.list`, `'<id>' in parents and trashed = false`, champs `id,name,mimeType,md5Checksum,modifiedTime,parents`). `shortcut:` une requête par sous-dossier, à remplacer par `changes.list` si une liaison dépasse ~50 sous-dossiers ou si le quota bronche.
7. **Runner `DriveSyncRunner`** monté dans `RootLayout.tsx` à côté de `CalendarRunner` : passe toutes les 5 min, au retour sur l'onglet, après une modification locale dans un dossier lié (debounce 10 s), et sur « Synchroniser maintenant ». **Seulement avec un jeton en cache** ; sinon état « Synchro en pause · Reprendre » (le clic est le geste qui autorise la popup). Appels via `googleRequest` (`lib/google-api.ts`) pour hériter du 401/rejeu, de la garde quota et de l'état « reconnexion requise ».
8. **Écritures locales via les routes qui déclenchent les hooks** (`onEntityCreated/Updated/Deleted`), jamais via `sync.applyOps` : une note qui arrive de Drive doit repartir vers le salon en ligne et les autres appareils.

## Algorithme d'une passe (par liaison)

Entrées : fichiers locaux (`entity` dont `filePath` commence par `vaultFolder/` et finit par `.md`, `sourceVaultId IS NULL`), fichiers Drive listés, lignes `drive_sync_file`.

Pour chaque paire rapprochée (par `drive_sync_file`, sinon par `id` du frontmatter, sinon par chemin relatif + contenu identique) :

| Local changé ? (`fileHash ≠ localHash`) | Drive changé ? (`md5 ≠ driveMd5`) | Action |
|---|---|---|
| non | non | rien (chemin changé d'un côté → renommer/déplacer de l'autre) |
| oui | non | téléverser le contenu (`PATCH` media), renommer/déplacer si le chemin a changé |
| non | oui | télécharger, mettre à jour la note (corps, champs, chemin) |
| oui | oui | contenus identiques → juste enregistrer l'accord ; sinon **conflit** |

**Conflit** : la version Supernote reste la note ; la version Drive arrive comme nouvelle note `« Titre (conflit Drive AAAA-MM-JJ) »` dans le même dossier (et donc sur Drive à la passe suivante). Rien n'est écrasé.

**Nouveau côté local** (pas de ligne d'état) : créer sur Drive, en créant les sous-dossiers manquants (réutiliser/étendre `resolveDriveSubfolder`).
**Nouveau côté Drive** : `.md` sans `id` de frontmatter → créer la note locale à `vaultFolder/<relPath>` (type note), puis réécrire le fichier Drive avec le frontmatter produit (le rapprochement survit alors à un appareil neuf). `.md` avec un `id` qui existe déjà ailleurs dans le coffre hors liaison → nouvel id, pas de vol de note.

**Suppression** :
- Note supprimée localement (ligne d'état, plus d'entité) → `files.update { trashed: true }` : récupérable 30 jours dans la corbeille Drive.
- Fichier disparu de Drive (corbeille ou suppression) → supprimer la note locale **seulement si elle n'a pas changé depuis le dernier accord** ; sinon la recréer sur Drive. Le contenu reste dans la corbeille Drive, qui sert de filet.
- Liaison retirée ou désactivée → on oublie l'état, on ne supprime rien d'un côté ni de l'autre.

Écho : après chaque écriture, enregistrer `localHash` et `driveMd5` résultants. Une passe qui ne voit aucun changement n'écrit rien. Deux appareils avec la même liaison convergent : le second voit des contenus identiques et n'enregistre que l'accord (la sérialisation `serializeFrontmatter` doit être déterministe, à vérifier).

Ordre : traiter les dossiers parents avant les fichiers ; une erreur sur un fichier n'arrête pas la passe (journal + compteur d'erreurs affiché).

## Routes worker à ajouter (`drive-sync-routes.ts`, fusionné dans `worker-router.ts`)

- `driveSync.localFiles({ prefix })` → `[{ entityId, filePath, fileHash, content }]` (contenu `.md` sérialisé comme sur disque).
- `driveSync.applyRemote({ entityId?, filePath, content })` → crée ou met à jour la note en parsant le frontmatter, **avec hooks** ; renvoie `{ entityId, fileHash }`.
- `driveSync.deleteLocal({ entityId })` → passe par `entities.delete` (hooks + tombstone).
- `driveSync.state.list/upsert/remove/clearLink` sur `drive_sync_file`.

Le pont tRPC est un type : ajouter les procédures au routeur `@supernote/ipc` (puis `pnpm build:packages`).

## Interface

- **Réglages → Google Drive** : section « Dossiers synchronisés ». Liste des liaisons (dossier du coffre → chemin Drive, dernière synchro, erreurs, interrupteur, « Synchroniser maintenant », retirer). Bouton « Ajouter » : choisir le dossier du coffre, puis le dossier Drive dans le navigateur (décision 3).
- **Arbre des notes** (`FileTree.tsx`, menu du dossier) : « Synchroniser avec Drive… » qui ouvre le même flux pré-rempli ; pastille discrète sur un dossier lié.
- Mobile : le modal navigateur s'affiche plein écran sous 768px, cibles ≥ 32px ; entrée dans le menu du dossier mobile et dans les réglages.
- Retour d'action porté par le bouton (pas de toast, `lib/action-feedback.tsx`).

## Contraintes

- Pas de test unitaire (politique projet). Vérification : `pnpm build:packages`, `pnpm typecheck`, `pnpm lint`, puis essai réel sur un compte Drive.
- HeroUI v3 via `@supernote/ui`, boutons icône + Tooltip.
- Le token Google vit dans le thread principal : le runner tourne côté page, le worker ne parle jamais à Drive.

## Laissé au constructeur

- Découpage exact de `drive-sync.ts` (lib) vs runner vs composants.
- Traitement des noms invalides ou en double côté Drive (Drive accepte les doublons de nom : prendre le premier, journaliser).
- Plafond de taille par passe et pagination.

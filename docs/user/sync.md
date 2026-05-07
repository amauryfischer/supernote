# Sync entre appareils

Supernote ne dépend d'aucun service cloud propriétaire pour la sync. Le vault est un dossier ordinaire — tu choisis comment le synchroniser.

---

## Principe : le filesystem est la source de vérité

Tout est dans les fichiers `.md` et `.canvas`. La base de données SQLite (`index.db`) est un **index** reconstruit depuis les fichiers. Si tu copies le dossier vault sur une autre machine et que tu l'ouvres avec Supernote, tout fonctionne — notes, contacts, schémas, vues, historique.

Ce modèle te donne :
- Portabilité totale (clé USB, Drive, Dropbox, NAS)
- Pas de CRDT, pas de format propriétaire
- Tes fichiers restent lisibles par n'importe quel éditeur texte

---

## Option 1 : Drive / Dropbox / iCloud

La façon la plus simple. Mets ton vault dans le dossier synchronisé par ton cloud :

```
~/Google Drive/My Drive/Supernote/
~/Dropbox/Supernote/
~/Library/Mobile Documents/.../Supernote/   # iCloud
```

**Avantages :** zéro configuration, fonctionne immédiatement.

**Inconvénients :** 
- Risque de conflit si les deux machines sont ouvertes simultanément
- Le fichier `lock.json` prévient l'édition concurrente (si les deux machines ont Supernote ouvert, la seconde reçoit un avertissement)
- La base SQLite peut se corrompre si Drive sync en cours d'écriture — Supernote détecte ça et se reindex automatiquement

**Recommandation :** utilise cette option si tu n'as jamais les deux machines ouvertes en même temps.

---

## Option 2 : Git (recommandé pour les devs)

Supernote utilise **isomorphic-git** pour un historique automatique dans le vault. Tu peux aussi synchroniser ce git avec un remote.

### Git local (historique seulement)

Par défaut, sans configuration, Supernote crée un git local dans `.supernote/.git/`. Commits automatiques toutes les 5 minutes si des changements ont eu lieu.

Ce git te permet de :
- Voir l'historique d'une note (clic droit > "Historique")
- Restaurer une version antérieure d'une entité
- Créer des branches "scratch" pour des brouillons

### Git avec remote (sync inter-machines)

1. Crée un dépôt git vide (GitHub, GitLab, Gitea, ou tout hébergeur git)
2. Settings > Vault > "Sync git" > "Configurer le remote"
3. Entre l'URL du remote (HTTPS ou SSH)
4. Supernote push après chaque commit auto

**Sur la deuxième machine :**
1. `git clone <url-du-remote> ~/Documents/Supernote/`
2. Ouvre le dossier dans Supernote

Supernote pull automatiquement au lancement et push après chaque commit. En cas de conflit (deux commits concurrents), Supernote affiche un diff et te demande de résoudre.

---

## Option 3 : Syncthing

[Syncthing](https://syncthing.net) est un outil de sync P2P décentralisé, open source, sans serveur central.

**Installation :**
```bash
# macOS
brew install syncthing

# Linux
sudo apt install syncthing

# Windows : télécharger l'installeur
```

**Configuration :**
1. Installe Syncthing sur tes deux machines
2. Ajoute le dossier vault dans Syncthing sur la première machine
3. Sur la deuxième machine, accepte le partage du dossier
4. Syncthing gère la sync en P2P direct (même réseau local = ultra rapide)

**Avantages :**
- Sync LAN très rapide (sans passer par internet)
- Pas de compte, pas de limite de stockage
- Chiffrement de bout en bout

**Avec Supernote :**
- Supernote détecte les changements via chokidar et se reindex
- Le `lock.json` prévient l'édition simultanée
- Si Syncthing sync un fichier pendant qu'il est ouvert dans Supernote, la bannière de conflit s'affiche

---

## Verrou multi-machine (lock.json)

Quand Supernote ouvre un vault, il crée/met à jour `.supernote/lock.json` :

```json
{
  "pid": 12345,
  "host": "MacBook-Pro-Jean",
  "timestamp": "2026-05-07T09:00:00Z",
  "heartbeat": "2026-05-07T09:05:00Z"
}
```

Si une deuxième instance essaie d'ouvrir le même vault et que le lock est frais (< 2 minutes sans heartbeat), elle affiche un avertissement : "Ce vault est peut-être ouvert sur MacBook-Pro-Jean. Ouvrir quand même ?"

Si l'instance précédente a crashé, le lock est considéré comme périmé après 2 × TTL (60 secondes par défaut) et est automatiquement ignoré.

---

## Résolution de conflits

Si un fichier a été modifié sur deux machines différentes :

- Git : Supernote affiche un diff côte à côte et te laisse choisir quelle version garder (ou les merger)
- Drive/Dropbox : le fichier en conflit est renommé (`Note (Conflicted copy 2026-05-07).md`) — Supernote détecte ce pattern et propose de résoudre
- Syncthing : même comportement que Drive/Dropbox (Syncthing crée un fichier `.sync-conflict-*`)

---

## Vaults multiples et machines multiples

Tu peux avoir plusieurs vaults sur la même machine et les sync différemment :

- Vault "Perso" → Syncthing avec ton Mac et ton Linux
- Vault "Travail" → Git avec remote GitHub privé
- Vault "Finance" → Pas de sync (reste en local seulement)

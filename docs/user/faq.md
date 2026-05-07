# FAQ — Questions fréquentes

## Installation et lancement

**Q : Supernote démarre mais affiche une page blanche.**
Lance `pnpm dev` depuis la racine du repo. La première fois, le build Next.js peut prendre 30-60 secondes. Attends que la console affiche "Ready".

**Q : J'ai une erreur "better-sqlite3 was compiled against a different Node.js version".**
Recompile les binaries natifs : `pnpm rebuild` depuis la racine. Si ça persiste : `node_modules/.bin/electron-rebuild`.

**Q : Supernote ne détecte pas mon vault Obsidian existant.**
Settings > Vaults > "Ajouter un vault" > sélectionne le dossier de ton vault Obsidian. Supernote ne modifie rien aux fichiers existants — il ajoute seulement `.supernote/` pour ses données internes.

---

## Vault et fichiers

**Q : Mes fichiers `.md` sont-ils en sécurité ? Est-ce que Supernote les modifie ?**
Supernote ne modifie que :
- Le frontmatter YAML (ajout de `id`, `type`, `updated`)
- Le fichier `lock.json` dans `.supernote/`
- La base `index.db` dans `.supernote/`

Le corps de tes notes n'est jamais modifié sans action de ta part. Les écritures sont atomiques (temp file + rename).

**Q : Ma base SQLite est corrompue. Comment récupérer ?**
Supprime `.supernote/index.db`. Au prochain lancement, Supernote recrée la base complète depuis les fichiers `.md`. Tes notes ne sont pas perdues — elles sont la source de vérité.

**Q : Où sont mes données si je désinstalle Supernote ?**
Dans ton vault — le dossier `~/Documents/Supernote/` (ou le chemin que tu as choisi). Supernote n'écrit rien ailleurs (sauf les logs dans le dossier `userData` de l'OS).

**Q : Puis-je ouvrir mes notes avec Obsidian en même temps ?**
Oui, les fichiers sont du markdown standard. Si les deux apps sont ouvertes simultanément, Supernote détecte les modifications externes via chokidar et reindex. Le `lock.json` n'empêche pas ça (il prévient seulement une deuxième instance de *Supernote* d'ouvrir le même vault).

---

## CRM

**Q : Comment fusionner deux fiches de la même personne ?**
Clic droit sur une Personne > "Fusionner avec..." > sélectionne l'autre fiche. Les relations et backlinks des deux fiches sont consolidés dans la fiche conservée.

**Q : Puis-je ajouter des champs custom aux contacts ?**
Oui. Settings > Schémas > Personne > "Ajouter un champ". Le champ apparaît sur toutes les fiches Personne existantes (valeur vide par défaut).

**Q : Les mentions `@Jean` créent-elles un lien bidirectionnel ?**
Oui. La fiche de Jean montre toutes les notes qui le mentionnent dans le panneau "Backlinks" / "Timeline".

---

## Finance

**Q : Est-ce que Supernote se connecte à mes comptes bancaires ?**
Non. Aucun accès bancaire, aucune credential. Tu mets à jour les soldes manuellement ou via import OFX/CSV.

**Q : Les prix live sont-ils disponibles pour les actions françaises ?**
Oui. Yahoo Finance couvre les places européennes (`.PA`, `.DE`, `.AM`…). Tape `MC.PA` pour LVMH, `AIR.PA` pour Airbus, etc.

**Q : Comment désactiver complètement le module finance ?**
Settings > Modules > décocher "Finance". Les fichiers `.md` des entités finance restent dans le vault mais les types n'apparaissent plus dans l'interface.

---

## IA et Ollama

**Q : L'auto-tagging fonctionne-t-il sans Ollama ?**
Oui. Sans Ollama, Supernote utilise les embeddings ONNX (all-MiniLM-L6-v2) pour comparer les tags existants par similarité cosine. C'est moins précis qu'avec un LLM mais ça marche.

**Q : Ollama est installé mais Supernote ne le détecte pas.**
Vérifie que le daemon tourne : `curl http://localhost:11434/api/version`. Si ça répond, redémarre Supernote. Si Ollama tourne sur un port différent, configure l'URL dans Settings > IA > "URL Ollama".

**Q : Combien de RAM consomme le modèle d'embeddings ONNX ?**
Le modèle all-MiniLM-L6-v2 pèse ~25 MB. Il tourne dans un worker thread Node.js et consomme environ 150-300 MB de RAM supplémentaire.

**Q : Est-ce que l'IA peut accéder à internet ?**
Non. Tout est local. Les embeddings ONNX et Ollama fonctionnent sans connexion réseau.

---

## Sync

**Q : Que se passe-t-il si j'ouvre le même vault sur deux machines en même temps ?**
La deuxième machine affiche un avertissement (lock.json). Si tu ignores l'avertissement et édites des deux côtés, tu risques des conflits. Résous-les avec l'outil de diff intégré.

**Q : Puis-je utiliser iCloud pour sync sur macOS ?**
Oui, mais avec précaution : iCloud peut modifier les fichiers pendant que Supernote écrit (race condition). Recommandation : utilise Syncthing ou git pour une sync plus fiable.

**Q : Git commit automatique — combien d'espace disque est utilisé ?**
Ça dépend de la taille de tes notes et de leur fréquence de modification. Git compresse efficacement le texte. Sur un vault de 1000 notes, attends-toi à ~50-100 MB pour un an d'historique.

---

## Plugins

**Q : Les plugins peuvent-ils lire toutes mes notes ?**
Uniquement les types d'entités que tu as explicitement accordés dans les permissions au moment de l'installation. Supernote affiche les permissions demandées avant chaque installation.

**Q : Un plugin peut-il crasher Supernote ?**
Non. Chaque plugin tourne dans une iframe isolée. Si le plugin crashe, seule son iframe est affectée. Supernote reste stable.

**Q : Puis-je écrire un plugin en TypeScript ?**
Oui, mais il doit être compilé en JavaScript vanilla avant installation. Le SDK (`@supernote/plugin-sdk`) fournit les types TypeScript.

---

## Performance

**Q : Supernote est lent sur mon vault de 5000 notes.**
- Vérifie que l'indexeur a terminé (barre de progression en bas à droite)
- Pour les très grands vaults, désactive la recherche sémantique en temps réel (Settings > Recherche > "Sémantique différée")
- Le graph view bascule automatiquement sur WebGL pour les vaults >5000 noeuds

**Q : Puis-je avoir plusieurs vaults ouverts simultanément ?**
Pas encore en v0.1. Un seul vault à la fois. La navigation multi-vault est prévue pour v0.2.

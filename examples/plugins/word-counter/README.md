# Word Counter

Plugin Supernote qui compte les mots de la note courante apres chaque sauvegarde.

## Fonctionnalites

- Se declenche automatiquement via le hook `afterSave`
- Ignore la syntaxe Markdown (blocs de code, liens, caracteres speciaux)
- Memorise le dernier compte entre les sessions (via Storage API)
- Commande "Compteur de mots : Actualiser" dans la palette ⌘K
- Notification discrete apres chaque sauvegarde

## Installation

Copiez le dossier dans votre vault :

```
<vault>/.supernote/plugins/com.supernote.word-counter/
  manifest.json
  index.js
```

Puis rechargez Supernote (Settings > Plugins > Actualiser).

## Utilisation

Le plugin fonctionne en arriere-plan. A chaque sauvegarde d'une note (⌘S),
une notification affiche le nombre de mots. Le resultat est aussi accessible
via la commande **"Compteur de mots : Actualiser"** dans la palette ⌘K.

## Developpement local

```bash
pnpm install
pnpm build
cp -r dist/ "<vault>/.supernote/plugins/com.supernote.word-counter/"
```

## Permissions requises

| Permission | Usage |
|---|---|
| `entities:read` | Lecture du corps de la note pour compter les mots |

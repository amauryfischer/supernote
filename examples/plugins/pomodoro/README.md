# Pomodoro Timer

Plugin Supernote qui ajoute un timer Pomodoro dans le panneau lateral.

## Fonctionnalites

- Timer 25 minutes de travail / 5 minutes de pause
- Boutons Demarrer, Pause, Reset
- Bascule manuelle entre mode Travail et mode Pause
- Notification systeme a la fin de chaque session
- Commande "Pomodoro : Reinitialiser le timer" accessible depuis la palette ⌘K

## Installation

Copiez le dossier dans votre vault :

```
<vault>/.supernote/plugins/com.supernote.pomodoro/
  manifest.json
  index.js
```

Puis rechargez Supernote (Settings > Plugins > Actualiser).

## Utilisation

1. Ouvrez le panneau lateral (icone Timer dans la barre laterale)
2. Cliquez **Demarrer** pour lancer le compte a rebours
3. Une notification apparait a la fin de chaque session
4. Cliquez **Changer de mode** pour basculer manuellement entre Travail et Pause

## Developpement local

```bash
pnpm install
pnpm build
cp -r dist/ "<vault>/.supernote/plugins/com.supernote.pomodoro/"
```

## Permissions requises

| Permission | Usage |
|---|---|
| `commands:register` | Enregistre la commande Reset dans la palette |
| `notifications:show` | Notification a la fin des sessions |

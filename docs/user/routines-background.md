# Routines en arrière-plan : limites navigateur + rattrapage

## Modèle d'exécution

Supernote est une PWA local-first. Le moteur de routines (`AutomationEngine`)
vit dans le **Web Worker** du vault. Conséquences directes :

| État de l'app                      | Engine actif | Cron évalués |
| ---------------------------------- | ------------ | ------------ |
| Onglet ouvert, focus               | Oui          | Toutes les 60 s |
| Onglet en arrière-plan             | Oui (throttle navigateur ≈ 1 Hz après 5 min) | Avec retard mais OK |
| Onglet fermé                       | Non          | Aucun |
| Navigateur fermé                   | Non          | Aucun |
| PC éteint                          | Non          | Aucun |

Pas de daemon serveur. Tout est dans le navigateur.

## Trois mécanismes complémentaires

### 1. Rattrapage au démarrage (toujours actif)

À chaque ouverture du vault, le worker examine chaque routine cron activée :

- calcule la **dernière occurrence cron** strictement avant `now`
- compare à la date du dernier `automation_run` persisté
- si l'occurrence prévue n'a pas été honorée → fire **une fois** avec payload
  `{ catchUp: true, missedAt: <date> }`

**Politique : la dernière occurrence manquée seulement**, pas le backlog
complet. Une routine horaire ne rejouera pas 168 fois après une semaine
d'absence.

Code : `apps/web/src/lib/vault-worker/worker.ts::runCatchUpCron`.

### 2. Periodic Background Sync (Chromium uniquement)

Sur Chrome / Edge / Brave, après **installation de la PWA** + permission
`periodic-background-sync` accordée par l'utilisateur, le navigateur peut
réveiller le Service Worker à intervalles d'au moins 12 h (desktop) ou 24 h
(mobile).

Comportement (`apps/web/public/sw.js::handlePeriodicSync`) :

- si une fenêtre PWA est ouverte → SW lui poste `AUTOMATION_PERIODIC_TICK`,
  le client relaie au vault worker qui exécute `engine.tickNow()` + un
  passage de rattrapage
- si aucune fenêtre n'est ouverte → notification silencieuse "Routines à
  exécuter — ouvrir l'app pour rattraper" ; un clic ouvre la PWA et le
  rattrapage au boot prend le relais

Limites :
- Firefox et Safari **ne supportent pas** Periodic Sync (mai 2025) → bénéfice
  Chromium seulement.
- La permission n'est pas demandable depuis l'app : le navigateur la décide
  selon des heuristiques d'engagement (installation PWA + usage régulier).
- L'intervalle réel est piloté par le navigateur. Compter sur 12–24 h, pas
  plus rapide.

### 3. Démarrage automatique au boot du PC

**Aucune API JS ne permet de configurer ça.** Le démarrage automatique se
configure côté OS / navigateur :

#### Chrome / Edge / Brave (Windows, macOS, Linux)

1. Installer la PWA (icône "Installer Supernote" dans la barre d'adresse).
2. Aller dans `chrome://apps` ou `edge://apps`.
3. Clic droit sur l'icône Supernote → cocher **"Lancer au démarrage"** /
   **"Run on OS Login"** (Chromium ≥ 96).

L'app s'ouvrira automatiquement à la session OS. Combinée au rattrapage au
boot, ça donne l'expérience : "j'allume mon PC, mes routines de la nuit
s'exécutent".

#### Linux (Brave / Chromium sans `chrome://apps` activé)

Créer un fichier `~/.config/autostart/supernote.desktop` :

```ini
[Desktop Entry]
Type=Application
Name=Supernote
Exec=brave-browser --app=https://<your-pwa-host>/?source=autostart
X-GNOME-Autostart-enabled=true
NoDisplay=false
Terminal=false
```

Remplacer `brave-browser` par `google-chrome`, `chromium`, etc.

#### Windows

1. `Win+R` → `shell:startup` → ouvre le dossier "Démarrage".
2. Glisser le raccourci de la PWA installée (créé automatiquement à l'install)
   dans ce dossier.

#### macOS

Préférences système → "Comptes utilisateurs" → "Ouverture" → glisser
l'application Supernote (depuis Launchpad / Applications après install) dans
la liste des éléments à lancer à l'ouverture de session.

## En résumé

| Couverture                                | Mécanisme |
| ----------------------------------------- | --------- |
| App ouverte                               | Tick 60 s natif |
| App fermée < 12 h                         | Rattrapage au prochain boot |
| App fermée plusieurs jours                | Rattrapage = dernière occurrence seulement (par design) |
| Chrome installé + permission Periodic Sync | Tentative de tick toutes les 12–24 h |
| PC redémarré                              | Démarrage auto OS + rattrapage au boot |

Si la fiabilité temporelle est critique (alarmes médicales, notifications
financières urgentes…), passer à une exécution **serveur** (daemon Node /
edge function) qui execute l'engine indépendamment du client. Hors scope
local-first.

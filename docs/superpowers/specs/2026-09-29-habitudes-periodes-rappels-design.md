# Habitudes : périodes, rappels push, refonte UI

*2026-09-29*

## Intention

- Pouvoir suivre des habitudes **N fois par jour, par semaine ou par mois**. Exemples : « 1× par semaine », « 3× par semaine », « 2× par mois ».
- Être **relancé par notification push** tant que l'objectif de la période n'est pas atteint. La cadence se règle par habitude : toutes les heures, toutes les 2 h, toutes les 3 h, 1× par jour ou désactivé, dans une plage horaire (défaut 8h–22h).
- Cocher **depuis la notification** avec un bouton « Fait ».
- Rendre l'écran plus lisible : une vue « aujourd'hui », des cartes allégées, un formulaire clair. Le mobile est traité dans le même geste.

Hors périmètre : choisir des jours fixes (« lundi et jeudi »), rappeler seulement certains jours de la semaine, cocher depuis la notification sans ouvrir l'app.

## Modèle de données

Les habitudes restent des entités `habit`. Quatre champs sont ajoutés dans `fields` :

| Champ | Type | Défaut à la lecture | Défaut à la création |
|---|---|---|---|
| `period` | `"day" \| "week" \| "month"` | `"day"` | `"day"` |
| `remindEvery` | `0 \| 1 \| 2 \| 3 \| 24` (heures, 0 = désactivé, 24 = 1× par jour) | `0` | `3` |
| `remindFrom` | entier 0–23 | `8` | `8` |
| `remindTo` | entier 0–23, ≥ `remindFrom` | `22` | `22` |

- `target` garde son nom et son sens général : le nombre de check-ins requis **par période**. Pour `day`, rien ne change.
- Les habitudes existantes lisent `remindEvery = 0`, donc aucune notification surprise après la mise à jour.
- `seed-default-types.ts` déclare les nouveaux champs pour les nouveaux coffres. Les coffres existants n'ont pas ces champs dans le schéma, car le seed fait un `INSERT OR IGNORE`. Les valeurs passent tout de même dans le JSON de l'entité. Aucune migration n'est nécessaire, parce que la page ne lit pas le schéma du type.
- `parseHabit` valide les valeurs et retombe sur les défauts.

### Sémantique des périodes (`habitData.ts`)

- **Semaine** : du lundi au dimanche, comme la grille. **Mois** : le mois calendaire local.
- `periodBounds(period, date)` renvoie le premier et le dernier jour de la période, en clés locales.
- `periodProgress(habit, today)` renvoie `{ done, target, complete }` : la somme des check-ins de la période en cours, comparée à `target`. C'est **la seule définition** de « fait / pas fait », utilisée à la fois par la vue aujourd'hui, le compteur d'en-tête, la carte et le calcul des rappels.
- **Check-in d'un jour** :
  - `day` : le cycle actuel, 0 → 1 → … → `target` → 0.
  - `week` et `month` : au plus 1 check-in par jour, donc 0 ↔ 1. Le bouton « aujourd'hui » coche ou décoche le jour.
- **Pixels** :
  - `day` : `dayLevel` inchangé.
  - `week` et `month` : un jour coché s'affiche plein (niveau 3), un jour vide reste vide.
- **Séries** :
  - `day` : inchangé.
  - `week` et `month` : nombre de périodes complètes consécutives. Comme aujourd'hui, la période en cours non terminée ne casse pas la série : elle ne l'allonge simplement pas encore.
- Le libellé d'objectif devient « 3× / semaine », « 1× / mois » ou « 8 verres / jour ».

## Rappels push

On réutilise l'infra existante, décrite dans `2026-09-23-notifications-pwa-design.md` : le client calcule les échéances des 7 prochains jours, le serveur les déclenche même quand l'app est fermée, dans le salon protégé.

### Serveur (`apps/web/push-backend.mjs`)

- Ajouter `"habit"` à `CATEGORIES` et à `SHARED`, parce que l'état d'une habitude est partagé par le salon : le dernier appareil qui envoie remplace la liste.
- **Trier les lignes par `fireAt` avant `.slice(0, MAX_ROWS)`**. La troncature reste arbitraire pour toutes les catégories. Avec ce tri, ce sont les rappels les plus lointains qui tombent.
- `MAX_ROWS` reste à 200 par catégorie. Une habitude horaire 8h–22h produit 15 créneaux par jour, soit 105 lignes sur 7 jours. Au-delà de deux habitudes horaires, l'horizon raccourcit, mais il est rechargé à chaque ouverture de l'app. Plafond assumé, marqué `ponytail:`.

### Client

- `push-client.ts` : ajouter `"habit"` à `PushCategory`.
- `PushScheduleRunner.computeSchedule`, **après** le garde `mirrorAvailable()` (lecture des habitudes via `trpcVanillaClient.entities.list({ typeId: "habit" })`) :
  - Pour chaque habitude non archivée avec `remindEvery > 0`, et pour chaque jour de l'horizon :
    - Si la période qui contient ce jour est **déjà complète maintenant**, on saute le jour.
    - Sinon, on génère les créneaux `remindFrom`, `remindFrom + remindEvery`, … jusqu'à `remindTo` inclus. Avec `24`, un seul créneau à `remindFrom`.
    - On ne garde que les créneaux où `now < fireAt ≤ now + 7 j`.
  - Les heures sont calculées en heure locale côté client. Le serveur ne connaît pas le fuseau.
  - Ligne produite : `key = "habit:<id>"`. Plusieurs `fireAt` peuvent partager la même clé, car l'index unique est `(vault, key, fireat)`. Autres champs : `title = "<icône> <nom>"`, `body` (« Pas encore fait aujourd'hui », « 1/3 cette semaine », « 0/2 ce mois-ci »), `url = "/habits?habit=<id>"`, `joinUrl = ""`.
- Le filtre `ENTITY_CHANGE` du runner écoute aussi `typeId === "habit"`. Cocher recalcule donc la liste, avec un debounce de 10 s, et retire les créneaux devenus inutiles.
- Le serveur pose `tag = key` : un nouveau rappel de la même habitude **remplace** le précédent au lieu de s'empiler.

### Bouton « Fait » (`public/sw.js` et `page.tsx`)

- `push` : si `url` commence par `/habits?habit=`, la notification reçoit `actions: [{ action: "done", title: "Fait" }]`.
- `notificationclick` avec `action === "done"` : on suit le chemin de navigation existant, vers `url + "&done=1"`.
- `/habits` : un effet attend que `source.habits` soit chargé. Il lit `habit` et `done`, applique **un** check-in du jour à cette habitude si sa période n'est pas complète, puis efface les paramètres avec `history.replaceState`, ce qui évite une double coche au re-rendu. Sans `done`, le paramètre `habit` fait défiler jusqu'à la carte concernée et la met en évidence.
- iOS n'affiche pas les boutons d'action : le tap ouvre `/habits?habit=<id>`.

### Prérequis et déploiement

- Le push exige un salon de synchro protégé et les notifications activées. Rien ne change sur ce point.
- Un client qui envoie la catégorie `habit` à un serveur qui ne la connaît pas est ignoré sans erreur. On déploie le serveur et le client ensemble.

## UI

Cette section repose sur un audit fait sur rendu réel, à 1280 px et 390 px. Les problèmes retenus :
- rien ne dit ce qui reste à faire aujourd'hui ;
- les cartes affichent 5 chiffres, une grille de 7 rangées et une légende ;
- une grille de jours fait passer « 3× / semaine » pour un échec ;
- la modale maison n'est pas accessible, et elle supprime sans confirmation ;
- une erreur de chargement s'affiche comme « Aucune habitude » ;
- `#fff` est codé en dur sur la couleur de l'habitude.

### Page `/habits`

```
Habitudes · 2 restantes                         [Nouvelle habitude]
AUJOURD'HUI
 ◔ 💧 Boire de l'eau      3/8 verres             [+]
 ○ 🧘 Méditation          0/1                    [+]
CETTE SEMAINE
 ○ 🏃 Sport               1/3 · 4 j restants     [+]
CE MOIS
 ○ 📞 Appeler mamie       0/2                    [+]
 ✓ Fait (2) ▸                                    (repliable)
─────────────────────────────────────────────────────────────
TOUTES LES HABITUDES
 [💧] Boire de l'eau          🔥 12    8 verres / jour · 🔔 3 h   [⋯]
      ▮▮▯▮▮▮▯▮▮▮▮▮▮▯▮▮▮▮▯▮▮▮▮▮▮▮▮▮   (bande d'une rangée)
      ▸ Historique                       (dépliable : grille annuelle + stats)
```

- **Vue « aujourd'hui »** (`HabitsToday.tsx`, nouveau fichier) :
  - Les habitudes non archivées sont groupées par période : *Aujourd'hui* (`day`), *Cette semaine*, *Ce mois*. Un groupe vide est masqué.
  - Chaque ligne se touche en entier (≥ 44 px). Le tap applique le même cycle que le bouton du jour actuel.
  - Les habitudes dont la période est complète tombent dans « Fait (n) », replié. Quand tout est fait : une ligne calme, « Tout est fait pour aujourd'hui », sans fanfare.
  - Le compteur d'en-tête devient « N restantes » : les habitudes dont `periodProgress` n'est pas complet.
- **Carte allégée** (`HabitCard.tsx`) :
  - On garde : tuile emoji, nom, série en cours, libellé d'objectif et de rappel, menu `⋯` (Modifier / Archiver / Supprimer).
  - La **bande** est une seule rangée avec une cellule par période : les 28 derniers jours pour `day`, les 16 dernières semaines pour `week`, les 12 derniers mois pour `month`. L'intensité de chaque cellule vient de `periodProgress` sur cette période, via une fonction `periodStrip(habit, today, n)` dans `habitData.ts`.
  - « Historique » déplie dans la carte la grille annuelle existante (`PixelGrid`, qui garde la correction d'un jour passé) et les stats : record, total, taux. Pas de page de détail.
  - La légende « Moins / Plus » disparaît.
  - Le bouton rond du jour quitte la carte : cocher se fait dans la vue aujourd'hui.
- **Libellés de mois de `PixelGrid`** : le débord à gauche est corrigé comme celui de droite.
- **Contraste** : le texte ou l'icône posé sur la couleur de l'habitude utilise un premier plan calculé par luminance (`readableOn(color)`), plus jamais `#fff`.
- **États** : `useHabitsSource` expose `isError`, et la page affiche alors « Impossible de charger les habitudes » avec un bouton Réessayer. Le badge « mode local » passe au `Badge` de `@supernote/ui`.
- **Mobile** :
  - Le sous-titre du shell affiche « N restantes ».
  - La vue aujourd'hui passe en premier, pleine largeur, avec des lignes de 48 px.
  - Les cartes s'empilent sur une colonne. La bande tient en largeur sans scroll horizontal : les cellules se partagent la largeur.
  - Le FAB reste inchangé.

### Formulaire (`HabitModal.tsx`)

- Il passe au `Modal` de `@supernote/ui`, ce qui apporte le focus piégé et Échap. Sur mobile, il s'ouvre en plein écran, comme `EventEditorModal`, avec un pied de page collant.
- Ordre des champs :
  1. **Nom** : `Input`, avec autofocus.
  2. **Objectif**, écrit comme une phrase : `[nombre]` `[unité optionnelle]` par `[Jour | Semaine | Mois]`. Le nombre est un `Input type=number`, de 1 à 50. La période utilise les `Tabs` de `@supernote/ui` en contrôle segmenté.
  3. **Rappel** :
     - `Select` : Désactivé / Toutes les heures / Toutes les 2 h / Toutes les 3 h / 1× par jour.
     - Si le rappel est actif : deux `Select` d'heures pour la plage, « de 8 h » « à 22 h ». Avec « 1× par jour », seul « à 8 h » s'affiche.
     - Une phrase d'aide se met à jour en direct : « Rappel toutes les 3 h de 8 h à 22 h tant que 3/3 cette semaine n'est pas atteint ».
     - Si les notifications ne sont pas activées ou si aucun salon protégé n'existe, une ligne d'avertissement renvoie vers Réglages → Notifications. L'enregistrement reste possible.
  4. **Apparence**, repliée : les emoji existants et les pastilles de couleur, réduites à ~8 teintes.
- En édition, Archiver et Supprimer passent dans le menu `⋯` de la carte, hors de la modale. **Supprimer demande une confirmation** via `useConfirm`, qui existe déjà.
- Aucun nouveau wrapper dans `@supernote/ui` : `Modal`, `Tabs`, `Select`, `Input`, `Badge`, `DropdownMenu` et `useConfirm` suffisent.

### Hors périmètre UI

- Remplacer le cycle 0 → cible → 0 par un menu pour décocher.
- Les icônes phosphor à la place des emoji. Les données existantes sont des emoji, on les garde.

## Vérification

- `pnpm typecheck`.
- e2e Playwright : un scénario sur `/habits`, en mode cloud avec `bootCloud`. Il crée une habitude « 1× / semaine », la coche, vérifie la vue aujourd'hui et le libellé, puis ouvre `/habits?habit=<id>&done=1` et vérifie que le check-in est appliqué une seule fois.
- Push : non couvert par les e2e. On vérifie à la main après déploiement sur Scalingo : une habitude avec un rappel toutes les heures, puis le bouton « Fait » sur Android.

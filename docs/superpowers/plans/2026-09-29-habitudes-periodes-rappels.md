# Habitudes : périodes, rappels push, refonte UI — plan d'implémentation

> **Pour les exécutants :** chaque tâche 2-4 est un ticket Sidequest indépendant qui part de `feat/habitudes-periodes`. Lis la spec en entier avant de coder.

**But :** des habitudes N fois par jour/semaine/mois, relancées par push tant que la période n'est pas tenue, avec une page `/habits` refondue (vue aujourd'hui, cartes allégées, formulaire clair).

**Architecture :** le modèle pur vit dans `apps/web/src/lib/habits/habitData.ts` (tâche 1, **déjà livrée**, commit `0d06ecb`). L'UI le consomme ; `PushScheduleRunner` en tire des lignes `habit` qu'il envoie au backend push existant ; le SW ajoute un bouton « Fait » qui rouvre `/habits?habit=<id>&done=1`.

**Stack :** React 19 + Vite, `@heroui/react` v3 via `@supernote/ui`, tRPC vers le vault worker, Node `server.mjs` + Postgres pour le push, Playwright.

**Spec :** `docs/superpowers/specs/2026-09-29-habitudes-periodes-rappels-design.md`

## Contraintes globales

- Politique **zéro test unitaire** : pas de `*.test.ts`, pas de vitest. Vérif = `pnpm typecheck` + e2e Playwright.
- UI : composants de `@supernote/ui` (`Modal`, `Tabs`, `Select`, `Input`, `Badge`, `DropdownMenu`, `Button`, `Tooltip`) ou `@heroui/react` ; pas de `<button>/<input>/<select>` nus. Pièges d'API : `Button` sans `startContent` (icône en enfant), défaut = solide accent ; `Input` brut sans `label`.
- Mobile dans le même geste : < 768 px, hit-targets ≥ 32 px (lignes de la vue aujourd'hui ≥ 44 px desktop, 48 px mobile), pas de scroll horizontal de page.
- Jamais `#fff` en dur sur la couleur d'une habitude : `readableOn(color)`.
- Commentaires : seulement le pourquoi non déductible, en français, une ligne.
- Pas de toast de succès (`lib/action-feedback.tsx`) ; toast seulement pour une erreur.
- Ne pas commit sur `main`. Commits conventionnels français sur la branche du ticket.
- Worktree neuf : `pnpm install`, `pnpm --filter @supernote/db db:generate`, `pnpm build:packages` avant tout typecheck.

## Contrat de la tâche 1 (livré, à consommer tel quel)

`apps/web/src/lib/habits/habitData.ts` exporte, en plus de l'existant :

```ts
type HabitPeriod = "day" | "week" | "month";          HABIT_PERIODS
type RemindEvery = 0 | 1 | 2 | 3 | 24;                 REMIND_EVERY
interface Habit { …; period; target; remindEvery; remindFrom; remindTo; … }
periodStart(period, d): Date
addPeriods(period, start, n): Date
periodProgress(habit, date): { done; target; complete }   // seule définition de « fait »
nextDayCount(habit, count): number                          // remplace cycleCount côté UI
habitDayLevel(habit, count): 0|1|2|3|4                      // remplace dayLevel côté UI
habitStreaks(habit, today): { current; best }               // remplace computeStreaks
habitStats(habit, today): { total; rate; windowLabel }      // remplace computeStats
periodStrip(habit, today, n): { key; level; complete; label }[]
STRIP_LENGTH: Record<HabitPeriod, number>                   // 28 / 16 / 12
goalLabel(habit), remindLabel(habit), progressLabel(habit, today): string
reminderSlots(habit, now, horizonMs): number[]              // ms, heure locale, archivées/0 → []
readableOn(hex): "#111111" | "#ffffff"
```

Les anciens `computeStreaks`, `computeStats`, `isDayComplete`, `cycleCount`, `dayLevel` restent exportés tant que la tâche 4 ne les a pas débranchés ; la tâche 4 supprime ceux qui n'ont plus d'appelant.

## Review Focus

1. **Double coche via `?done=1`** : un re-rendu, un HMR ou un retour arrière ne doit appliquer qu'un check-in → e2e tâche 5.
2. **`done=1` sur une période déjà tenue** : aucun check-in ajouté (sinon une hebdo 1× passe à 2) → e2e tâche 5.
3. **Habitude archivée ou supprimée** : plus aucun rappel envoyé au prochain calcul (`reminderSlots` renvoie `[]` pour archivée ; une supprimée n'est plus listée) → vérif dans la tâche 3.
4. **Plage incohérente** (`remindTo < remindFrom`) : le formulaire l'empêche ; `parseHabit` la corrige déjà → tâche 2.
5. **Aucun coffre / mode dégradé** : la page reste utilisable (localStore), le runner n'envoie pas de catégorie `habit` vide qui effacerait celle du salon → tâche 3.

---

### Tâche 2 : formulaire `HabitModal`

**Fichiers :** modifier `apps/web/src/components/habits/HabitModal.tsx`.

**Interfaces produites (consommées par la tâche 4) :**
```ts
export interface HabitFormValues {
  name: string; icon: string; color: string;
  period: HabitPeriod; target: number; unit: string;
  remindEvery: RemindEvery; remindFrom: number; remindTo: number;
}
interface HabitModalProps {
  open: boolean;
  initial: Habit | null;          // null = création
  isMobile: boolean;
  onSave: (values: HabitFormValues) => void;
  onCancel: () => void;
}
```
Les props `onArchiveToggle` / `onDelete` **disparaissent** : Archiver/Supprimer passent dans le menu `⋯` de la carte (tâche 4).

- [ ] Remplacer l'overlay maison par `Modal` de `@supernote/ui` : `isOpen={open}`, `onOpenChange={(o) => !o && onCancel()}`, `size={isMobile ? "full" : "md"}`, `title`, `footer` = Annuler (`variant="outline"`) + Créer/Enregistrer (`variant="primary"`). Supprimer l'écoute Échap sur `window` (le Modal la gère).
- [ ] Champs dans cet ordre : Nom (`Input`, autofocus, Entrée = soumettre) ; Objectif en phrase `[Input number 1-50] [Input unité] par [Tabs items Jour/Semaine/Mois, selectedKey=period]` ; Rappel (`Select` options `0` « Désactivé », `1` « Toutes les heures », `2` « Toutes les 2 h », `3` « Toutes les 3 h », `24` « 1× par jour ») ; si actif, `Select` « de » heures 0-23 et, sauf pour `24`, `Select` « à » limité aux heures ≥ « de » ; phrase d'aide construite avec `remindLabel` + `goalLabel` d'un `Habit` temporaire (ex. « Rappel toutes les 3 h de 8 h à 22 h tant que 3× / semaine n'est pas tenu ») ; « Apparence » repliée (bouton `ghost` qui bascule un état) contenant les emoji existants + 8 pastilles `COLOR_PRESETS.slice(0, 8)`.
- [ ] Défauts de création : `period "day"`, `target 1`, `remindEvery 3`, `remindFrom 8`, `remindTo 22`. En édition : valeurs de `initial`.
- [ ] Si `remindEvery > 0` et (`typeof Notification === "undefined"` ou `Notification.permission !== "granted"` ou `!useOnlineSync()?.config.token`) : une ligne d'avertissement « Active les notifications et protège ton salon dans Réglages → Notifications pour recevoir ces rappels. » — n'empêche pas d'enregistrer.
- [ ] `submit` : nom vide → focus nom ; `remindTo = Math.max(remindFrom, remindTo)` ; `clampTarget` conservé.
- [ ] `pnpm --filter web typecheck` : les seules erreurs admises sont dans `app/habits/page.tsx` (props retirées), corrigées par la tâche 4. Dans ce ticket, adapter `page.tsx` au **minimum** pour compiler : retirer `onArchiveToggle`/`onDelete` du second `HabitModal`, passer `isMobile`, et étendre les objets de `handleCreate`/`handleUpdate` avec `period, remindEvery, remindFrom, remindTo` — rien d'autre dans `page.tsx`.
- [ ] Commit `feat(habits): formulaire en Modal avec période et rappels`.

### Tâche 3 : rappels push + bouton « Fait » côté SW

**Fichiers :** modifier `apps/web/push-backend.mjs`, `apps/web/src/lib/push/push-client.ts`, `apps/web/src/lib/push/PushScheduleRunner.tsx`, `apps/web/public/sw.js`, et étendre `tests/e2e/07-push.spec.ts`.

- [ ] `push-backend.mjs` : `CATEGORIES` += `"habit"`, `SHARED` += `"habit"`. Dans `PUT /api/push/schedule`, trier avant de plafonner :
  ```js
  .filter(Boolean)
  .sort((a, b) => a.fireAt - b.fireAt)
  // ponytail: 200 lignes par catégorie ; au-delà de deux habitudes horaires l'horizon raccourcit, rechargé à l'ouverture de l'app.
  .slice(0, MAX_ROWS);
  ```
- [ ] `push-client.ts` : `PushCategory` += `"habit"`.
- [ ] `PushScheduleRunner.computeSchedule`, **après** le garde `if (!mirrorAvailable()) return schedule;` :
  ```ts
  const { items } = await trpcVanillaClient.entities.list.query({ typeId: HABIT_TYPE_ID, limit: 1000, offset: 0 });
  const nowDate = new Date(now);
  schedule.habit = items.map(parseHabit).flatMap((h) =>
    reminderSlots(h, nowDate, HORIZON_MS).map((fireAt): PushScheduleRow => ({
      key: `habit:${h.id}`,
      fireAt,
      title: `${h.icon} ${h.name}`,
      body: progressLabel(h, new Date(fireAt)),
      url: `/habits?habit=${encodeURIComponent(h.id)}`,
      joinUrl: "",
    })),
  ).sort((a, b) => a.fireAt - b.fireAt);
  ```
  (vérifier la forme réelle de retour de `entities.list` comme dans `useHabitsSource`.)
- [ ] Filtre `ENTITY_CHANGE` : `m.op?.payload?.typeId === "todo" || m.op?.payload?.typeId === HABIT_TYPE_ID`.
- [ ] `sw.js`, handler `push` : `actions` = `joinUrl` ? « Rejoindre » : `payload.url.startsWith("/habits?habit=")` ? `[{ action: "done", title: "Fait" }]` : `[]`.
- [ ] `sw.js`, `notificationclick` : si `event.action === "done"`, `target = internalPath(url) + "&done=1"` puis **même chemin** que le clic normal (focus + navigate, ou openWindow).
- [ ] e2e `07-push.spec.ts` : livrer un push `{ title: "✅ Lire", body: "Pas encore fait aujourd'hui", url: "/habits?habit=abc", tag: "habit:abc" }` et vérifier via `registration.getNotifications()` que l'action `done` est présente (s'inspirer du test existant qui lit les notifications).
- [ ] Vérif manuelle documentée dans le ticket : habitude archivée → `reminderSlots` renvoie `[]` (déjà dans le modèle) ; mode dégradé → `mirrorAvailable()` faux, pas de clé `habit` envoyée.
- [ ] `pnpm --filter web typecheck` + `pnpm test:e2e tests/e2e/07-push.spec.ts`.
- [ ] Commit `feat(push): rappels d'habitudes et action « Fait »`.

### Tâche 4 : page `/habits` — vue aujourd'hui, cartes allégées, `?done=1`

**Fichiers :** créer `apps/web/src/components/habits/HabitsToday.tsx` ; modifier `apps/web/src/app/habits/page.tsx`, `HabitCard.tsx`, `PixelGrid.tsx`, `useHabitsSource.ts`, `habits.css` si besoin ; nettoyer les exports morts de `habitData.ts`.

**Interfaces consommées :** contrat tâche 1 ; `HabitFormValues` et `HabitModalProps` de la tâche 2 (si la tâche 2 n'est pas encore fusionnée, coder contre la forme décrite ci-dessus : `isMobile`, sans `onArchiveToggle`/`onDelete`).

- [ ] `useHabitsSource` : exposer `isError: boolean` (`!degraded && query.isError`) et `refetch: () => void`.
- [ ] `page.tsx` :
  - `handleCycleDay(habit, dateKey)` utilise `nextDayCount` ; jalon de série via `habitStreaks(...).current` + `isStreakMilestone`, seulement si la période vient d'être complétée.
  - Compteur « N restantes » = habitudes non archivées dont `!periodProgress(h, today).complete` ; même valeur dans `useMobileTitle`.
  - État d'erreur : « Impossible de charger les habitudes » + `Button` « Réessayer » → `source.refetch()`.
  - Badge « mode local » → `Badge` de `@supernote/ui`.
  - Effet `?habit=&done=1` : quand `!source.isLoading` et l'habitude trouvée, lire `new URLSearchParams(location.search)` ; appeler `history.replaceState(null, "", "/habits")` **avant** d'appliquer ; si `done === "1"` et `!periodProgress(h, new Date()).complete`, appliquer `nextDayCount` au jour courant **seulement si** le résultat est > compteur actuel ; sans `done`, `scrollIntoView` de la carte (`id={"habit-" + h.id}`) + mise en évidence 1,5 s. Une ref garde contre une seconde exécution.
  - Archiver / Supprimer reçoivent l'habitude en argument (menu de carte) ; Supprimer passe par `useConfirm()` (`variant: "danger"`, titre « Supprimer « {nom} » ? », corps « L'historique de cette habitude sera perdu. »).
  - Mise en page : `HabitsToday` au-dessus, puis « Toutes les habitudes » (grille `lg:grid-cols-2`), archivées repliées comme aujourd'hui.
- [ ] `HabitsToday.tsx` : props `{ habits: Habit[]; onCheck: (habit: Habit) => void }`. Groupes `day` « Aujourd'hui », `week` « Cette semaine », `month` « Ce mois » (masqués si vides) ; ligne = `Button variant="ghost"` pleine largeur, `min-h-11 md:min-h-11` et `min-h-12` sous 768 px, contenu : anneau de progression (conic-gradient existant, premier plan `readableOn`), emoji, nom, `progressLabel`, pour `week`/`month` « · N j restants » (jours jusqu'à la fin de période). Tap → `onCheck(habit)` (le parent applique `nextDayCount` sur aujourd'hui). Les complètes vont dans « Fait (n) » replié (bouton ghost qui bascule). Tout fait : ligne « Tout est fait pour aujourd'hui. ». `aria-label` explicite par ligne.
- [ ] `HabitCard.tsx` : retirer le bouton rond du jour, le trophée en en-tête et le footer stats/légende. Garder tuile emoji, nom, `🔥 habitStreaks.current`, sous-titre `goalLabel` + (si rappel) `· 🔔 remindLabel`, menu `DropdownMenu` `⋯` (Modifier / Archiver ou Désarchiver / Supprimer `isDanger`), trigger = bouton icône avec `Tooltip` + `aria-label`. Bande `periodStrip(habit, today, STRIP_LENGTH[period])` : une rangée en `grid` de `n` colonnes égales (`grid-template-columns: repeat(n, minmax(0,1fr))`, hauteur 12 px, `title` = label), couleurs comme `cellBackground`. Bouton « Historique » (ghost) qui déplie `PixelGrid` + une ligne `record {best} · {total} validé(e)s · {rate} % sur {windowLabel}`.
- [ ] `PixelGrid.tsx` : niveau via `habitDayLevel(habit, count)` (passer `habit` en prop au lieu de `checkins/target`) ; clic via `onCycleDay(key)` inchangé ; libellés de mois qui débordent à gauche : ne pas afficher un libellé dont la colonne est < 2 (même traitement que le débord droit existant).
- [ ] Supprimer de `habitData.ts` les exports devenus sans appelant (`computeStreaks`, `computeStats`, `isDayComplete`… — `grep -rn` avant).
- [ ] `pnpm --filter web typecheck` ; contrôle visuel desktop 1280 et mobile 390 (captures dans le ticket).
- [ ] Commit `feat(habits): vue aujourd'hui, cartes allégées, coche depuis la notification`.

### Tâche 5 : intégration et e2e (orchestrateur)

- [ ] Fusionner les candidats des tâches 2, 3, 4 dans `feat/habitudes-periodes` (`git merge --no-ff`), résoudre `page.tsx` (la version de la tâche 4 prime, avec les champs de la tâche 2).
- [ ] Créer `tests/e2e/14-habits.spec.ts` (`bootCloud`) :
  1. Créer « Sport » 1× / semaine via le formulaire ; la vue aujourd'hui l'affiche sous « Cette semaine » avec « Pas encore fait cette semaine ».
  2. Taper la ligne → passe dans « Fait (1) » ; la carte affiche « 1× / semaine ».
  3. Créer « Lire » (jour) ; récupérer son id via le worker ; `goto("/habits?habit=<id>&done=1")` → ligne « Lire » complète, URL nettoyée ; recharger `/habits` → toujours 1 check-in (pas 2).
  4. `goto("/habits?habit=<id Sport>&done=1")` alors que la semaine est tenue → toujours « 1/1 » (pas de décoche).
- [ ] `pnpm typecheck` + `pnpm test:e2e tests/e2e/14-habits.spec.ts tests/e2e/07-push.spec.ts`.
- [ ] Mettre à jour la carte du codebase si nécessaire ; demander à l'utilisateur avant tout merge sur `main` / déploiement.

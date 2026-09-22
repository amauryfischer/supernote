# Planifier les todos dans l'agenda — plan d'implémentation

> **Pour les agents :** exécuter tâche par tâche (superpowers:subagent-driven-development). Étapes en cases `- [ ]`.

**Objectif :** réserver du temps pour une tâche (todo, email todo, ligne `- [ ]` de note) en créant un vrai événement Google Agenda lié, par glisser-déposer sur `/agenda` (ordinateur) ou par une feuille « Planifier » (téléphone et ordinateur).

**Architecture :** le lien tâche ↔ bloc vit uniquement sur l'événement Google (`extendedProperties.private.supernoteRef`), recopié dans une nouvelle colonne `cal_event.sourceRef` du miroir ; la création passe par l'outbox existante (`useEventWrites.create`). « Planifié » est dérivé : `useScheduledBlocks` lit le miroir (aujourd'hui → J+60) et indexe le prochain bloc par référence, `useSchedulableTasks` fusionne les trois sources de tâches. Le tiroir, le dépôt sur `TimeGrid`, la feuille `ScheduleTaskSheet` et les points d'entrée de `/todos` consomment ces deux hooks.

**Stack :** React 19 + react-router, tRPC (`@supernote/ipc`, zod v4), SQLite wasm dans le worker, `@tanstack/react-query`, HeroUI v3 / `@supernote/ui`, glisser-déposer HTML5 natif, Google Calendar API v3, Playwright.

**Spec :** docs/superpowers/specs/2026-09-22-planifier-todos-agenda-design.md

## Contraintes globales

- Lien porté par l'événement seul : `extendedProperties.private.supernoteRef` ; rien n'est écrit dans le todo, le fil mail ni la ligne markdown.
- Formats de référence : `todo:<entityId>`, `mail:<threadId>`, `checklist:<noteId>:<hash>` où `<hash>` = suffixe djb2 du `blockId` (`extractChecklists.ts:118`), **sans** l'index de ligne.
- Miroir : `cal_event.sourceRef TEXT NOT NULL DEFAULT ''` dans le `CREATE TABLE` et en migration `ALTER TABLE` idempotente.
- `extendedProperties` n'est envoyé qu'à la **création** (PATCH fusionne côté Google).
- Bloc créé : agenda **principal**, sinon premier agenda `writer` ; sans invités ni Meet ; durée par défaut **30 min** ; description = lien vers la source (URL Supernote, ou lien web Gmail).
- Carte des blocs : `calListEvents(accountId, début du jour, +60 j)` ; une tâche est « à planifier » si aucun bloc qui la référence ne finit après maintenant.
- Créneaux libres : **3** créneaux de **30 min**, départ = maintenant arrondi au quart d'heure suivant, entre **9 h et 18 h**, jours suivants si la journée est pleine ; événements sur la journée entière et déclinés ne bloquent pas. Constante marquée `ponytail:`.
- Autre créneau : date, heure de début, durée **30 min / 1 h / 2 h**.
- Grille : aperçu de 30 min au survol, magnétisme au quart d'heure (`SNAP_MIN = 15` existant).
- Tiroir « À planifier » : vues Jour et Semaine, ordinateur seulement, ouvert/fermé mémorisé en `localStorage`, groupé par quadrant (urgent et important en tête, quadrants vides masqués), compteur.
- UI : HeroUI v3 via `@supernote/ui` ; bouton icône = icône phosphor + `Tooltip` de `@supernote/ui` + `aria-label` ; natif seulement pour le glisser HTML5 (`draggable`), avec une ligne de commentaire du pourquoi.
- Pas de toast de succès : retour porté par le bouton (`lib/action-feedback.tsx`), erreur en `role="alert"` dans la feuille ; toast seulement pour l'échec d'un dépôt (aucun contrôle d'origine).
- Mobile dans le même mouvement : `useIsMobile`, `MobileSheet`, `useMobileHeaderActions` ; cibles ≥ 32 px ; aucun débordement horizontal à 360 px.
- TypeScript strict, pas de `any` (`noUncheckedIndexedAccess` actif : défauts sur les destructurations d'index).
- Commentaires : quasi aucun ; seulement le pourquoi non déductible, en français, une ligne.
- **Zéro test unitaire** : pas de vitest, pas de `*.test.ts`. Vérification = `pnpm typecheck` + e2e Playwright (`tests/e2e/`). Les fichiers `tests/` ne sont pas typecheckés.
- `@supernote/ipc` est consommé via `dist/` : `pnpm --filter @supernote/ipc build` avant tout typecheck qui dépend du schéma.
- Pas d'étape de commit (l'utilisateur commit sur demande) ; chaque tâche finit sur un point de contrôle.
- Arbre partagé : `TodoMatrix.tsx`, `lib/gmail.ts`, `lib/mail-mirror.ts` ont des modifs non commitées d'une autre session. `gmail.ts` et `mail-mirror.ts` sont seulement importés ; `TodoMatrix.tsx` reçoit trois `export` par édition ciblée, sans toucher ses hunks l.165 et l.199.

## Divergences spec ↔ code (constatées à la lecture)

| Spec | Code réel | Décision du plan |
|---|---|---|
| « `sourceRef` dans le `SELECT` de `listEvents` » | `SELECT e.*` (`calendar-routes.ts:149`) | seul `toEventRow` (l.53-76) change |
| Migration « sur le modèle de `worker.ts:200` » | bloc `mail_thread` à `worker.ts:207-226`, exécuté **avant** `SCHEMA_SQL` (l.228) : sur un coffre neuf l'`ALTER` vise une table absente | insertion après l.226, gardée par `names.length > 0` |
| `scheduleTask({ ref, title, sourceUrl, startAt, endAt })` | `useEventWrites(accountId)` ne connaît pas les agendas | `sourceUrl` dérivé de `ref` ; agenda résolu dans `scheduleTask` via `calListCalendars` |
| `unscheduleTask(event)` | `remove(event)` existe (`useEventWrites.ts:150`) et passe par l'outbox | on appelle `remove`, pas d'alias |
| `useSchedulableTasks` → `{ ref, title, quadrant, done, openSource }` | la liste ne contient que des tâches ouvertes | `{ ref, title, quadrant, block }` + `taskSourcePath(ref)` pur |
| « `/todos` avec le todo en édition » | aucun paramètre d'URL dans `app/todos/page.tsx` | ajout de `?edit=<id>` (tâche 9) |
| Menu `/todos` au téléphone « par appui long, mécanisme existant de `TodoRow` » | l'appui long de `TodoRow` (`TodoRow.tsx:137`) entre en **mode sélection** (`page.tsx:781`) ; dans la matrice il lance le glisser dnd-kit (250 ms) ; le menu ne s'ouvre que sur l'événement natif `contextmenu` (Android oui, iOS non) | menu inchangé ; entrées mobiles garanties : bouton « Planifier… » dans `EditTodoModal` (tâche 14, étape 6) et action d'en-tête de `/agenda` |
| Rendu tâche sur `EventBlock` | la vue Liste (vue mobile par défaut) rend son propre bouton (`AgendaList.tsx:52-78`) | icône et barré ajoutés aussi dans `AgendaList` |
| Lignes d'email todo dans `/todos` | elles n'existent que dans la vue Matrice (`page.tsx:1512`) | « Planifier… » et « Ouvrir le fil » y sont branchés |
| `resolveOutbox` conserve `sourceRef` | à l'acquittement, la ligne est **remplacée** par `toEventInput(réponse Google)` (`calendar-sync.ts:131` → `calendar-routes.ts:260`) ; le body n'est pas reconstruit (`calendar-sync.ts:113-118` → `gcal.ts:124-131`) | `sourceRef` survit parce que Google renvoie `extendedProperties` et que `toEventInput` le lit (tâche 1) |
| Emails todo « via `useMailTodos` » | son effet (`useMailTodos.ts:70-100`) relit 500 fils du miroir à chaque montage et lance `syncMailbox` si un jeton Gmail est en cache ; il n'expose pas d'état de chargement | accepté : ouvrir `/agenda` déclenche un delta Gmail ; un bloc `mail:` peut paraître barré le temps que les fils arrivent |
| Mock e2e | le PATCH du mock (`04-agenda.spec.ts:62-65`) repart d'`EVENTS()` et perd `extendedProperties` d'un événement créé pendant le test | sans effet : aucun scénario ne déplace un bloc créé |

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `apps/web/src/lib/vault-worker/db-schema.ts`, `worker.ts` | colonne `sourceRef` et migration |
| `packages/ipc/src/schemas/calendar.ts` | `CalEventInputSchema.sourceRef` |
| `apps/web/src/lib/vault-worker/calendar-routes.ts` | upsert et lecture de `sourceRef` |
| `apps/web/src/lib/gcal.ts` | `extendedProperties` sur les types Google, lecture dans `toEventInput` |
| `apps/web/src/components/agenda/useEventWrites.ts` | `EventDraft.sourceRef`, `scheduleTask` |
| `apps/web/src/lib/agenda/task-ref.ts` (nouveau) | références, chemins et URL des sources, MIME du glisser |
| `apps/web/src/lib/agenda/free-slots.ts` (nouveau) | `SLOT_MIN`, `nextFreeSlots` |
| `apps/web/src/components/todos/TodoMatrix.tsx` | `export` de `QuadrantKey`, `QUADRANTS`, `quadrantOf` |
| `apps/web/src/components/agenda/useScheduledBlocks.ts` (nouveau) | événements J→J+60 et prochain bloc par référence |
| `apps/web/src/components/agenda/useSchedulableTasks.ts` (nouveau) | fusion des trois sources |
| `apps/web/src/components/agenda/EventBlock.tsx`, `TimeGrid.tsx`, `MonthGrid.tsx`, `AgendaList.tsx` | rendu « bloc de tâche », dépôt HTML5 |
| `apps/web/src/components/agenda/useAgendaData.ts` | pas de doublon puce/bloc |
| `apps/web/src/components/agenda/TaskDrawer.tsx` (nouveau) | `TaskList`, `TaskDrawer` |
| `apps/web/src/components/agenda/EventDetail.tsx` | « Ouvrir la tâche », « Retirer du planning » |
| `apps/web/src/components/agenda/ScheduleTaskSheet.tsx` (nouveau) | feuille « Planifier » |
| `apps/web/src/app/agenda/page.tsx` | câblage tiroir, dépôt, feuille, action d'en-tête mobile |
| `apps/web/src/components/todos/TodoRow.tsx` | puce « planifié » |
| `apps/web/src/app/todos/page.tsx` | `?edit=`, menu « Planifier… », lignes mail, feuille |
| `tests/e2e/04-agenda.spec.ts` | trois scénarios de la spec |

---

## Lot 1 — Socle

### Tâche 1 : `sourceRef` de bout en bout (miroir, IPC, Google, écritures)

**Fichiers :**
- Modifier `apps/web/src/lib/vault-worker/db-schema.ts:371` (table `cal_event`)
- Modifier `apps/web/src/lib/vault-worker/worker.ts:226-228` (après la migration `mail_thread`, avant `running SCHEMA_SQL`)
- Modifier `packages/ipc/src/schemas/calendar.ts:50` (`CalEventInputSchema`)
- Modifier `apps/web/src/lib/vault-worker/calendar-routes.ts:24-42` (`UPSERT_EVENT`, `eventParams`) et `:53-76` (`toEventRow`)
- Modifier `apps/web/src/lib/gcal.ts:21-52` (types) et `:204-223` (`toEventInput`)
- Modifier `apps/web/src/components/agenda/useEventWrites.ts:7-17` (`EventDraft`), `:42-53` (`bodyOf`), `:60-90` (`rowOf`)

**Interfaces :**
- Consomme : `CalEventInputSchema`, `CalEventRowSchema = CalEventInputSchema.extend(...)` (hérite du champ).
- Produit :
  - `CalEventInput.sourceRef: string` (donc aussi `CalEventRow.sourceRef`)
  - `GcalEventResource.extendedProperties?: { private?: Record<string, string> }`
  - `GcalEventBody.extendedProperties?: { private?: Record<string, string> }`
  - `EventDraft.sourceRef?: string`

Les trois maillons sont dans la même tâche : `CalEventInputSchema` est aussi un schéma d'**entrée** (`applyLocalMutation.event`, `resolveOutbox.event`, `syncUpsert.events`) et zod v4 strippe une clé non déclarée à l'entrée comme à la sortie.

- [ ] Étape 1 — `db-schema.ts`, dans `CREATE TABLE "cal_event"`, après la ligne `"colorId" TEXT NOT NULL DEFAULT '',` :

```sql
    "sourceRef" TEXT NOT NULL DEFAULT '',
```

- [ ] Étape 2 — `worker.ts`, insérer entre la fin du bloc `mail_thread` (l.226, `}` après `console.warn("[vault-worker] mail_thread AI columns migration failed (non-fatal)", e);`) et `console.info("[init.sqlite] running SCHEMA_SQL (base + FTS5)");` :

```ts
  // Coffres d'avant la planification des tâches ; une table absente est créée complète par SCHEMA_SQL.
  try {
    const cols = database.exec(`PRAGMA table_info("cal_event")`);
    const names: string[] =
      cols.length > 0 ? cols[0]!.values.map((row) => row[1] as string) : [];
    if (names.length > 0 && !names.includes("sourceRef")) {
      database.run(`ALTER TABLE "cal_event" ADD COLUMN "sourceRef" TEXT NOT NULL DEFAULT '';`);
    }
  } catch (e) {
    console.warn("[vault-worker] cal_event.sourceRef migration failed (non-fatal)", e);
  }
```

- [ ] Étape 3 — `packages/ipc/src/schemas/calendar.ts`, dans `CalEventInputSchema`, après `colorId: z.string(),` :

```ts
  /** Tâche liée au bloc (`todo:<id>`, `mail:<threadId>`, `checklist:<noteId>:<hash>`), sinon vide. */
  sourceRef: z.string(),
```

- [ ] Étape 4 — `calendar-routes.ts`, remplacer `UPSERT_EVENT` et `eventParams` (l.24-42) par :

```ts
const UPSERT_EVENT = `INSERT INTO cal_event
  (accountId, calendarId, id, summary, description, location, startAt, endAt, allDay, startDate, endDate,
   status, recurringEventId, htmlLink, meetUrl, attendeesJson, selfResponse, etag, colorId, sourceRef, updatedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(accountId, calendarId, id) DO UPDATE SET
    summary = excluded.summary, description = excluded.description, location = excluded.location,
    startAt = excluded.startAt, endAt = excluded.endAt, allDay = excluded.allDay,
    startDate = excluded.startDate, endDate = excluded.endDate, status = excluded.status,
    recurringEventId = excluded.recurringEventId, htmlLink = excluded.htmlLink, meetUrl = excluded.meetUrl,
    attendeesJson = excluded.attendeesJson, selfResponse = excluded.selfResponse, etag = excluded.etag,
    colorId = excluded.colorId, sourceRef = excluded.sourceRef, updatedAt = excluded.updatedAt`;

function eventParams(accountId: string, e: CalEventInput, ts: number): (string | number)[] {
  return [
    accountId, e.calendarId, e.id, e.summary, e.description, e.location, e.startAt, e.endAt,
    e.allDay ? 1 : 0, e.startDate, e.endDate, e.status, e.recurringEventId, e.htmlLink, e.meetUrl,
    JSON.stringify(e.attendees), e.selfResponse, e.etag, e.colorId, e.sourceRef, ts,
  ];
}
```

- [ ] Étape 5 — `calendar-routes.ts`, dans `toEventRow`, après `colorId: String(r["colorId"] ?? ""),` :

```ts
    sourceRef: String(r["sourceRef"] ?? ""),
```

- [ ] Étape 6 — `gcal.ts` : ajouter `extendedProperties?: { private?: Record<string, string> };` à la fin de `GcalEventResource` (après `colorId?: string;`) **et** de `GcalEventBody` (après `attendees?: …;`). Dans le `return` de `toEventInput`, après `colorId: ev.colorId ?? "",` :

```ts
    sourceRef: ev.extendedProperties?.private?.["supernoteRef"] ?? "",
```

- [ ] Étape 7 — `useEventWrites.ts` : ajouter `sourceRef?: string;` à la fin d'`EventDraft`. Dans `bodyOf`, juste avant `return body;` :

```ts
  // Google fusionne extendedProperties au PATCH : l'envoyer à la création suffit, un déplacement ne l'efface pas.
  if (!base && d.sourceRef) body.extendedProperties = { private: { supernoteRef: d.sourceRef } };
```

Dans `rowOf`, après `colorId: base.colorId ?? "",` :

```ts
    sourceRef: d.sourceRef ?? base.sourceRef ?? "",
```

`move` et `rsvp` passent par `toInput(ev)` (spread de la ligne) : `sourceRef` y est conservé sans modification.

- [ ] Vérifier : `pnpm --filter @supernote/ipc build && pnpm typecheck` → aucune `error TS`, turbo termine en succès. Puis `pnpm test:e2e tests/e2e/04-agenda.spec.ts` → `2 passed` (non-régression : 21 colonnes pour 21 `?`, synchro et outbox intactes).

### Tâche 2 : références de tâche et `scheduleTask`

**Fichiers :**
- Créer `apps/web/src/lib/agenda/task-ref.ts`
- Modifier `apps/web/src/components/agenda/useEventWrites.ts:1-5` (imports), fin du hook `:183`

**Interfaces :**
- Consomme : `buildGmailThreadUrl(threadId: string): string` (`lib/gmail.ts:1277`, import seul), `calListCalendars(accountId): Promise<CalCalendarRow[]>`, `canEditCalendar(calendars, calendarId): boolean` (`EventBlock.tsx:12`), `create(d: EventDraft)`.
- Produit :
  - `export const TASK_DRAG_MIME = "application/x-supernote-task"`
  - `export function taskRefOf(row: { id: string; sourceNoteId: string | null; blockId: string | null }): string`
  - `export function taskSourcePath(ref: string): string | null`
  - `export function taskSourceUrl(ref: string): string`
  - `export interface TaskSchedule { ref: string; title: string; startAt: number; endAt: number }`
  - `useEventWrites(accountId)` renvoie en plus `scheduleTask(t: TaskSchedule): Promise<void>` (lève si aucun agenda inscriptible)

- [ ] Étape 1 — créer `lib/agenda/task-ref.ts` :

```ts
import { buildGmailThreadUrl } from "@/lib/gmail";

export const TASK_DRAG_MIME = "application/x-supernote-task";

interface TaskRow {
  id: string;
  sourceNoteId: string | null;
  blockId: string | null;
}

/** Tâche de note : hash du texte seul (suffixe du blockId), pour que déplacer la ligne ne casse pas le lien. */
export function taskRefOf(row: TaskRow): string {
  if (row.id.startsWith("mail:")) return row.id;
  if (row.sourceNoteId && row.blockId) {
    return `checklist:${row.sourceNoteId}:${row.blockId.slice(row.blockId.indexOf(":") + 1)}`;
  }
  return `todo:${row.id}`;
}

export function taskSourcePath(ref: string): string | null {
  const [kind = "", id = ""] = ref.split(":");
  if (!id) return null;
  if (kind === "todo") return `/todos?edit=${encodeURIComponent(id)}`;
  if (kind === "mail") return `/mail?thread=${encodeURIComponent(id)}`;
  if (kind === "checklist") return `/notes/${id}`;
  return null;
}

/** Lien écrit dans la description du bloc, pour rouvrir la tâche depuis Google Agenda. */
export function taskSourceUrl(ref: string): string {
  if (ref.startsWith("mail:")) return buildGmailThreadUrl(ref.slice("mail:".length));
  const path = taskSourcePath(ref);
  return path ? `${window.location.origin}${path}` : "";
}
```

- [ ] Étape 2 — `useEventWrites.ts`, imports :

```ts
import { calApplyLocalMutation, calListCalendars, newCalendarOpId } from "@/lib/calendar-mirror";
import { taskSourceUrl } from "@/lib/agenda/task-ref";
import { canEditCalendar } from "./EventBlock";
```

Sous `export type RsvpResponse …` :

```ts
export interface TaskSchedule {
  ref: string;
  title: string;
  startAt: number;
  endAt: number;
}
```

- [ ] Étape 3 — `useEventWrites.ts`, avant le `return useMemo(…)` final, puis remplacer ce `return` :

```ts
  const scheduleTask = useCallback(
    async (t: TaskSchedule) => {
      const calendars = await calListCalendars(accountId);
      const writable = calendars.filter((c) => canEditCalendar(calendars, c.id));
      const calendar = writable.find((c) => c.primary) ?? writable[0];
      if (!calendar) throw new Error("Aucun agenda où tu peux écrire.");
      await create({
        calendarId: calendar.id,
        summary: t.title,
        description: taskSourceUrl(t.ref),
        location: "",
        allDay: false,
        startAt: t.startAt,
        endAt: t.endAt,
        attendees: [],
        meet: false,
        sourceRef: t.ref,
      });
    },
    [accountId, create],
  );

  return useMemo(
    () => ({ create, update, move, remove, rsvp, scheduleTask }),
    [create, update, move, remove, rsvp, scheduleTask],
  );
```

- [ ] Vérifier : `pnpm typecheck` → aucune `error TS`.

### Tâche 3 : créneaux libres

**Fichiers :**
- Créer `apps/web/src/lib/agenda/free-slots.ts`

**Interfaces :**
- Consomme : `addDays`, `startOfDay` (`lib/agenda/dates.ts`), `CalEventRow`.
- Produit :
  - `export const SLOT_MIN = 30`
  - `export interface FreeSlot { startAt: number; endAt: number }`
  - `export function nextFreeSlots(events: readonly CalEventRow[], now: number, count?: number, durationMin?: number): FreeSlot[]`

- [ ] Étape 1 — créer `lib/agenda/free-slots.ts` :

```ts
import type { CalEventRow } from "@supernote/ipc";
import { addDays, startOfDay } from "./dates";

export const SLOT_MIN = 30;
// ponytail: journée de travail en dur (9 h–18 h) ; réglage utilisateur quand l'usage le réclamera.
const WORK_START_MIN = 9 * 60;
const WORK_END_MIN = 18 * 60;
const STEP_MS = 15 * 60_000;
const MAX_DAYS = 14;

export interface FreeSlot {
  startAt: number;
  endAt: number;
}

function atMinute(day: number, min: number): number {
  const d = new Date(day);
  d.setHours(0, min, 0, 0);
  return d.getTime();
}

export function nextFreeSlots(
  events: readonly CalEventRow[],
  now: number,
  count = 3,
  durationMin = SLOT_MIN,
): FreeSlot[] {
  const busy = events.filter((e) => !e.allDay && e.selfResponse !== "declined");
  const duration = durationMin * 60_000;
  const limit = addDays(startOfDay(now), MAX_DAYS);
  const out: FreeSlot[] = [];
  let t = Math.ceil(now / STEP_MS) * STEP_MS;
  while (out.length < count && t < limit) {
    const day = startOfDay(t);
    const open = atMinute(day, WORK_START_MIN);
    if (t < open) {
      t = open;
      continue;
    }
    if (t + duration > atMinute(day, WORK_END_MIN)) {
      t = atMinute(addDays(day, 1), WORK_START_MIN);
      continue;
    }
    const clash = busy.find((e) => e.startAt < t + duration && e.endAt > t);
    if (clash) {
      t = Math.ceil(clash.endAt / STEP_MS) * STEP_MS;
      continue;
    }
    out.push({ startAt: t, endAt: t + duration });
    t += duration;
  }
  return out;
}
```

Chaque tour fait strictement avancer `t` ; `MAX_DAYS` borne la recherche.

- [ ] Vérifier : `pnpm typecheck` → aucune `error TS`. Comportement couvert par l'e2e mobile (tâche 15).

### Tâche 4 : blocs planifiés et tâches planifiables

**Fichiers :**
- Modifier `apps/web/src/components/todos/TodoMatrix.tsx:40`, `:52`, `:83` (trois `export`, édition ciblée)
- Créer `apps/web/src/components/agenda/useScheduledBlocks.ts`
- Créer `apps/web/src/components/agenda/useSchedulableTasks.ts`

**Interfaces :**
- Consomme : `calListEvents`, `CALENDAR_CHANGED_EVENT` (`lib/calendar-mirror.ts`), `calendarAccount` (`lib/calendar-sync.ts`), `mirrorAvailable` (`lib/mail-mirror.ts`, import seul), `useNoteChecklistTodos(enabled?)`, `useMailTodos(onError)`, `trpc.entities.list`, `taskRefOf`.
- Produit :
  - `export type QuadrantKey`, `export const QUADRANTS: QuadrantDef[]`, `export function quadrantOf(row: TodoRowData): QuadrantKey` (TodoMatrix)
  - `export interface ScheduledBlocks { accountId: string; events: CalEventRow[]; blocks: ReadonlyMap<string, CalEventRow> }`
  - `export function useScheduledBlocks(): ScheduledBlocks`
  - `export interface SchedulableTask { ref: string; title: string; quadrant: QuadrantKey; block: CalEventRow | null }`
  - `export function useSchedulableTasks(): { tasks: SchedulableTask[]; openRefs: ReadonlySet<string> | null }` (`openRefs` = `null` pendant le chargement)

- [ ] Étape 1 — `TodoMatrix.tsx` : trois éditions exactes, rien d'autre (les hunks l.165 et l.199 appartiennent à une autre session) :
  - `type QuadrantKey = "do" | "schedule" | "delegate" | "eliminate";` → `export type QuadrantKey = …`
  - `const QUADRANTS: QuadrantDef[] = [` → `export const QUADRANTS: QuadrantDef[] = [`
  - `function quadrantOf(row: TodoRowData): QuadrantKey {` → `export function quadrantOf(row: TodoRowData): QuadrantKey {`

Les emails todo portent déjà `urgent`/`importance` issus du numéro de label (`useMailTodos.ts:126-127`) : `quadrantOf` couvre les trois sources sans second chemin.

- [ ] Étape 2 — créer `components/agenda/useScheduledBlocks.ts` :

```ts
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CalEventRow } from "@supernote/ipc";
import { useSettings } from "@/components/settings/SettingsContext";
import { CALENDAR_CHANGED_EVENT, calListEvents } from "@/lib/calendar-mirror";
import { calendarAccount } from "@/lib/calendar-sync";
import { mirrorAvailable } from "@/lib/mail-mirror";
import { addDays, startOfDay } from "@/lib/agenda/dates";

const HORIZON_DAYS = 60;
const NO_EVENTS: CalEventRow[] = [];

export interface ScheduledBlocks {
  accountId: string;
  events: CalEventRow[];
  blocks: ReadonlyMap<string, CalEventRow>;
}

export function useScheduledBlocks(): ScheduledBlocks {
  const { settings } = useSettings();
  const accountId = calendarAccount(settings)?.accountId ?? "";
  const qc = useQueryClient();
  const [from] = useState(() => startOfDay(Date.now()));
  const query = useQuery({
    queryKey: ["calendar", "scheduled", accountId, from],
    queryFn: () => calListEvents(accountId, from, addDays(from, HORIZON_DAYS)),
    enabled: !!accountId && mirrorAvailable(),
    staleTime: 30_000,
  });

  // Hors /agenda, useAgendaData n'est pas monté : personne d'autre n'invalide ce cache.
  useEffect(() => {
    const refresh = () => void qc.invalidateQueries({ queryKey: ["calendar", "scheduled"] });
    window.addEventListener(CALENDAR_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CALENDAR_CHANGED_EVENT, refresh);
  }, [qc]);

  const events = query.data ?? NO_EVENTS;
  const blocks = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, CalEventRow>();
    // listEvents trie par début : le premier bloc à venir gagne, c'est celui que montre la feuille.
    for (const ev of events) {
      if (ev.sourceRef && ev.endAt > now && !map.has(ev.sourceRef)) map.set(ev.sourceRef, ev);
    }
    return map;
  }, [events]);

  return { accountId, events, blocks };
}
```

- [ ] Étape 3 — créer `components/agenda/useSchedulableTasks.ts` :

```ts
import { useMemo } from "react";
import type { CalEventRow } from "@supernote/ipc";
import { trpc } from "@/lib/trpc/client";
import { taskRefOf } from "@/lib/agenda/task-ref";
import { quadrantOf, type QuadrantKey } from "@/components/todos/TodoMatrix";
import type { TodoImportance, TodoRowData } from "@/components/todos/TodoRow";
import { useMailTodos } from "@/components/todos/useMailTodos";
import { useNoteChecklistTodos } from "@/components/todos/useNoteChecklistTodos";
import { useScheduledBlocks } from "./useScheduledBlocks";

export interface SchedulableTask {
  ref: string;
  title: string;
  quadrant: QuadrantKey;
  block: CalEventRow | null;
}

const IMPORTANCES: readonly TodoImportance[] = ["low", "medium", "high", "critical"];
const ignoreMailError = () => undefined;

function todoEntityRow(id: string, f: Record<string, unknown>): TodoRowData | null {
  if (f["done"] === true || f["done"] === "true") return null;
  // Anciennes tâches projetées depuis une note : la checklist de la note fait foi.
  if (typeof f["sourceNoteId"] === "string" && f["sourceNoteId"]) return null;
  const str = (k: string) => (typeof f[k] === "string" && f[k] ? (f[k] as string) : null);
  const urgent = f["urgent"];
  return {
    id,
    text: str("text") ?? "(sans texte)",
    done: false,
    sourceNoteId: null,
    line: null,
    blockId: null,
    startDate: str("startDate"),
    dueDate: str("dueDate"),
    priority: null,
    importance: IMPORTANCES.find((i) => i === f["importance"]) ?? "medium",
    urgent: urgent === true || urgent === "true" ? true : urgent === false || urgent === "false" ? false : null,
  };
}

export function useSchedulableTasks(): { tasks: SchedulableTask[]; openRefs: ReadonlySet<string> | null } {
  const todos = trpc.entities.list.useQuery({ typeId: "todo", limit: 5000, offset: 0 }, { staleTime: 30_000 });
  const notes = useNoteChecklistTodos();
  const mail = useMailTodos(ignoreMailError);
  const { blocks } = useScheduledBlocks();

  const tasks = useMemo(() => {
    const rows: TodoRowData[] = [
      ...(todos.data?.items ?? []).flatMap((e) => todoEntityRow(e.id, e.fields ?? {}) ?? []),
      ...notes.rows.filter((r) => !r.done),
      ...mail.rows.filter((r) => !r.done),
    ];
    // Deux lignes de même texte dans une note partagent la référence : une seule entrée.
    const byRef = new Map<string, SchedulableTask>();
    for (const row of rows) {
      const ref = taskRefOf(row);
      if (!byRef.has(ref)) {
        byRef.set(ref, { ref, title: row.text, quadrant: quadrantOf(row), block: blocks.get(ref) ?? null });
      }
    }
    return [...byRef.values()];
  }, [todos.data, notes.rows, mail.rows, blocks]);

  const loading = todos.isLoading || notes.isLoading;
  const openRefs = useMemo(() => (loading ? null : new Set(tasks.map((t) => t.ref))), [loading, tasks]);
  return { tasks, openRefs };
}
```

La clé de requête `{ typeId: "todo", limit: 5000, offset: 0 }` est celle de `/todos` (`page.tsx:361-364`) : même cache. `useMailTodos` n'a pas d'état de chargement : `openRefs` ne l'attend pas (scintillement « barré » possible sur un bloc `mail:`, accepté).

- [ ] Vérifier : `pnpm typecheck` → aucune `error TS` ; `git diff apps/web/src/components/todos/TodoMatrix.tsx` montre les trois `export` en plus des deux hunks préexistants, rien d'autre.

**Point de contrôle lot 1 :** `pnpm --filter @supernote/ipc build && pnpm typecheck` vert.

---

## Lot 2 — Agenda ordinateur

### Tâche 5 : rendu « bloc de tâche »

**Fichiers :**
- Modifier `apps/web/src/components/agenda/EventBlock.tsx` (fichier entier, 78 lignes)
- Modifier `apps/web/src/components/agenda/TimeGrid.tsx:4-9` (imports), `:17-27` (`GridProps`), `:40` (signature), `:189-196` et `:265-279` (deux `EventBlock`)
- Modifier `apps/web/src/components/agenda/MonthGrid.tsx:4`, `:17`, `:35`
- Modifier `apps/web/src/components/agenda/AgendaList.tsx:3-6`, `:13`, `:66-71`
- Modifier `apps/web/src/app/agenda/page.tsx:30-31` (imports), `:86` (données), `:241-248` (`gridProps`)

**Interfaces :**
- Consomme : `useSchedulableTasks()`.
- Produit :
  - `export function isTaskClosed(event: CalEventRow, openTaskRefs: ReadonlySet<string> | null): boolean` (EventBlock)
  - `EventBlockProps.taskClosed?: boolean`
  - `GridProps.openTaskRefs: ReadonlySet<string> | null` (hérité par `MonthGrid` et `AgendaList` via leurs `Omit`)

- [ ] Étape 1 — `EventBlock.tsx` : import `import { CheckSquare, CloudArrowUp } from "@phosphor-icons/react";`. Sous `canEditCalendar` :

```ts
/** Tâche liée faite, supprimée, ou ligne de note modifiée : le bloc reste comme historique. */
export function isTaskClosed(event: CalEventRow, openTaskRefs: ReadonlySet<string> | null): boolean {
  return !!event.sourceRef && !!openTaskRefs && !openTaskRefs.has(event.sourceRef);
}
```

Ajouter `taskClosed?: boolean;` à `EventBlockProps`, puis remplacer le composant (l.40-78) par :

```tsx
export function EventBlock({ event, color, compact, style, taskClosed = false, onPointerDown, onResizeStart, onSelect }: EventBlockProps) {
  const declined = event.selfResponse === "declined";
  const awaiting = event.selfResponse === "needsAction";
  const struck = declined || taskClosed;
  return (
    <button
      type="button"
      aria-label={`${event.sourceRef ? "Tâche : " : ""}${event.summary}, ${formatSpan(event)}`}
      onPointerDown={onPointerDown}
      onClick={(e) => {
        // Le glisser appelle lui-même onSelect sans mouvement ; `detail === 0` = clavier.
        if (!onPointerDown || e.detail === 0) onSelect(e.currentTarget);
      }}
      className="group relative flex w-full min-w-0 flex-col overflow-hidden rounded-md px-1.5 py-0.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
      style={{
        ...eventTint(color, awaiting),
        opacity: struck ? 0.5 : 1,
        ...style,
      }}
    >
      <span className="flex min-w-0 items-center gap-1">
        {event.sourceRef && <CheckSquare size={12} aria-hidden className="shrink-0" />}
        <span className={`truncate font-medium ${struck ? "line-through" : ""}`}>{event.summary}</span>
        {event.pending && <CloudArrowUp size={12} aria-label="En attente d'envoi" className="shrink-0" />}
      </span>
      {!compact && (
        <span className="truncate" style={{ color: "var(--text-secondary)" }}>
          {formatSpan(event)}
          {event.location ? ` · ${event.location}` : ""}
        </span>
      )}
      {onResizeStart && (
        <span
          aria-hidden
          onPointerDown={onResizeStart}
          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100"
        />
      )}
    </button>
  );
}
```

- [ ] Étape 2 — `TimeGrid.tsx` : import `import { EventBlock, calendarColor, canEditCalendar, eventTint, isTaskClosed } from "./EventBlock";`. Dans `GridProps`, après `overlays: AgendaOverlay[];` :

```ts
  /** Références des tâches ouvertes ; `null` tant qu'elles chargent (rien n'est barré). */
  openTaskRefs: ReadonlySet<string> | null;
```

Signature : ajouter `openTaskRefs` à la destructuration. Premier `EventBlock` (bande Journée, l.190) : ajouter `taskClosed={isTaskClosed(ev, openTaskRefs)}` ; second (grille, l.265) : `taskClosed={isTaskClosed(p.item, openTaskRefs)}`.

- [ ] Étape 3 — `MonthGrid.tsx` : import `import { EventBlock, calendarColor, isTaskClosed } from "./EventBlock";` ; ajouter `openTaskRefs` à la destructuration l.17 ; l.35 :

```tsx
                <EventBlock key={ev.id} event={ev} compact color={calendarColor(calendars, ev.calendarId)} taskClosed={isTaskClosed(ev, openTaskRefs)} onSelect={(el) => onSelectEvent(ev, el)} />
```

- [ ] Étape 4 — `AgendaList.tsx` : imports `import { CalendarBlank, CheckSquare } from "@phosphor-icons/react";` et `import { calendarColor, isTaskClosed } from "./EventBlock";` ; ajouter `openTaskRefs` à la destructuration l.13 ; remplacer le `<span>` du titre (l.66-71) par :

```tsx
                    <span
                      className={`flex min-w-0 items-center gap-1 text-sm ${ev.selfResponse === "declined" || isTaskClosed(ev, openTaskRefs) ? "line-through" : ""}`}
                      style={{ color: "var(--text-primary)" }}
                    >
                      {ev.sourceRef && (
                        <>
                          <CheckSquare size={14} aria-hidden className="shrink-0" />
                          <span className="sr-only">Tâche : </span>
                        </>
                      )}
                      <span className="truncate">{ev.summary}</span>
                    </span>
```

- [ ] Étape 5 — `app/agenda/page.tsx` : import `import { useSchedulableTasks } from "@/components/agenda/useSchedulableTasks";` ; après `const data = useAgendaData(range);` :

```ts
  const { tasks, openRefs } = useSchedulableTasks();
```

Dans `gridProps`, après `overlays,` : `openTaskRefs: openRefs,`. (`tasks` est consommé par les tâches 7 et 8.)

- [ ] Vérifier : `pnpm typecheck` → aucune `error TS`. Rendu couvert par l'e2e de la tâche 10.

### Tâche 6 : pas de doublon puce / bloc

**Fichiers :**
- Modifier `apps/web/src/components/agenda/useAgendaData.ts:12-13` (imports), `:86-123` (`overlays`)

**Interfaces :**
- Consomme : `taskRefOf`, `events.data` (déjà dans le hook).
- Produit : rien de nouveau ; `overlays` écarte les puces `todo`/`checklist` dont la référence est le `sourceRef` d'un événement de la plage. Vaut aussi pour `TodayPanel` (même hook).

- [ ] Étape 1 — import `import { taskRefOf } from "@/lib/agenda/task-ref";`.
- [ ] Étape 2 — dans le `useMemo` d'`overlays`, après `const inRange = …;` :

```ts
    const blockRefs = new Set((events.data ?? NO_EVENTS).map((e) => e.sourceRef).filter(Boolean));
```

En tête de la boucle `for (const item of overlayQuery.data?.items ?? [])` :

```ts
      if (item.kind === "todo" && blockRefs.has(`todo:${item.entityId}`)) continue;
```

Remplacer la garde de la boucle des checklists par :

```ts
      if (row.done || !date || !inRange(date) || !row.sourceNoteId || blockRefs.has(taskRefOf(row))) continue;
```

Dépendances du `useMemo` : ajouter `events.data`. Les `snooze`/`followup` ne sont pas des tâches : inchangés.

- [ ] Vérifier : `pnpm typecheck` → aucune `error TS`.

### Tâche 7 : déposer une tâche sur la grille

**Fichiers :**
- Modifier `apps/web/src/components/agenda/TimeGrid.tsx:3` (imports React), `:17-27` (`GridProps`), `:40-46` (signature, état), `:220-224` (conteneur des colonnes), `:292-301` (aperçus)
- Modifier `apps/web/src/app/agenda/page.tsx` (`dropTask`, `TimeGrid` l.291)

**Interfaces :**
- Consomme : `TASK_DRAG_MIME`, `SLOT_MIN`, `writes.scheduleTask`, `tasks`.
- Produit : `GridProps.onDropTask?: (ref: string, startAt: number) => void` (optionnelle, donc sans effet sur `MonthGrid`/`AgendaList`).

- [ ] Étape 1 — `TimeGrid.tsx` : l.3 ajouter `type DragEvent as ReactDragEvent` à l'import React ; ajouter :

```ts
import { TASK_DRAG_MIME } from "@/lib/agenda/task-ref";
import { SLOT_MIN } from "@/lib/agenda/free-slots";
```

Dans `GridProps`, après `openTaskRefs` :

```ts
  /** Dépôt d'une tâche du tiroir (glisser HTML5), ordinateur seulement. */
  onDropTask?: (ref: string, startAt: number) => void;
```

Ajouter `onDropTask` à la destructuration. Après `const dragRef = useRef<Drag | null>(null);` :

```ts
  const [dropAt, setDropAt] = useState<{ day: number; min: number } | null>(null);
```

Après `pointerDay` :

```ts
  const dropSlot = (e: ReactDragEvent<HTMLElement>) => ({
    day: pointerDay(e.clientX),
    min: Math.min(snap(pointerMinute(e.clientY)), 24 * 60 - SLOT_MIN),
  });
```

- [ ] Étape 2 — sur le `<div ref={columnsRef} className="relative grid" …>` (l.220), ajouter les gestionnaires (sur le conteneur, pas sur la colonne : on peut lâcher par-dessus un événement) :

```tsx
            onDragOver={(e) => {
              if (!onDropTask || !e.dataTransfer.types.includes(TASK_DRAG_MIME)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              const next = dropSlot(e);
              setDropAt((prev) => (prev?.day === next.day && prev.min === next.min ? prev : next));
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null);
            }}
            onDrop={(e) => {
              const ref = e.dataTransfer.getData(TASK_DRAG_MIME);
              setDropAt(null);
              if (!onDropTask || !ref) return;
              e.preventDefault();
              const slot = dropSlot(e);
              onDropTask(ref, (days[slot.day] ?? firstDay) + slot.min * 60_000);
            }}
```

- [ ] Étape 3 — dans chaque colonne, juste après l'aperçu `drag?.kind === "create"` (l.292-301) :

```tsx
                  {dropAt?.day === dayIndex && (
                    <div
                      className="pointer-events-none absolute inset-x-0.5 rounded-md"
                      style={{
                        ...eventTint("var(--accent)", true),
                        top: dropAt.min * PX_PER_MIN,
                        height: SLOT_MIN * PX_PER_MIN,
                      }}
                    />
                  )}
```

- [ ] Étape 4 — `app/agenda/page.tsx` : import `import { SLOT_MIN } from "@/lib/agenda/free-slots";`. Après `const move = …` :

```ts
  const dropTask = (ref: string, startAt: number) => {
    const task = tasks.find((t) => t.ref === ref);
    if (!task) return;
    // Après un lâcher il n'y a plus de contrôle pour porter l'erreur : toast.
    writes
      .scheduleTask({ ref, title: task.title, startAt, endAt: startAt + SLOT_MIN * 60_000 })
      .catch((err: unknown) =>
        toast({
          title: "Planification impossible",
          description: err instanceof Error ? err.message : String(err),
          variant: "danger",
        }),
      );
  };
```

l.291 :

```tsx
      <TimeGrid {...gridProps} interactive={!isMobile} onMoveEvent={move} onDropTask={isMobile ? undefined : dropTask} />
```

Le bloc créé se déplace et se redimensionne ensuite par le glisser existant (`move`, `sendUpdates: "none"`), qui conserve `sourceRef` via `toInput`.

- [ ] Vérifier : `pnpm typecheck` → aucune `error TS`.

### Tâche 8 : tiroir « À planifier »

**Fichiers :**
- Créer `apps/web/src/components/agenda/TaskDrawer.tsx`
- Modifier `apps/web/src/app/agenda/page.tsx` (imports, état, disposition l.326-339)

**Interfaces :**
- Consomme : `QUADRANTS` (TodoMatrix), `TASK_DRAG_MIME`, `SchedulableTask`.
- Produit :
  - `export function TaskList(props: { tasks: readonly SchedulableTask[]; onPick: (task: SchedulableTask) => void; draggable?: boolean }): JSX.Element`
  - `export function TaskDrawer(props: { tasks: readonly SchedulableTask[]; onPick: (task: SchedulableTask) => void }): JSX.Element`
  - page : `scheduling: { task: { ref: string; title: string } | null } | null` (lu par la feuille en tâche 12 ; d'ici là, un clic sur une tâche du tiroir ne montre rien, le glisser fonctionne)

- [ ] Étape 1 — créer `components/agenda/TaskDrawer.tsx` :

```tsx
"use client";

import { useState } from "react";
import { CaretRight, CheckSquare, ListChecks } from "@phosphor-icons/react";
import { Button, Tooltip } from "@supernote/ui";
import { QUADRANTS } from "@/components/todos/TodoMatrix";
import { TASK_DRAG_MIME } from "@/lib/agenda/task-ref";
import type { SchedulableTask } from "./useSchedulableTasks";

const OPEN_KEY = "supernote.agenda.taskDrawer";

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

interface TaskListProps {
  tasks: readonly SchedulableTask[];
  onPick: (task: SchedulableTask) => void;
  draggable?: boolean;
}

export function TaskList({ tasks, onPick, draggable = false }: TaskListProps) {
  return (
    <div className="flex flex-col gap-3">
      {QUADRANTS.map((q) => {
        const items = tasks.filter((t) => t.quadrant === q.key);
        if (items.length === 0) return null;
        return (
          <section key={q.key} className="flex flex-col gap-0.5">
            <h3 className="sn-eyebrow sn-eyebrow--compact flex items-center gap-1.5 px-2">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: q.accent }} />
              {q.title}
            </h3>
            <ul className="flex flex-col">
              {items.map((t) => (
                <li key={t.ref}>
                  {/* Bouton natif : il porte le glisser HTML5, que react-aria intercepterait. */}
                  <button
                    type="button"
                    draggable={draggable}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TASK_DRAG_MIME, t.ref);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => onPick(t)}
                    className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-[var(--nav-hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                    style={{ color: "var(--text-primary)", cursor: draggable ? "grab" : undefined }}
                  >
                    <CheckSquare size={14} aria-hidden className="shrink-0" style={{ color: "var(--text-muted)" }} />
                    <span className="min-w-0 truncate">{t.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function TaskDrawer({ tasks, onPick }: { tasks: readonly SchedulableTask[]; onPick: (task: SchedulableTask) => void }) {
  const [open, setOpen] = useState(readOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* état valable pour la session */
    }
  };

  if (!open) {
    return (
      <div className="flex w-10 shrink-0 justify-center border-l pt-2" style={{ borderColor: "var(--border-subtle)" }}>
        <Tooltip content={`À planifier (${tasks.length})`}>
          <Button variant="ghost" size="icon" isIconOnly aria-label={`Afficher les tâches à planifier (${tasks.length})`} onPress={toggle}>
            <ListChecks size={16} aria-hidden />
          </Button>
        </Tooltip>
      </div>
    );
  }

  return (
    <aside
      aria-label="À planifier"
      className="flex w-64 shrink-0 flex-col border-l"
      style={{ borderColor: "var(--border-subtle)", background: "var(--surface-0)" }}
    >
      <div className="flex items-center gap-2 px-3 pt-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          À planifier
        </h2>
        <span
          className="rounded-full px-1.5 text-[10px] font-medium tabular-nums"
          style={{ background: "var(--surface-3)", color: "var(--text-muted)" }}
        >
          {tasks.length}
        </span>
        <Tooltip content="Replier">
          <Button variant="ghost" size="icon" isIconOnly aria-label="Replier les tâches à planifier" onPress={toggle} className="ml-auto">
            <CaretRight size={14} aria-hidden />
          </Button>
        </Tooltip>
      </div>
      <p className="px-3 pb-2 text-xs" style={{ color: "var(--text-muted)" }}>
        Glisse une tâche sur un créneau.
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
        {tasks.length === 0 ? (
          <p className="px-2 py-4 text-sm" style={{ color: "var(--text-muted)" }}>
            Tout est planifié.
          </p>
        ) : (
          <TaskList tasks={tasks} onPick={onPick} draggable />
        )}
      </div>
    </aside>
  );
}
```

- [ ] Étape 2 — `app/agenda/page.tsx` : import `import { TaskDrawer } from "@/components/agenda/TaskDrawer";`. Après `const [sources, setSources] = …` :

```ts
  const [scheduling, setScheduling] = useState<{ task: { ref: string; title: string } | null } | null>(null);
```

Après `const { tasks, openRefs } = useSchedulableTasks();` :

```ts
  const toPlan = useMemo(() => tasks.filter((t) => !t.block), [tasks]);
```

- [ ] Étape 3 — disposition (l.326-339), entre la colonne de la grille et l'`aside` du détail :

```tsx
              {!isMobile && (view === "day" || view === "week") && (
                <TaskDrawer tasks={toPlan} onPick={(t) => setScheduling({ task: { ref: t.ref, title: t.title } })} />
              )}
```

Hors ligne, la création passe par l'outbox et `emitCalendarChanged` : `useScheduledBlocks` relit, la tâche quitte le tiroir aussitôt.

- [ ] Vérifier : `pnpm typecheck` → aucune `error TS`.

### Tâche 9 : détail d'un bloc et ouverture de la tâche

**Fichiers :**
- Modifier `apps/web/src/components/agenda/EventDetail.tsx:6` (icônes), `:8-14` (imports), `:23-32` (props), `:110-129` (rangée d'actions), `:214-219` (Supprimer)
- Modifier `apps/web/src/app/agenda/page.tsx:294-303` (`detail`)
- Modifier `apps/web/src/app/todos/page.tsx:98` (import) et après `:448` (fin du `useMemo` de `standaloneRows`)

**Interfaces :**
- Consomme : `taskSourcePath(ref)`, `writes.remove(ev)`.
- Produit : `EventDetailProps.onUnschedule?: () => void` ; `/todos?edit=<id>` ouvre `EditTodoModal` sur le todo. `TodayPanel` ne passe pas `onUnschedule` : il garde « Supprimer » et gagne « Ouvrir la tâche ».

- [ ] Étape 1 — `EventDetail.tsx` : icônes `import { ArrowSquareOut, CalendarX, CheckSquare, MapPin, NotePencil, PencilSimple, Trash, VideoCamera, X } from "@phosphor-icons/react";` ; `import { taskSourcePath } from "@/lib/agenda/task-ref";`. Dans `EventDetailProps`, après `onRsvp` :

```ts
  /** Bloc de tâche : remplace « Supprimer ». */
  onUnschedule?: () => void;
```

Destructurer `onUnschedule`. Après `const others = …;` :

```ts
  const taskPath = event.sourceRef ? taskSourcePath(event.sourceRef) : null;
```

- [ ] Étape 2 — dans la rangée `flex flex-wrap gap-1.5` (après le `Tooltip` « Note de réunion », l.128) :

```tsx
        {taskPath && (
          <Button variant="outline" size="sm" onPress={() => navigate(taskPath)}>
            <CheckSquare size={16} aria-hidden />
            Ouvrir la tâche
          </Button>
        )}
```

Remplacer le bloc `{editable && (<Button … onPress={onDelete} …>Supprimer</Button>)}` (l.214-219) par :

```tsx
        {editable &&
          (event.sourceRef && onUnschedule ? (
            <Button variant="ghost" size="sm" onPress={onUnschedule} className="ml-auto">
              <CalendarX size={14} aria-hidden />
              Retirer du planning
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onPress={onDelete} className="ml-auto">
              <Trash size={14} aria-hidden />
              Supprimer
            </Button>
          ))}
```

- [ ] Étape 3 — `app/agenda/page.tsx`, dans `<EventDetail …>` après `onRsvp` :

```tsx
      onUnschedule={() => {
        void writes.remove(selected);
        setSelectedId(null);
      }}
```

Pas de confirmation : le bloc se recrée d'un glisser, la tâche n'est pas touchée.

- [ ] Étape 4 — `app/todos/page.tsx` : l.98 `import { useNavigate, useSearchParams } from "react-router-dom";`. Après la fin du `useMemo` de `standaloneRows` (l.448) :

```ts
  const [searchParams, setSearchParams] = useSearchParams();
  // `?edit=<id>` : « Ouvrir la tâche » depuis un bloc de l'agenda.
  useEffect(() => {
    const id = searchParams.get("edit");
    if (!id || !todosQuery.data) return;
    const row = standaloneRows.find((r) => r.id === id);
    if (row) setEditing(row);
    searchParams.delete("edit");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams, todosQuery.data, standaloneRows]);
```

- [ ] Vérifier : `pnpm typecheck` → aucune `error TS`.

### Tâche 10 : e2e ordinateur (glisser, icône de tâche)

**Fichiers :**
- Modifier `tests/e2e/04-agenda.spec.ts:20-37` (`EVENTS`), `:40-68` (`withGoogleCalendar`), ajout d'un helper et d'un test

**Interfaces :**
- Consomme : `bootCloud`, `mockGoogleApis` (inchangés), boutons « Nouvelle », placeholder « Texte de la tâche », « Créer » de `/todos`.
- Produit : `withGoogleCalendar(page, posted?: Record<string, unknown>[]): Promise<string[]>` (collecte les corps POST) ; `createTodo(page, text, mobile?)`.

- [ ] Étape 1 — ajouter à la fin du tableau `EVENTS()` un bloc de tâche renvoyé par Google (demain 16 h, référence d'un todo absent → rendu barré) :

```ts
  {
    id: "ev-tache",
    status: "confirmed",
    summary: "Préparer la démo",
    etag: '"1"',
    start: { dateTime: atHour(1, 16) },
    end: { dateTime: atHour(1, 16, 30) },
    extendedProperties: { private: { supernoteRef: "todo:ancien" } },
  },
```

- [ ] Étape 2 — `withGoogleCalendar` : signature `async function withGoogleCalendar(page: Page, posted: Record<string, unknown>[] = []): Promise<string[]>` ; remplacer la ligne du POST par :

```ts
    if (req.method() === "POST") {
      posted.push(body);
      return { ...body, id: "g-nouveau", status: "confirmed", etag: '"2"' };
    }
```

Le mock renvoie le corps tel quel : `extendedProperties` revient dans l'acquittement, comme chez Google.

- [ ] Étape 3 — sous `count`, ajouter :

```ts
async function createTodo(page: Page, text: string, mobile = false): Promise<void> {
  await page.goto("/todos");
  await page.getByRole("button", { name: mobile ? "Nouvelle tâche" : "Nouvelle", exact: true }).first().click({ timeout: 45_000 });
  await page.getByPlaceholder("Texte de la tâche").fill(text);
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page.getByText(text).first()).toBeVisible({ timeout: 20_000 });
}
```

- [ ] Étape 4 — dans `test.describe("04 — agenda", …)`, après le premier test :

```ts
  test("un todo glissé du tiroir devient un bloc lié", async ({ page }) => {
    test.setTimeout(120_000);
    const posted: Record<string, unknown>[] = [];
    await withGoogleCalendar(page, posted);
    await page.setViewportSize({ width: 1440, height: 900 });
    await createTodo(page, "Rédiger le compte rendu");

    await page.goto("/agenda");
    await page.getByRole("button", { name: /Reprendre|Connecter Google Agenda/ }).first().click({ timeout: 45_000 });
    await page.keyboard.press("j");
    await page.getByRole("button", { name: "Période suivante" }).click();

    // Un événement Google porteur de supernoteRef s'affiche comme une tâche.
    const bloc = page.getByRole("button", { name: /^Tâche : Préparer la démo/ });
    await expect(bloc).toBeVisible({ timeout: 30_000 });

    const drawer = page.getByRole("complementary", { name: "À planifier" });
    const task = drawer.getByRole("button", { name: "Rédiger le compte rendu" });
    await task.dragTo(bloc);

    await expect.poll(() => posted.length, { timeout: 15_000 }).toBe(1);
    expect(posted[0]).toMatchObject({
      summary: "Rédiger le compte rendu",
      description: expect.stringContaining("/todos?edit="),
      extendedProperties: { private: { supernoteRef: expect.stringMatching(/^todo:\S+$/) } },
    });
    await expect(task).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Tâche : Rédiger le compte rendu/ })).toBeVisible();
  });
```

Le dépôt se fait demain à 16 h 15 : le bloc est « à venir » quelle que soit l'heure du test.

- [ ] Vérifier : `pnpm test:e2e tests/e2e/04-agenda.spec.ts` → `3 passed`.

**Point de contrôle lot 2 :** `pnpm typecheck` vert et `pnpm test:e2e tests/e2e/04-agenda.spec.ts` → `3 passed`.

---

## Lot 3 — Feuille et points d'entrée

### Tâche 11 : feuille « Planifier »

**Fichiers :**
- Créer `apps/web/src/components/agenda/ScheduleTaskSheet.tsx`

**Interfaces :**
- Consomme : `useScheduledBlocks()`, `useEventWrites(accountId)` (`scheduleTask`, `move`, `remove`), `nextFreeSlots`, `SLOT_MIN`, `TaskList`, `useActionFeedback`, `isCalendarConnected`, `MobileSheet`, `Modal`.
- Produit :
  - `export interface TaskTarget { ref: string; title: string }`
  - `export function ScheduleTaskSheet(props: { task: TaskTarget | null; pickFrom?: readonly SchedulableTask[]; onClose: () => void }): JSX.Element` — montée par le parent seulement quand elle est ouverte ; `task: null` = commence par la liste `pickFrom`.

- [ ] Étape 1 — créer `components/agenda/ScheduleTaskSheet.tsx` :

```tsx
"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowsLeftRight, CalendarBlank, CalendarX } from "@phosphor-icons/react";
import { Button, Input, Modal } from "@supernote/ui";
import { MobileSheet } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useActionFeedback } from "@/lib/action-feedback";
import { isCalendarConnected } from "@/lib/calendar-sync";
import { dateKey, formatSpan } from "@/lib/agenda/dates";
import { SLOT_MIN, nextFreeSlots } from "@/lib/agenda/free-slots";
import { TaskList } from "./TaskDrawer";
import { useEventWrites } from "./useEventWrites";
import { useScheduledBlocks } from "./useScheduledBlocks";
import type { SchedulableTask } from "./useSchedulableTasks";

export interface TaskTarget {
  ref: string;
  title: string;
}

interface ScheduleTaskSheetProps {
  task: TaskTarget | null;
  pickFrom?: readonly SchedulableTask[];
  onClose: () => void;
}

const DAY_SHORT = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const DURATIONS = [30, 60, 120] as const;

function slotLabel(s: { startAt: number; endAt: number }): string {
  return `${DAY_SHORT.format(s.startAt)} · ${formatSpan({ allDay: false, ...s })}`;
}

export function ScheduleTaskSheet({ task: initialTask, pickFrom = [], onClose }: ScheduleTaskSheetProps) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { accountId, events, blocks } = useScheduledBlocks();
  const writes = useEventWrites(accountId);
  const feedback = useActionFeedback();
  const [task, setTask] = useState(initialTask);
  const [moving, setMoving] = useState(false);
  const [now] = useState(() => Date.now());
  const [date, setDate] = useState(() => dateKey(now));
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState<number>(SLOT_MIN);
  const slots = useMemo(() => nextFreeSlots(events, now), [events, now]);
  const block = task ? blocks.get(task.ref) ?? null : null;
  const connected = !!accountId && isCalendarConnected();

  const place = (startAt: number, endAt: number) =>
    void feedback.run(async () => {
      if (!task) return;
      if (block) await writes.move(block, startAt, endAt);
      else await writes.scheduleTask({ ref: task.ref, title: task.title, startAt, endAt });
      onClose();
    });

  const placeCustom = () => {
    const startAt = new Date(`${date}T${time || "09:00"}`).getTime();
    if (!Number.isFinite(startAt)) {
      feedback.fail(new Error("Date ou heure invalide."));
      return;
    }
    place(startAt, startAt + duration * 60_000);
  };

  let content: ReactNode;
  if (!connected) {
    content = (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Connecte Google Agenda pour planifier.
        </p>
        <Button
          variant="outline"
          size="sm"
          onPress={() => {
            onClose();
            navigate("/agenda");
          }}
        >
          <CalendarBlank size={14} aria-hidden />
          Ouvrir l'agenda
        </Button>
      </div>
    );
  } else if (!task) {
    content =
      pickFrom.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Tout est planifié.
        </p>
      ) : (
        <TaskList tasks={pickFrom} onPick={(t) => setTask({ ref: t.ref, title: t.title })} />
      );
  } else if (block && !moving) {
    content = (
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {task.title}
        </p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          Planifié {slotLabel(block)}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" onPress={() => setMoving(true)}>
            <ArrowsLeftRight size={14} aria-hidden />
            Déplacer
          </Button>
          <Button
            variant="ghost"
            size="sm"
            isDisabled={feedback.isPending}
            onPress={() =>
              void feedback.run(async () => {
                await writes.remove(block);
                onClose();
              })
            }
          >
            <CalendarX size={14} aria-hidden />
            Retirer du planning
          </Button>
        </div>
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {task.title}
        </p>
        <div role="group" aria-label="Prochains créneaux libres" className="flex flex-col gap-1.5">
          <span aria-hidden className="sn-eyebrow sn-eyebrow--compact">
            Prochains créneaux libres
          </span>
          {slots.map((s) => (
            <Button
              key={s.startAt}
              variant="outline"
              isDisabled={feedback.isPending}
              onPress={() => place(s.startAt, s.endAt)}
              className="justify-start"
            >
              {slotLabel(s)}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <span className="sn-eyebrow sn-eyebrow--compact">Autre créneau</span>
          <div className="grid grid-cols-2 gap-2">
            <Input id="schedule-task-date" aria-label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Input id="schedule-task-time" aria-label="Heure de début" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div role="group" aria-label="Durée" className="flex gap-1.5">
            {DURATIONS.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={duration === d ? "primary" : "outline"}
                aria-pressed={duration === d}
                onPress={() => setDuration(d)}
              >
                {d < 60 ? `${d} min` : `${d / 60} h`}
              </Button>
            ))}
          </div>
          <Button variant="primary" isLoading={feedback.isPending} onPress={placeCustom}>
            Planifier
          </Button>
        </div>
      </div>
    );
  }

  const body = (
    <>
      {content}
      {feedback.error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
          {feedback.error}
        </p>
      )}
    </>
  );

  return isMobile ? (
    <MobileSheet isOpen onClose={onClose} title="Planifier" size="lg">
      {body}
    </MobileSheet>
  ) : (
    <Modal isOpen onOpenChange={(open) => !open && onClose()} title="Planifier" size="sm">
      {body}
    </Modal>
  );
}
```

Succès : la feuille se ferme et le résultat est déjà visible (bloc, tiroir, puce) — pas de toast. Échec : `role="alert"` dans la feuille. Le lien vers `/agenda` porte le geste utilisateur exigé par GIS sur le bouton de connexion de la page.

- [ ] Vérifier : `pnpm typecheck` → aucune `error TS`.

### Tâche 12 : feuille et action d'en-tête sur `/agenda`

**Fichiers :**
- Modifier `apps/web/src/app/agenda/page.tsx:6` (icônes), `:8` (shell), imports, après `useMobileFab` (l.109), fin du JSX (après l.373)

**Interfaces :**
- Consomme : `ScheduleTaskSheet`, `useMobileHeaderActions`, `scheduling`/`toPlan` (tâche 8).
- Produit : sur téléphone, action d'en-tête « Planifier une tâche » (le FAB reste « Nouvel événement ») ; sur ordinateur, un clic sur une tâche du tiroir ouvre la feuille (alternative clavier au glisser).

- [ ] Étape 1 — imports :

```ts
import { CalendarBlank, CalendarPlus, Plus } from "@phosphor-icons/react";
import { AppShell, MobileSheet, useMobileFab, useMobileHeaderActions, useMobileTitle } from "@/components/shell";
import { ScheduleTaskSheet } from "@/components/agenda/ScheduleTaskSheet";
```

- [ ] Étape 2 — après `useMobileFab(…)` :

```ts
  useMobileHeaderActions(
    isMobile && connected
      ? [{ id: "schedule-task", icon: CalendarPlus, label: "Planifier une tâche", onPress: () => setScheduling({ task: null }) }]
      : [],
  );
```

- [ ] Étape 3 — avant `</AppShell>` :

```tsx
      {scheduling && (
        <ScheduleTaskSheet task={scheduling.task} pickFrom={toPlan} onClose={() => setScheduling(null)} />
      )}
```

- [ ] Vérifier : `pnpm typecheck` → aucune `error TS`.

### Tâche 13 : puce « planifié » sur les lignes de todo

**Fichiers :**
- Modifier `apps/web/src/components/todos/TodoRow.tsx:18` (icônes), `:25-53` (`TodoRowData`), après `:354` (badge de rappel)
- Modifier `apps/web/src/lib/agenda/task-ref.ts` (ajout de `withScheduledAt`)

**Interfaces :**
- Consomme : `taskRefOf`, `ReadonlyMap<string, CalEventRow>` de `useScheduledBlocks`.
- Produit :
  - `TodoRowData.scheduledAt?: number | null`
  - `export function withScheduledAt<T extends TaskRow & { scheduledAt?: number | null }>(rows: T[], blocks: ReadonlyMap<string, CalEventRow>): T[]`

- [ ] Étape 1 — `TodoRow.tsx` : `import { FileText, Envelope, Bell, Clock } from "@phosphor-icons/react";`. À la fin de `TodoRowData` :

```ts
  /** Début du prochain bloc d'agenda réservé pour la tâche. */
  scheduledAt?: number | null;
```

Sous `IMPORTANCE_LABEL` :

```ts
const SCHEDULED_FMT = new Intl.DateTimeFormat("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" });
```

- [ ] Étape 2 — après le bloc `{row.reminderAt && !row.reminderFiredAt && (…)}` :

```tsx
      {row.scheduledAt && !row.done && (
        <span
          className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
          style={{ backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }}
          title={`Planifié : ${new Date(row.scheduledAt).toLocaleString("fr-FR")}`}
        >
          <Clock size={10} weight="bold" aria-hidden />
          <span className="sr-only">Planifié </span>
          {SCHEDULED_FMT.format(row.scheduledAt)}
        </span>
      )}
```

- [ ] Étape 3 — `task-ref.ts` : `import type { CalEventRow } from "@supernote/ipc";` en tête, et en fin de fichier :

```ts
export function withScheduledAt<T extends TaskRow & { scheduledAt?: number | null }>(
  rows: T[],
  blocks: ReadonlyMap<string, CalEventRow>,
): T[] {
  if (blocks.size === 0) return rows;
  return rows.map((r) => {
    const block = blocks.get(taskRefOf(r));
    return block ? { ...r, scheduledAt: block.startAt } : r;
  });
}
```

- [ ] Vérifier : `pnpm typecheck` → aucune `error TS`.

### Tâche 14 : « Planifier… » dans `/todos`

**Fichiers :**
- Modifier `apps/web/src/app/todos/page.tsx` : icônes (l.35-53), imports (l.92-104), état (l.222), après `useMailTodos` (l.393), `allTodos` (l.450-453), menu contextuel (l.946-986), matrice (l.1512 et l.1529-1531), après `<ContextMenu …/>` (l.1832)

**Interfaces :**
- Consomme : `useScheduledBlocks().blocks`, `taskRefOf`, `withScheduledAt`, `ScheduleTaskSheet`, `TaskTarget`, `openMailThread` (l.394).
- Produit : entrée « Planifier… » pour les todos et les lignes de note ; menu des lignes d'email todo (matrice) réduit à « Planifier… » et « Ouvrir le fil » ; puce sur toute ligne planifiée.

- [ ] Étape 1 — ajouter `CalendarPlus,` à la liste d'icônes phosphor (l.35-53) et les imports :

```ts
import { ScheduleTaskSheet, type TaskTarget } from "@/components/agenda/ScheduleTaskSheet";
import { useScheduledBlocks } from "@/components/agenda/useScheduledBlocks";
import { taskRefOf, withScheduledAt } from "@/lib/agenda/task-ref";
```

- [ ] Étape 2 — après `const [editing, setEditing] = …` (l.222) :

```ts
  const [scheduling, setScheduling] = useState<TaskTarget | null>(null);
```

Après `const mailTodos = useMailTodos(showToast);` (l.393) :

```ts
  const { blocks } = useScheduledBlocks();
```

Remplacer `allTodos` (l.450-453) :

```ts
  const allTodos: UiTodoRow[] = useMemo(
    () => withScheduledAt([...noteRows, ...standaloneRows], blocks),
    [noteRows, standaloneRows, blocks],
  );
```

- [ ] Étape 3 — dans `openTodoContextMenu`, après l'item `edit` :

```ts
        {
          key: "schedule",
          label: "Planifier…",
          icon: <CalendarPlus size={14} />,
          onPress: () => setScheduling({ ref: taskRefOf(row), title: row.text }),
        },
```

Après le `useCallback` d'`openTodoContextMenu` :

```ts
  const openMailContextMenu = useCallback(
    (e: React.MouseEvent, row: TodoRowData) => {
      ctxMenu.open(e, [
        {
          key: "schedule",
          label: "Planifier…",
          icon: <CalendarPlus size={14} />,
          onPress: () => setScheduling({ ref: taskRefOf(row), title: row.text }),
        },
        { key: "open", label: "Ouvrir le fil", icon: <Envelope size={14} />, onPress: () => openMailThread(row) },
      ]);
    },
    [ctxMenu, openMailThread],
  );
```

(`ctxMenu.open` appelle déjà `preventDefault`.)

- [ ] Étape 4 — matrice : l.1512

```tsx
                todos={tagFilter.size > 0 ? matrixTodos : [...matrixTodos, ...withScheduledAt(mailTodos.rows, blocks)]}
```

l.1529-1531 :

```tsx
                onContextMenu={(e, row) =>
                  mailThreadIdOf(row.id) ? openMailContextMenu(e, row) : openTodoContextMenu(e, row as UiTodoRow)
                }
```

- [ ] Étape 5 — après `<ContextMenu state={ctxMenu.state} onClose={ctxMenu.close} />` :

```tsx
      {scheduling && <ScheduleTaskSheet task={scheduling} onClose={() => setScheduling(null)} />}
```

Au téléphone, le menu s'ouvre là où le navigateur émet `contextmenu` à l'appui long (Android). Pour iOS, l'entrée `/todos` passe par la modale d'édition (étape 6) ; l'action d'en-tête de `/agenda` reste l'autre entrée mobile.

- [ ] Étape 6 — entrée mobile fiable depuis `/todos`. Un tap sur une ligne ouvre `EditTodoModal` (`TodoRow.tsx:289`, `onPress: onEdit`), sur iOS comme ailleurs. Dans `apps/web/src/components/todos/EditTodoModal.tsx` :
  - ajouter la prop optionnelle `onSchedule?: () => void` à l'interface des props (à côté de `onSave`, l.43) et la déstructurer (l.59) ;
  - dans le pied de la modale, avant les boutons Annuler/Enregistrer, un `Button` HeroUI `variant="secondary"` qui appelle `onSchedule`, rendu seulement quand la prop est fournie. Ce n'est pas un bouton icône seul : le libellé porte le sens.

```tsx
{onSchedule && (
  <Button variant="secondary" onPress={onSchedule}>
    <CalendarPlus size={16} aria-hidden />
    Planifier…
  </Button>
)}
```

  Dans `app/todos/page.tsx`, là où `EditTodoModal` est rendu avec `editing` :

```tsx
onSchedule={() => {
  if (!editing) return;
  setScheduling({ ref: taskRefOf(editing), title: editing.text });
  setEditing(null);
}}
```

- [ ] Vérifier : `pnpm typecheck` → aucune `error TS`.

### Tâche 15 : e2e téléphone 360 px

**Fichiers :**
- Modifier `tests/e2e/04-agenda.spec.ts` (nouveau `describe` en fin de fichier)

**Interfaces :**
- Consomme : `withGoogleCalendar(page, posted)`, `createTodo(page, text, true)` (tâche 10), action « Planifier une tâche », groupe « Prochains créneaux libres ».
- Produit : scénario n° 2 de la spec.

- [ ] Étape 1 — dans `test.describe("04 — agenda", …)`, après le `describe("mobile")` existant :

```ts
  test.describe("téléphone 360 px", () => {
    test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });

    test("planifier une tâche depuis l'en-tête, premier créneau libre", async ({ page }) => {
      test.setTimeout(120_000);
      const posted: Record<string, unknown>[] = [];
      await withGoogleCalendar(page, posted);
      await createTodo(page, "Rédiger le compte rendu", true);

      await page.goto("/agenda");
      await page.getByRole("button", { name: /Reprendre|Connecter Google Agenda/ }).first().click({ timeout: 45_000 });
      await expect(page.getByRole("button", { name: /Point équipe/ })).toBeVisible({ timeout: 30_000 });

      await page.getByRole("button", { name: "Planifier une tâche" }).click();
      await page.getByRole("button", { name: "Rédiger le compte rendu" }).click();
      const slots = page.getByRole("group", { name: "Prochains créneaux libres" });
      await expect(slots.getByRole("button").first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      await slots.getByRole("button").first().click();
      await expect.poll(() => posted.length, { timeout: 15_000 }).toBe(1);
      expect(posted[0]).toMatchObject({
        summary: "Rédiger le compte rendu",
        extendedProperties: { private: { supernoteRef: expect.stringMatching(/^todo:\S+$/) } },
      });
    });
  });
```

- [ ] Vérifier : `pnpm test:e2e tests/e2e/04-agenda.spec.ts` → `4 passed`.

### Tâche 16 : vérification finale

**Fichiers :** aucun.

**Interfaces :** —

- [ ] Étape 1 — `pnpm build:packages` (dist de `@supernote/ipc` à jour).
- [ ] Étape 2 — `pnpm typecheck` → aucune `error TS`.
- [ ] Vérifier : `pnpm test:e2e` → `16 passed` (14 existants + 2 nouveaux).
- [ ] Étape 3 — `git status --short` : seuls les fichiers de la carte ci-dessus sont modifiés ou créés ; `lib/gmail.ts` et `lib/mail-mirror.ts` sont dans l'état laissé par l'autre session ; `TodoMatrix.tsx` n'a que trois `export` en plus de ses hunks préexistants. Signaler que la carte du codebase (`patterns.md`, `database.md`) est périmée pour `cal_event.sourceRef` ; ne pas lancer `update-codebase-map`.

**Point de contrôle lot 3 :** typecheck vert, e2e complet vert.

---

## Couverture de la spec

| Exigence | Tâche |
|---|---|
| Colonne `sourceRef` + migration idempotente | 1 |
| `CalEventInputSchema.sourceRef` + rebuild dist | 1 |
| `calendar-routes` upsert + lecture | 1 |
| `gcal.ts` `extendedProperties`, `toEventInput` | 1 |
| `EventDraft.sourceRef`, `bodyOf` à la création seulement, `rowOf` | 1 |
| `scheduleTask` (principal ou premier `writer`, sans invités ni Meet, lien source en description) | 2 |
| `unscheduleTask` = `remove` via l'outbox | 9, 11 |
| `free-slots.ts` (3 × 30 min, quart d'heure, 9 h–18 h, jours suivants, journée entière et déclinés exclus, `ponytail:`) | 3 |
| `useSchedulableTasks` (3 sources, `sourceNoteId` exclus, `quadrantOf` exporté) | 4 |
| Carte des blocs J→J+60, « à planifier » = aucun bloc qui finit après maintenant | 4 |
| Tiroir repliable mémorisé, groupé par quadrant, compteur, Jour/Semaine, absent < 768 px | 8 |
| Glisser HTML5, aperçu 30 min, magnétisme 15 min, `scheduleTask` au lâcher | 7 |
| `EventBlock` : icône, barré/atténué si terminé ou introuvable, seulement sur `/agenda` | 5 |
| `EventDetail` : « Ouvrir la tâche », « Retirer du planning » | 9 |
| Pas de doublon puce/bloc, y compris panneau « Aujourd'hui » | 6 |
| Feuille : créneaux libres, autre créneau (30 min/1 h/2 h), déjà planifiée (Déplacer/Retirer), agenda non connecté | 11 |
| `MobileSheet` au téléphone, `Modal` sur ordinateur | 11 |
| `/todos` : « Planifier… », lignes email todo (« Planifier… », « Ouvrir le fil »), puce `mar. 14:00` | 13, 14 |
| Ouvrir la source (`/todos` en édition, `/mail?thread=`, `/notes/`) | 2, 9 |
| `/agenda` téléphone : action d'en-tête, liste groupée par quadrant, FAB inchangé | 12 |
| Hors ligne : outbox, « en attente », sortie immédiate du tiroir | 1, 4, 8 (mécanique existante) |
| e2e : glisser → POST `supernoteRef = todo:<id>` puis sortie du tiroir | 10 |
| e2e : 360 px, action d'en-tête + premier créneau → même POST | 15 |
| e2e : événement Google avec `supernoteRef` → icône de tâche | 10 |

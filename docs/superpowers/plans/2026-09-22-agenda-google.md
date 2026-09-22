# Agenda Google — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** un agenda Google Agenda complet dans Supernote (page `/agenda`, panneau « Aujourd'hui » dans `/mail`, note de réunion liée), adossé à un miroir local dans le worker.

**Architecture:** calque du miroir mail. Le thread principal parle à Google (`lib/gcal.ts` via `googleRequest` partagé) et pousse les données au worker par des routes tRPC `calendar.*` ; le worker les range dans quatre tables `cal_*` du coffre et sert les lectures. Les écritures sont optimistes : miroir + `cal_outbox`, vidangée par `CalendarRunner` monté dans le shell.

**Tech Stack:** React 19 + react-router, tRPC (`@supernote/ipc`, zod v4), SQLite wasm dans un Web Worker, HeroUI v3 / `@supernote/ui`, dnd-kit, Google Calendar API v3 (REST + GIS).

**Spec:** `docs/superpowers/specs/2026-09-22-agenda-google-design.md`

## Global Constraints

- UI en HeroUI v3 (`@heroui/react`) ou wrappers `@supernote/ui` ; pas d'autre lib UI, pas de lib de calendrier.
- Mobile dans le même mouvement : `useIsMobile` (< 768 px), cibles ≥ 32 px, pas de débordement horizontal, chrome mobile via `useMobileTitle` / `useMobileFab` / `useMobileHeaderActions`.
- TypeScript strict, pas de `any`. `pnpm typecheck` passe à la fin de chaque tâche.
- **Zéro test unitaire** (politique projet) : pas de `*.test.ts`, pas de vitest. Vérification = typecheck + e2e Playwright + banc navigateur.
- Les paquets `@supernote/*` sont consommés via `dist/` : après une modif de `packages/ipc`, `pnpm --filter @supernote/ipc build` avant le typecheck.
- Le zod de sortie IPC **strippe toute clé non déclarée** : tout champ renvoyé par une route doit être déclaré dans `packages/ipc/src/schemas/calendar.ts`.
- Animations uniquement via `lib/motion` / tokens `--sn-*` ; boutons icône = icône phosphor + `Tooltip` de `@supernote/ui` + `aria-label`.
- Commentaires en français, rares, uniquement le pourquoi.
- Commits : conventional commits en français, **seulement sur demande d'Amaury** ; jamais `git add -A` (d'autres sessions partagent l'arbre).
- Scopes Google : `https://www.googleapis.com/auth/calendar.events` et `https://www.googleapis.com/auth/calendar.calendarlist.readonly`.
- Fenêtre du miroir : J−60 → J+180 ; delta toutes les 5 min ; synchro complète toutes les 24 h ou quand la fenêtre a glissé de 7 jours.

---

## Carte des fichiers

| Fichier | Rôle |
|---|---|
| `apps/web/src/lib/vault-worker/sql.ts` (nouveau) | `row`, `rows`, `runInTransaction`, types `SqlRow` — sortis de `worker-router.ts` pour être partagés |
| `apps/web/src/lib/google-api.ts` (nouveau) | jeton, 401 → rejeu → reconnexion, par famille de scopes ; `googleRequest` |
| `apps/web/src/lib/gmail.ts` | `gmailRequest` devient un mince appel à `googleRequest` |
| `packages/ipc/src/schemas/calendar.ts` (nouveau) | contrats zod `calendar.*` |
| `packages/ipc/src/router/calendar.router.ts` (nouveau) | stubs du routeur |
| `packages/ipc/src/router/index.ts`, `packages/ipc/src/index.ts` | branchement et exports |
| `apps/web/src/lib/vault-worker/db-schema.ts` | tables `cal_*` |
| `apps/web/src/lib/vault-worker/calendar-routes.ts` (nouveau) | implémentation des routes `calendar.*` |
| `apps/web/src/lib/vault-worker/worker-router.ts` | branche `buildCalendarRoutes` |
| `apps/web/src/lib/gcal.ts` (nouveau) | client REST Google Calendar + conversion en lignes du miroir |
| `apps/web/src/lib/calendar-mirror.ts` (nouveau) | accès client au miroir, événements `CALENDAR_CHANGED_EVENT` / `CALENDAR_OUTBOX_EVENT` |
| `apps/web/src/lib/calendar-sync.ts` (nouveau) | moteur : fenêtre, delta, vidange de l'outbox, connexion |
| `apps/web/src/components/agenda/CalendarRunner.tsx` (nouveau) | cadence de synchro, monté dans `RootLayout.tsx` |
| `apps/web/src/lib/agenda/dates.ts`, `layout.ts` (nouveaux) | calcul de dates et placement des événements superposés |
| `apps/web/src/components/agenda/*` (nouveaux) | page, grilles, détail, éditeur, panneau « Aujourd'hui » |
| `apps/web/src/components/todos/useNoteChecklistTodos.ts` (nouveau) | matérialiseur de checklists extrait de `app/todos/page.tsx` |
| `apps/web/src/lib/meeting-note.ts` (nouveau) | création de la note de réunion |
| `apps/web/src/app/agenda/page.tsx` (nouveau), `router.tsx`, `lib/navigation/catalog.ts`, `messages/{fr,en}.json`, `lib/commands/seed.ts`, `components/command/CommandSurface.tsx` | route, navigation, palette |
| `apps/web/src/app/mail/page.tsx`, `components/mail/EmailToEventButton.tsx` | panneau « Aujourd'hui », mail → événement |
| `tests/e2e/03-navigate.spec.ts` | `/agenda` rendue |

---

## Lot 1 — Socle

### Task 1: Helpers SQL partagés

**Files:**
- Create: `apps/web/src/lib/vault-worker/sql.ts`
- Modify: `apps/web/src/lib/vault-worker/worker-router.ts` (définitions `SqlValue`, `SqlRow` l.54-55, `row`/`rows` l.73-84, `runInTransaction` et son commentaire l.180-212)

**Interfaces:**
- Produces: `export type SqlValue`, `export type SqlRow`, `export function row(res)`, `export function rows(res)`, `export function runInTransaction<T>(db, fn): T`

- [ ] **Step 1: Créer `sql.ts`** en déplaçant tel quel le code existant :

```ts
import type { Database } from "./sqlite-adapter";

export type SqlValue = string | number | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export function row(res: ReturnType<Database["exec"]>): SqlRow | null {
  if (!res.length || !res[0]) return null;
  const { columns, values } = res[0];
  if (!values.length || !values[0]) return null;
  return Object.fromEntries(columns.map((c, i) => [c, values[0]![i] ?? null]));
}

export function rows(res: ReturnType<Database["exec"]>): SqlRow[] {
  if (!res.length || !res[0]) return [];
  const { columns, values } = res[0];
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i] ?? null])));
}

// (déplacer ici le commentaire actuel de runInTransaction, inchangé)
export function runInTransaction<T>(db: Database, fn: () => T): T {
  db.run("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.run("COMMIT");
    return result;
  } catch (e) {
    try {
      db.run("ROLLBACK");
    } catch {
      /* pas de transaction active (BEGIN a échoué) — rien à annuler */
    }
    throw e;
  }
}
```

- [ ] **Step 2: Dans `worker-router.ts`**, supprimer les définitions déplacées et ajouter en tête : `import { row, rows, runInTransaction, type SqlValue, type SqlRow } from "./sql";`
- [ ] **Step 3: Vérifier** : `pnpm typecheck` → 15/15.

### Task 2: `googleRequest` partagé

**Files:**
- Create: `apps/web/src/lib/google-api.ts`
- Modify: `apps/web/src/lib/gmail.ts` (bloc « État reconnexion requise » l.47-120 environ, classes `GmailApiError` / `GmailAuthError`, `isTransientGmailError`)

**Interfaces:**
- Consumes: `requestAccessToken`, `hasValidToken`, `forgetAccessToken` de `lib/google-drive.ts`
- Produces:
  - `export class GoogleApiError extends Error { status: number }`
  - `export class GoogleAuthError extends Error`
  - `export const GOOGLE_AUTH_EVENT = "supernote:gmail-auth"` (valeur inchangée : les écouteurs existants continuent de marcher)
  - `export type GoogleScopeFamily = "gmail" | "calendar"`
  - `export function scopeFamily(scope: string): GoogleScopeFamily`
  - `export function googleReconnectRequired(family: GoogleScopeFamily): boolean`
  - `export function failedScopesOf(family: GoogleScopeFamily): string[]`
  - `export function markScopeRecovered(scope: string): void`
  - `export function isTransientGoogleError(err: unknown): boolean`
  - `export async function googleRequest(clientId: string, scope: string, url: string, init?: { method?: string; body?: string; json?: boolean; headers?: Record<string, string> }, label?: string): Promise<Response>`

- [ ] **Step 1: Créer `google-api.ts`** :

```ts
import { requestAccessToken, hasValidToken, forgetAccessToken } from "./google-drive";

export class GoogleApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export class GoogleAuthError extends Error {
  constructor(message = "Reconnexion Google requise") {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export const GOOGLE_AUTH_EVENT = "supernote:gmail-auth";

export type GoogleScopeFamily = "gmail" | "calendar";

export function scopeFamily(scope: string): GoogleScopeFamily {
  return scope.includes("/auth/calendar") ? "calendar" : "gmail";
}

const failedScopes = new Set<string>();

function setScopeFailed(scope: string, failed: boolean): void {
  const had = failedScopes.has(scope);
  if (failed) failedScopes.add(scope);
  else failedScopes.delete(scope);
  if (had !== failed && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(GOOGLE_AUTH_EVENT));
  }
}

export function failedScopesOf(family: GoogleScopeFamily): string[] {
  return [...failedScopes].filter((s) => scopeFamily(s) === family);
}

export function googleReconnectRequired(family: GoogleScopeFamily): boolean {
  return failedScopesOf(family).length > 0;
}

export function markScopeRecovered(scope: string): void {
  setScopeFailed(scope, false);
}

export function isTransientGoogleError(err: unknown): boolean {
  if (err instanceof GoogleAuthError) return true;
  if (err instanceof GoogleApiError) {
    // Google signale aussi ses quotas en 403 (`rateLimitExceeded`, `userRateLimitExceeded`).
    return err.status === 429 || err.status >= 500 || (err.status === 403 && /rateLimit|quota/i.test(err.message));
  }
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

const pendingTokens = new Map<string, Promise<string>>();

function acquireToken(clientId: string, scope: string): Promise<string> {
  if (hasValidToken(clientId, scope)) return requestAccessToken(clientId, { scope, prompt: "" });
  // Après un échec dans la même famille, plus de tentative automatique : GIS ne
  // passe que par une popup, bloquée hors geste. On attend le clic « Reconnecter ».
  if (googleReconnectRequired(scopeFamily(scope))) {
    setScopeFailed(scope, true);
    return Promise.reject(new GoogleAuthError());
  }
  const key = `${clientId} ${scope}`;
  const pending = pendingTokens.get(key);
  if (pending) return pending;
  const p = requestAccessToken(clientId, { scope, prompt: "" })
    .catch((err: unknown) => {
      setScopeFailed(scope, true);
      throw new GoogleAuthError(err instanceof Error ? err.message : String(err));
    })
    .finally(() => pendingTokens.delete(key));
  pendingTokens.set(key, p);
  return p;
}

/** Sur 401, le token est oublié et l'appel rejoué une fois ; un second refus lève la reconnexion. */
export async function googleRequest(
  clientId: string,
  scope: string,
  url: string,
  init: { method?: string; body?: string; json?: boolean; headers?: Record<string, string> } = {},
  label = "Google API",
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const token = await acquireToken(clientId, scope);
    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.json ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    if (res.status === 401) {
      forgetAccessToken(token);
      if (attempt === 0) continue;
      setScopeFailed(scope, true);
      throw new GoogleAuthError("401");
    }
    setScopeFailed(scope, false);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new GoogleApiError(res.status, `${label} ${res.status}: ${text.slice(0, 300)}`);
    }
    return res;
  }
}
```

- [ ] **Step 2: Réduire `gmail.ts`** :
  - supprimer `failedScopes`, `setScopeFailed`, `pendingTokens`, `acquireToken`, et remplacer le corps de `gmailRequest` par `return googleRequest(clientId, scope, \`${GMAIL_API_BASE}${path}\`, init, label);` ;
  - remplacer les définitions de `GmailApiError` / `GmailAuthError` par `export { GoogleApiError as GmailApiError, GoogleAuthError as GmailAuthError } from "./google-api";` et `isTransientGmailError` par un ré-export de `isTransientGoogleError` sous le même nom ;
  - `export const GMAIL_AUTH_EVENT = GOOGLE_AUTH_EVENT;`
  - `export function gmailReconnectRequired(): boolean { return googleReconnectRequired("gmail"); }`
  - dans `reconnectGmail`, `new Set([GMAIL_READONLY_SCOPE, ...failedScopesOf("gmail")])` et `markScopeRecovered(s)` au lieu de `setScopeFailed(s, false)`.
- [ ] **Step 3: Vérifier** : `grep -n "failedScopes\|setScopeFailed" apps/web/src/lib/gmail.ts` → aucun résultat ; `pnpm typecheck` → 15/15.

### Task 3: Contrats IPC `calendar.*`

**Files:**
- Create: `packages/ipc/src/schemas/calendar.ts`, `packages/ipc/src/router/calendar.router.ts`
- Modify: `packages/ipc/src/router/index.ts` (ajouter `calendar: calendarRouter` dans `appRouter` + export), `packages/ipc/src/index.ts` (`export * from "./schemas/calendar.js";` et `export { calendarRouter, type CalendarRouter } from "./router/calendar.router.js";`)

**Interfaces:**
- Produces (noms préfixés `Cal`/`Calendar` : `export *` ne doit pas entrer en collision avec `schemas/mail.ts`) : `CalAttendee`, `CalCalendarRow`, `CalEventInput`, `CalEventRow`, `CalOutboxItem`, `CalOverlayItem`, et les paires `Calendar*Input` / `Calendar*Output` ci-dessous.

- [ ] **Step 1: `schemas/calendar.ts`** :

```ts
import { z } from "zod";

/**
 * Contrats du miroir Google Agenda (tables `cal_*` du coffre). Google reste la
 * source de vérité ; le thread principal fait le réseau, le worker range et sert.
 */

export const CalAttendeeSchema = z.object({
  email: z.string(),
  name: z.string(),
  responseStatus: z.string(),
  self: z.boolean(),
  organizer: z.boolean(),
});
export type CalAttendee = z.infer<typeof CalAttendeeSchema>;

export const CalCalendarRowSchema = z.object({
  id: z.string(),
  summary: z.string(),
  backgroundColor: z.string(),
  foregroundColor: z.string(),
  selected: z.boolean(),
  primary: z.boolean(),
  accessRole: z.string(),
});
export type CalCalendarRow = z.infer<typeof CalCalendarRowSchema>;

/** Événement tel que le moteur l'écrit dans le miroir. */
export const CalEventInputSchema = z.object({
  calendarId: z.string(),
  id: z.string(),
  summary: z.string(),
  description: z.string(),
  location: z.string(),
  startAt: z.number(),
  endAt: z.number(),
  allDay: z.boolean(),
  /** `YYYY-MM-DD` pour un événement sur la journée entière, sinon vide. */
  startDate: z.string(),
  /** Date de fin exclusive (convention Google), `YYYY-MM-DD` ou vide. */
  endDate: z.string(),
  status: z.string(),
  recurringEventId: z.string(),
  htmlLink: z.string(),
  meetUrl: z.string(),
  attendees: z.array(CalAttendeeSchema),
  selfResponse: z.string(),
  etag: z.string(),
  colorId: z.string(),
});
export type CalEventInput = z.infer<typeof CalEventInputSchema>;

/** Événement lu par l'interface. */
export const CalEventRowSchema = CalEventInputSchema.extend({
  /** Une écriture de l'outbox attend encore Google. */
  pending: z.boolean(),
  /** Note de réunion liée (`fields.gcalEventId`), s'il y en a une. */
  noteId: z.string().nullable(),
});
export type CalEventRow = z.infer<typeof CalEventRowSchema>;

export const CalOutboxKindSchema = z.enum(["create", "patch", "delete", "rsvp"]);
export type CalOutboxKind = z.infer<typeof CalOutboxKindSchema>;

export const CalOutboxItemSchema = z.object({
  opId: z.string(),
  calendarId: z.string(),
  eventId: z.string(),
  kind: CalOutboxKindSchema,
  /** Corps Google prêt à envoyer (création/patch) et options (`conference`, `etag`). */
  payload: z.record(z.string(), z.unknown()),
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.number(),
  createdAt: z.number(),
});
export type CalOutboxItem = z.infer<typeof CalOutboxItemSchema>;

export const CalOverlayItemSchema = z.object({
  kind: z.enum(["todo", "base"]),
  entityId: z.string(),
  typeId: z.string(),
  typeName: z.string(),
  fieldLabel: z.string(),
  title: z.string(),
  /** `YYYY-MM-DD`. */
  date: z.string(),
});
export type CalOverlayItem = z.infer<typeof CalOverlayItemSchema>;

export const CalSyncStateSchema = z.object({
  calendarId: z.string(),
  updatedMin: z.string(),
  windowStart: z.number(),
  windowEnd: z.number(),
  lastFullSyncAt: z.number(),
  lastSyncAt: z.number(),
});
export type CalSyncState = z.infer<typeof CalSyncStateSchema>;

// ── calendar.syncUpsert ─────────────────────────────────────────────────────
export const CalendarSyncUpsertInput = z.object({
  accountId: z.string(),
  calendars: z.array(CalCalendarRowSchema).optional(),
  /** Synchro complète : les événements de ces fenêtres absents de `events` sont retirés. */
  replaceWindows: z.array(z.object({ calendarId: z.string(), from: z.number(), to: z.number() })).optional(),
  events: z.array(CalEventInputSchema).optional(),
  removals: z.array(z.object({ calendarId: z.string(), id: z.string() })).optional(),
  states: z
    .array(
      z.object({
        calendarId: z.string(),
        updatedMin: z.string(),
        windowStart: z.number(),
        windowEnd: z.number(),
        fullSync: z.boolean(),
      }),
    )
    .optional(),
});
export type CalendarSyncUpsertInput = z.infer<typeof CalendarSyncUpsertInput>;
export const CalendarSyncUpsertOutput = z.object({ events: z.number().int(), removed: z.number().int() });
export type CalendarSyncUpsertOutput = z.infer<typeof CalendarSyncUpsertOutput>;

// ── calendar.listEvents ─────────────────────────────────────────────────────
export const CalendarListEventsInput = z.object({ accountId: z.string(), from: z.number(), to: z.number() });
export type CalendarListEventsInput = z.infer<typeof CalendarListEventsInput>;
export const CalendarListEventsOutput = z.object({ events: z.array(CalEventRowSchema) });
export type CalendarListEventsOutput = z.infer<typeof CalendarListEventsOutput>;

// ── calendar.listCalendars / getState / clear ───────────────────────────────
export const CalendarAccountInput = z.object({ accountId: z.string() });
export type CalendarAccountInput = z.infer<typeof CalendarAccountInput>;
export const CalendarListCalendarsOutput = z.object({ calendars: z.array(CalCalendarRowSchema) });
export type CalendarListCalendarsOutput = z.infer<typeof CalendarListCalendarsOutput>;
export const CalendarGetStateOutput = z.object({ states: z.array(CalSyncStateSchema) });
export type CalendarGetStateOutput = z.infer<typeof CalendarGetStateOutput>;
export const CalendarOkOutput = z.object({ ok: z.boolean() });
export type CalendarOkOutput = z.infer<typeof CalendarOkOutput>;

// ── calendar.applyLocalMutation ─────────────────────────────────────────────
export const CalendarApplyLocalMutationInput = z.object({
  accountId: z.string(),
  opId: z.string(),
  kind: CalOutboxKindSchema,
  calendarId: z.string(),
  eventId: z.string(),
  /** Nouvel état de la ligne du miroir (create, patch, rsvp). Absent pour delete. */
  event: CalEventInputSchema.optional(),
  payload: z.record(z.string(), z.unknown()),
});
export type CalendarApplyLocalMutationInput = z.infer<typeof CalendarApplyLocalMutationInput>;

// ── calendar.listOutbox / resolveOutbox ─────────────────────────────────────
export const CalendarListOutboxOutput = z.object({ items: z.array(CalOutboxItemSchema) });
export type CalendarListOutboxOutput = z.infer<typeof CalendarListOutboxOutput>;

export const CalendarResolveOutboxInput = z.object({
  accountId: z.string(),
  opId: z.string(),
  outcome: z.enum(["ack", "fail", "drop"]),
  error: z.string().optional(),
  /** Report du prochain essai (fail). */
  nextAttemptAt: z.number().optional(),
  /** État Google après ack : remplace la ligne (et l'id `local-…` d'une création). */
  event: CalEventInputSchema.optional(),
});
export type CalendarResolveOutboxInput = z.infer<typeof CalendarResolveOutboxInput>;

// ── calendar.overlay ────────────────────────────────────────────────────────
export const CalendarOverlayInput = z.object({ from: z.string(), to: z.string() });
export type CalendarOverlayInput = z.infer<typeof CalendarOverlayInput>;
export const CalendarOverlayOutput = z.object({ items: z.array(CalOverlayItemSchema) });
export type CalendarOverlayOutput = z.infer<typeof CalendarOverlayOutput>;
```

- [ ] **Step 2: `router/calendar.router.ts`** (même forme que `mail.router.ts`) :

```ts
import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  CalendarSyncUpsertInput, CalendarSyncUpsertOutput,
  CalendarListEventsInput, CalendarListEventsOutput,
  CalendarAccountInput, CalendarListCalendarsOutput, CalendarGetStateOutput, CalendarOkOutput,
  CalendarApplyLocalMutationInput, CalendarListOutboxOutput, CalendarResolveOutboxInput,
  CalendarOverlayInput, CalendarOverlayOutput,
} from "../schemas/calendar.js";

/** Miroir Google Agenda — implémenté par le worker du coffre (`calendar-routes.ts`). */
export const calendarRouter = router({
  syncUpsert: publicProcedure.input(CalendarSyncUpsertInput).output(CalendarSyncUpsertOutput)
    .mutation(() => { throw notImplemented("calendar.syncUpsert"); }),
  listEvents: publicProcedure.input(CalendarListEventsInput).output(CalendarListEventsOutput)
    .query(() => { throw notImplemented("calendar.listEvents"); }),
  listCalendars: publicProcedure.input(CalendarAccountInput).output(CalendarListCalendarsOutput)
    .query(() => { throw notImplemented("calendar.listCalendars"); }),
  getState: publicProcedure.input(CalendarAccountInput).output(CalendarGetStateOutput)
    .query(() => { throw notImplemented("calendar.getState"); }),
  applyLocalMutation: publicProcedure.input(CalendarApplyLocalMutationInput).output(CalendarOkOutput)
    .mutation(() => { throw notImplemented("calendar.applyLocalMutation"); }),
  listOutbox: publicProcedure.input(CalendarAccountInput).output(CalendarListOutboxOutput)
    .query(() => { throw notImplemented("calendar.listOutbox"); }),
  resolveOutbox: publicProcedure.input(CalendarResolveOutboxInput).output(CalendarOkOutput)
    .mutation(() => { throw notImplemented("calendar.resolveOutbox"); }),
  clear: publicProcedure.input(CalendarAccountInput).output(CalendarOkOutput)
    .mutation(() => { throw notImplemented("calendar.clear"); }),
  overlay: publicProcedure.input(CalendarOverlayInput).output(CalendarOverlayOutput)
    .query(() => { throw notImplemented("calendar.overlay"); }),
});
export type CalendarRouter = typeof calendarRouter;
```

- [ ] **Step 3: Brancher** dans `router/index.ts` (`import { calendarRouter } from "./calendar.router.js";`, `calendar: calendarRouter,` après `mail`) et exporter depuis `index.ts`.
- [ ] **Step 4: Vérifier** : `pnpm --filter @supernote/ipc build` puis `pnpm typecheck` → 15/15.

### Task 4: Tables et routes du worker

**Files:**
- Modify: `apps/web/src/lib/vault-worker/db-schema.ts` (dans `SCHEMA_SQL_BASE`, après `mail_outbox` et avant les index mail)
- Create: `apps/web/src/lib/vault-worker/calendar-routes.ts`
- Modify: `apps/web/src/lib/vault-worker/worker-router.ts` (map de routes finale, l.~5250)

**Interfaces:**
- Consumes: `row`, `rows`, `runInTransaction`, `SqlRow` (Task 1) ; contrats Task 3
- Produces: `export function buildCalendarRoutes(db: Database, vaultId: string): Record<string, RouteHandler>` avec les clés `calendar.syncUpsert`, `calendar.listEvents`, `calendar.listCalendars`, `calendar.getState`, `calendar.applyLocalMutation`, `calendar.listOutbox`, `calendar.resolveOutbox`, `calendar.clear`, `calendar.overlay`

- [ ] **Step 1: DDL** (ajout à `SCHEMA_SQL_BASE`) :

```sql
-- Miroir Google Agenda, local à l'appareil (hors op-log) comme le miroir mail.
CREATE TABLE IF NOT EXISTS "cal_calendar" (
    "accountId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "backgroundColor" TEXT NOT NULL DEFAULT '',
    "foregroundColor" TEXT NOT NULL DEFAULT '',
    "selected" INTEGER NOT NULL DEFAULT 1,
    "isPrimary" INTEGER NOT NULL DEFAULT 0,
    "accessRole" TEXT NOT NULL DEFAULT 'reader',
    "updatedAt" INTEGER NOT NULL,
    PRIMARY KEY ("accountId", "id")
);

CREATE TABLE IF NOT EXISTS "cal_event" (
    "accountId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "startAt" INTEGER NOT NULL,
    "endAt" INTEGER NOT NULL,
    "allDay" INTEGER NOT NULL DEFAULT 0,
    "startDate" TEXT NOT NULL DEFAULT '',
    "endDate" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'confirmed',
    "recurringEventId" TEXT NOT NULL DEFAULT '',
    "htmlLink" TEXT NOT NULL DEFAULT '',
    "meetUrl" TEXT NOT NULL DEFAULT '',
    "attendeesJson" TEXT NOT NULL DEFAULT '[]',
    "selfResponse" TEXT NOT NULL DEFAULT '',
    "etag" TEXT NOT NULL DEFAULT '',
    "colorId" TEXT NOT NULL DEFAULT '',
    "updatedAt" INTEGER NOT NULL,
    PRIMARY KEY ("accountId", "calendarId", "id")
);

CREATE TABLE IF NOT EXISTS "cal_sync_state" (
    "accountId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "updatedMin" TEXT NOT NULL DEFAULT '',
    "windowStart" INTEGER NOT NULL DEFAULT 0,
    "windowEnd" INTEGER NOT NULL DEFAULT 0,
    "lastFullSyncAt" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY ("accountId", "calendarId")
);

CREATE TABLE IF NOT EXISTS "cal_outbox" (
    "opId" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastError" TEXT
);

CREATE INDEX IF NOT EXISTS "cal_event_account_start_idx" ON "cal_event" ("accountId", "startAt");
CREATE INDEX IF NOT EXISTS "cal_outbox_account_status_idx" ON "cal_outbox" ("accountId", "status");
```

(`isPrimary` et non `primary` : mot réservé SQL.)

- [ ] **Step 2: `calendar-routes.ts`** :

```ts
import type { Database } from "./sqlite-adapter";
import type { RouteHandler } from "./worker-router";
import { row, rows, runInTransaction, type SqlRow } from "./sql";
import type {
  CalendarSyncUpsertInput, CalendarListEventsInput, CalendarAccountInput,
  CalendarApplyLocalMutationInput, CalendarResolveOutboxInput, CalendarOverlayInput,
  CalEventInput, CalOverlayItem,
} from "@supernote/ipc";

const MAX_ATTEMPTS = 5;

function eventParams(accountId: string, e: CalEventInput, ts: number): (string | number)[] {
  return [
    accountId, e.calendarId, e.id, e.summary, e.description, e.location, e.startAt, e.endAt,
    e.allDay ? 1 : 0, e.startDate, e.endDate, e.status, e.recurringEventId, e.htmlLink, e.meetUrl,
    JSON.stringify(e.attendees), e.selfResponse, e.etag, e.colorId, ts,
  ];
}

const UPSERT_EVENT = `INSERT INTO cal_event
  (accountId, calendarId, id, summary, description, location, startAt, endAt, allDay, startDate, endDate,
   status, recurringEventId, htmlLink, meetUrl, attendeesJson, selfResponse, etag, colorId, updatedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(accountId, calendarId, id) DO UPDATE SET
    summary = excluded.summary, description = excluded.description, location = excluded.location,
    startAt = excluded.startAt, endAt = excluded.endAt, allDay = excluded.allDay,
    startDate = excluded.startDate, endDate = excluded.endDate, status = excluded.status,
    recurringEventId = excluded.recurringEventId, htmlLink = excluded.htmlLink, meetUrl = excluded.meetUrl,
    attendeesJson = excluded.attendeesJson, selfResponse = excluded.selfResponse, etag = excluded.etag,
    colorId = excluded.colorId, updatedAt = excluded.updatedAt`;

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toEventRow(r: SqlRow) {
  return {
    calendarId: String(r["calendarId"]),
    id: String(r["id"]),
    summary: String(r["summary"] ?? ""),
    description: String(r["description"] ?? ""),
    location: String(r["location"] ?? ""),
    startAt: Number(r["startAt"]),
    endAt: Number(r["endAt"]),
    allDay: Number(r["allDay"]) === 1,
    startDate: String(r["startDate"] ?? ""),
    endDate: String(r["endDate"] ?? ""),
    status: String(r["status"] ?? ""),
    recurringEventId: String(r["recurringEventId"] ?? ""),
    htmlLink: String(r["htmlLink"] ?? ""),
    meetUrl: String(r["meetUrl"] ?? ""),
    attendees: parseJson(r["attendeesJson"], []),
    selfResponse: String(r["selfResponse"] ?? ""),
    etag: String(r["etag"] ?? ""),
    colorId: String(r["colorId"] ?? ""),
    pending: Number(r["pending"]) === 1,
    noteId: typeof r["noteId"] === "string" ? (r["noteId"] as string) : null,
  };
}

/** Titre lisible d'une entité de base : champ titre/nom connu, sinon premier texte court. */
function entityTitle(fields: Record<string, unknown>, fallback: string): string {
  for (const key of ["title", "name", "per_name"]) {
    const v = fields[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const first = Object.values(fields).find((v) => typeof v === "string" && v.trim() && v.length < 120);
  return typeof first === "string" ? first.trim() : fallback;
}

export function buildCalendarRoutes(db: Database, vaultId: string): Record<string, RouteHandler> {
  const syncUpsert = async (input: unknown): Promise<unknown> => {
    const { accountId, calendars, replaceWindows, events, removals, states } = input as CalendarSyncUpsertInput;
    const ts = Date.now();
    return runInTransaction(db, () => {
      let removed = 0;
      for (const c of calendars ?? []) {
        db.run(
          `INSERT INTO cal_calendar (accountId, id, summary, backgroundColor, foregroundColor, selected, isPrimary, accessRole, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(accountId, id) DO UPDATE SET summary = excluded.summary,
             backgroundColor = excluded.backgroundColor, foregroundColor = excluded.foregroundColor,
             selected = excluded.selected, isPrimary = excluded.isPrimary, accessRole = excluded.accessRole,
             updatedAt = excluded.updatedAt`,
          [accountId, c.id, c.summary, c.backgroundColor, c.foregroundColor, c.selected ? 1 : 0, c.primary ? 1 : 0, c.accessRole, ts],
        );
      }
      if (calendars) {
        // Un agenda retiré du compte emporte ses événements.
        const keep = new Set(calendars.map((c) => c.id));
        for (const r of rows(db.exec(`SELECT id FROM cal_calendar WHERE accountId = ?`, [accountId]))) {
          const id = String(r["id"]);
          if (keep.has(id)) continue;
          db.run(`DELETE FROM cal_calendar WHERE accountId = ? AND id = ?`, [accountId, id]);
          db.run(`DELETE FROM cal_event WHERE accountId = ? AND calendarId = ?`, [accountId, id]);
          db.run(`DELETE FROM cal_sync_state WHERE accountId = ? AND calendarId = ?`, [accountId, id]);
        }
      }
      for (const w of replaceWindows ?? []) {
        // Une écriture encore en file garde sa ligne : Google ne la connaît pas encore.
        db.run(
          `DELETE FROM cal_event WHERE accountId = ? AND calendarId = ? AND endAt >= ? AND startAt <= ?
             AND id NOT IN (SELECT eventId FROM cal_outbox WHERE accountId = ? AND status = 'pending')`,
          [accountId, w.calendarId, w.from, w.to, accountId],
        );
      }
      for (const e of events ?? []) db.run(UPSERT_EVENT, eventParams(accountId, e, ts));
      for (const r of removals ?? []) {
        db.run(`DELETE FROM cal_event WHERE accountId = ? AND calendarId = ? AND id = ?`, [accountId, r.calendarId, r.id]);
        removed++;
      }
      for (const s of states ?? []) {
        db.run(
          `INSERT INTO cal_sync_state (accountId, calendarId, updatedMin, windowStart, windowEnd, lastFullSyncAt, lastSyncAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(accountId, calendarId) DO UPDATE SET updatedMin = excluded.updatedMin,
             windowStart = excluded.windowStart, windowEnd = excluded.windowEnd,
             lastFullSyncAt = CASE WHEN ? = 1 THEN excluded.lastSyncAt ELSE cal_sync_state.lastFullSyncAt END,
             lastSyncAt = excluded.lastSyncAt`,
          [accountId, s.calendarId, s.updatedMin, s.windowStart, s.windowEnd, s.fullSync ? ts : 0, ts, s.fullSync ? 1 : 0],
        );
      }
      return { events: events?.length ?? 0, removed };
    });
  };

  const listEvents = async (input: unknown): Promise<unknown> => {
    const { accountId, from, to } = input as CalendarListEventsInput;
    const res = db.exec(
      `SELECT e.*,
          (SELECT n.id FROM entity n WHERE n.vaultId = ? AND n.typeId = 'note'
             AND json_extract(n.fields, '$.gcalEventId') = e.id LIMIT 1) AS noteId,
          EXISTS (SELECT 1 FROM cal_outbox o WHERE o.accountId = e.accountId AND o.eventId = e.id
                    AND o.status = 'pending') AS pending
         FROM cal_event e
         JOIN cal_calendar c ON c.accountId = e.accountId AND c.id = e.calendarId
        WHERE e.accountId = ? AND c.selected = 1 AND e.status != 'cancelled'
          AND e.endAt >= ? AND e.startAt <= ?
        ORDER BY e.startAt ASC`,
      [vaultId, accountId, from, to],
    );
    return { events: rows(res).map(toEventRow) };
  };

  const listCalendars = async (input: unknown): Promise<unknown> => {
    const { accountId } = input as CalendarAccountInput;
    const res = db.exec(`SELECT * FROM cal_calendar WHERE accountId = ? ORDER BY isPrimary DESC, summary`, [accountId]);
    return {
      calendars: rows(res).map((r) => ({
        id: String(r["id"]),
        summary: String(r["summary"] ?? ""),
        backgroundColor: String(r["backgroundColor"] ?? ""),
        foregroundColor: String(r["foregroundColor"] ?? ""),
        selected: Number(r["selected"]) === 1,
        primary: Number(r["isPrimary"]) === 1,
        accessRole: String(r["accessRole"] ?? "reader"),
      })),
    };
  };

  const getState = async (input: unknown): Promise<unknown> => {
    const { accountId } = input as CalendarAccountInput;
    const res = db.exec(`SELECT * FROM cal_sync_state WHERE accountId = ?`, [accountId]);
    return {
      states: rows(res).map((r) => ({
        calendarId: String(r["calendarId"]),
        updatedMin: String(r["updatedMin"] ?? ""),
        windowStart: Number(r["windowStart"]) || 0,
        windowEnd: Number(r["windowEnd"]) || 0,
        lastFullSyncAt: Number(r["lastFullSyncAt"]) || 0,
        lastSyncAt: Number(r["lastSyncAt"]) || 0,
      })),
    };
  };

  const applyLocalMutation = async (input: unknown): Promise<unknown> => {
    const m = input as CalendarApplyLocalMutationInput;
    const ts = Date.now();
    return runInTransaction(db, () => {
      if (m.kind === "delete") {
        db.run(`DELETE FROM cal_event WHERE accountId = ? AND calendarId = ? AND id = ?`, [m.accountId, m.calendarId, m.eventId]);
      } else if (m.event) {
        db.run(UPSERT_EVENT, eventParams(m.accountId, m.event, ts));
      }
      db.run(
        `INSERT INTO cal_outbox (opId, accountId, calendarId, eventId, kind, payloadJson, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [m.opId, m.accountId, m.calendarId, m.eventId, m.kind, JSON.stringify(m.payload), ts],
      );
      return { ok: true };
    });
  };

  const listOutbox = async (input: unknown): Promise<unknown> => {
    const { accountId } = input as CalendarAccountInput;
    const res = db.exec(
      `SELECT * FROM cal_outbox WHERE accountId = ? AND status = 'pending' ORDER BY createdAt ASC`,
      [accountId],
    );
    return {
      items: rows(res).map((r) => ({
        opId: String(r["opId"]),
        calendarId: String(r["calendarId"]),
        eventId: String(r["eventId"]),
        kind: String(r["kind"]),
        payload: parseJson<Record<string, unknown>>(r["payloadJson"], {}),
        attempts: Number(r["attempts"]) || 0,
        nextAttemptAt: Number(r["nextAttemptAt"]) || 0,
        createdAt: Number(r["createdAt"]) || 0,
      })),
    };
  };

  const resolveOutbox = async (input: unknown): Promise<unknown> => {
    const r = input as CalendarResolveOutboxInput;
    const op = row(db.exec(`SELECT * FROM cal_outbox WHERE opId = ?`, [r.opId]));
    if (!op) return { ok: false };
    const calendarId = String(op["calendarId"]);
    const localId = String(op["eventId"]);
    const ts = Date.now();
    return runInTransaction(db, () => {
      if (r.outcome === "fail") {
        db.run(
          `UPDATE cal_outbox SET attempts = attempts + 1, lastError = ?, nextAttemptAt = ?,
             status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END
           WHERE opId = ?`,
          [r.error ?? "", r.nextAttemptAt ?? 0, MAX_ATTEMPTS, r.opId],
        );
        return { ok: true };
      }
      db.run(`DELETE FROM cal_outbox WHERE opId = ?`, [r.opId]);
      if (r.event) {
        if (r.event.id !== localId) {
          // Création acquittée : l'id provisoire cède la place à l'id Google, y compris dans les ops suivantes.
          db.run(`DELETE FROM cal_event WHERE accountId = ? AND calendarId = ? AND id = ?`, [r.accountId, calendarId, localId]);
          db.run(`UPDATE cal_outbox SET eventId = ? WHERE accountId = ? AND eventId = ?`, [r.event.id, r.accountId, localId]);
        }
        db.run(UPSERT_EVENT, eventParams(r.accountId, r.event, ts));
      }
      return { ok: true };
    });
  };

  const clear = async (input: unknown): Promise<unknown> => {
    const { accountId } = input as CalendarAccountInput;
    runInTransaction(db, () => {
      for (const t of ["cal_event", "cal_calendar", "cal_sync_state", "cal_outbox"]) {
        db.run(`DELETE FROM ${t} WHERE accountId = ?`, [accountId]);
      }
    });
    return { ok: true };
  };

  const overlay = async (input: unknown): Promise<unknown> => {
    const { from, to } = input as CalendarOverlayInput;
    const items: CalOverlayItem[] = [];
    const todos = rows(db.exec(
      `SELECT id, fields FROM entity WHERE vaultId = ? AND typeId = 'todo'
         AND substr(COALESCE(json_extract(fields, '$.dueDate'), json_extract(fields, '$.startDate')), 1, 10) BETWEEN ? AND ?`,
      [vaultId, from, to],
    ));
    for (const t of todos) {
      const f = parseJson<Record<string, unknown>>(t["fields"], {});
      if (f["done"] === true || f["done"] === "true") continue;
      // Anciennes tâches projetées depuis une note : la checklist de la note fait foi.
      if (typeof f["sourceNoteId"] === "string" && f["sourceNoteId"]) continue;
      const date = String(f["dueDate"] ?? f["startDate"] ?? "").slice(0, 10);
      items.push({ kind: "todo", entityId: String(t["id"]), typeId: "todo", typeName: "Todo", fieldLabel: "Échéance", title: String(f["text"] ?? "(sans texte)"), date });
    }
    const types = rows(db.exec(
      `SELECT id, name, fields FROM entity_type WHERE vaultId = ? AND id NOT IN ('todo', 'note', 'template', 'vault_mount')`,
      [vaultId],
    ));
    for (const t of types) {
      const defs = parseJson<Array<{ id?: string; name?: string; label?: string; type?: string; kind?: string }>>(t["fields"], []);
      for (const d of defs) {
        if ((d.type ?? d.kind) !== "date") continue;
        const key = d.id || d.name;
        if (!key) continue;
        const res = db.exec(
          `SELECT id, fields FROM entity WHERE vaultId = ? AND typeId = ?
             AND substr(json_extract(fields, '$."' || ? || '"'), 1, 10) BETWEEN ? AND ?`,
          [vaultId, String(t["id"]), key, from, to],
        );
        for (const e of rows(res)) {
          const f = parseJson<Record<string, unknown>>(e["fields"], {});
          items.push({
            kind: "base",
            entityId: String(e["id"]),
            typeId: String(t["id"]),
            typeName: String(t["name"] ?? ""),
            fieldLabel: d.label ?? d.name ?? key,
            title: entityTitle(f, String(t["name"] ?? "")),
            date: String(f[key] ?? "").slice(0, 10),
          });
        }
      }
    }
    return { items };
  };

  return {
    "calendar.syncUpsert": syncUpsert,
    "calendar.listEvents": listEvents,
    "calendar.listCalendars": listCalendars,
    "calendar.getState": getState,
    "calendar.applyLocalMutation": applyLocalMutation,
    "calendar.listOutbox": listOutbox,
    "calendar.resolveOutbox": resolveOutbox,
    "calendar.clear": clear,
    "calendar.overlay": overlay,
  };
}
```

- [ ] **Step 3: Brancher** dans la map finale de `buildRouter` : `...buildCalendarRoutes(db, vaultId),` après les routes `mail.*`, et `import { buildCalendarRoutes } from "./calendar-routes";` en tête.
- [ ] **Step 4: Vérifier** : `pnpm typecheck` → 15/15. Vérifier dans la console du worker (`window.__supernoteWorker`, cf. mémoire FTS) que `calendar.listEvents({ accountId: "x", from: 0, to: 1 })` renvoie `{ events: [] }` sur un coffre existant (les tables sont créées au démarrage).

### Task 5: Client REST Google Calendar

**Files:**
- Create: `apps/web/src/lib/gcal.ts`

**Interfaces:**
- Consumes: `googleRequest`, `GoogleApiError` (Task 2) ; types `CalCalendarRow`, `CalEventInput`, `CalAttendee` de `@supernote/ipc`
- Produces:
  - `CALENDAR_EVENTS_SCOPE`, `CALENDAR_LIST_SCOPE`, `CALENDAR_SCOPES: readonly string[]`
  - `interface GcalEventResource` (sous-ensemble utilisé de l'API)
  - `listCalendars(clientId): Promise<CalCalendarRow[]>`
  - `listEventsPage(clientId, calendarId, q: { timeMin: string; timeMax: string; updatedMin?: string; pageToken?: string }): Promise<{ items: GcalEventResource[]; nextPageToken?: string }>`
  - `insertEvent(clientId, calendarId, body: GcalEventBody, opts: { meet: boolean }): Promise<GcalEventResource>`
  - `patchEvent(clientId, calendarId, eventId, body: GcalEventBody, etag?: string): Promise<GcalEventResource>`
  - `deleteEvent(clientId, calendarId, eventId): Promise<void>`
  - `toEventInput(calendarId, ev: GcalEventResource): CalEventInput`
  - `type GcalEventBody` (corps d'insert/patch)

- [ ] **Step 1: Écrire `gcal.ts`** :

```ts
import type { CalAttendee, CalCalendarRow, CalEventInput } from "@supernote/ipc";
import { googleRequest, GoogleApiError } from "./google-api";

export const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const CALENDAR_SCOPES: readonly string[] = [CALENDAR_EVENTS_SCOPE, CALENDAR_LIST_SCOPE];

const BASE = "https://www.googleapis.com/calendar/v3";

interface GcalTime { dateTime?: string; date?: string; timeZone?: string }

export interface GcalEventResource {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GcalTime;
  end?: GcalTime;
  recurringEventId?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string; self?: boolean; organizer?: boolean }>;
  organizer?: { self?: boolean };
  etag?: string;
  colorId?: string;
}

export interface GcalEventBody {
  summary?: string;
  description?: string;
  location?: string;
  start?: GcalTime;
  end?: GcalTime;
  attendees?: Array<{ email: string; responseStatus?: string }>;
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

export async function listCalendars(clientId: string): Promise<CalCalendarRow[]> {
  const out: CalCalendarRow[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ minAccessRole: "reader", maxResults: "250" });
    if (pageToken) q.set("pageToken", pageToken);
    const page = await json<{
      items?: Array<{ id: string; summary?: string; summaryOverride?: string; backgroundColor?: string; foregroundColor?: string; selected?: boolean; primary?: boolean; accessRole?: string }>;
      nextPageToken?: string;
    }>(await googleRequest(clientId, CALENDAR_LIST_SCOPE, `${BASE}/users/me/calendarList?${q}`, {}, "Calendar list"));
    for (const c of page.items ?? []) {
      out.push({
        id: c.id,
        summary: c.summaryOverride || c.summary || c.id,
        backgroundColor: c.backgroundColor ?? "",
        foregroundColor: c.foregroundColor ?? "",
        selected: c.selected === true || c.primary === true,
        primary: c.primary === true,
        accessRole: c.accessRole ?? "reader",
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

export async function listEventsPage(
  clientId: string,
  calendarId: string,
  q: { timeMin: string; timeMax: string; updatedMin?: string; pageToken?: string },
): Promise<{ items: GcalEventResource[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    singleEvents: "true",
    maxResults: "2500",
    timeMin: q.timeMin,
    timeMax: q.timeMax,
    showDeleted: q.updatedMin ? "true" : "false",
  });
  if (q.updatedMin) params.set("updatedMin", q.updatedMin);
  if (q.pageToken) params.set("pageToken", q.pageToken);
  return json(await googleRequest(clientId, CALENDAR_EVENTS_SCOPE, `${BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params}`, {}, "Calendar events"));
}

export async function insertEvent(clientId: string, calendarId: string, body: GcalEventBody, opts: { meet: boolean }): Promise<GcalEventResource> {
  const payload = opts.meet
    ? { ...body, conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }
    : body;
  return json(await googleRequest(
    clientId, CALENDAR_EVENTS_SCOPE,
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
    { method: "POST", json: true, body: JSON.stringify(payload) }, "Calendar insert",
  ));
}

export async function patchEvent(clientId: string, calendarId: string, eventId: string, body: GcalEventBody, etag?: string): Promise<GcalEventResource> {
  return json(await googleRequest(
    clientId, CALENDAR_EVENTS_SCOPE,
    `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: "PATCH", json: true, body: JSON.stringify(body), headers: etag ? { "If-Match": etag } : {} }, "Calendar patch",
  ));
}

export async function deleteEvent(clientId: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await googleRequest(
      clientId, CALENDAR_EVENTS_SCOPE,
      `${BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      { method: "DELETE" }, "Calendar delete",
    );
  } catch (err) {
    // Déjà supprimé côté Google : le but est atteint.
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
}

function dateToLocalMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).getTime();
}

export function toEventInput(calendarId: string, ev: GcalEventResource): CalEventInput {
  const allDay = !!ev.start?.date;
  const startAt = allDay ? dateToLocalMs(ev.start!.date!) : Date.parse(ev.start?.dateTime ?? "");
  const endAt = allDay ? dateToLocalMs(ev.end?.date ?? ev.start!.date!) : Date.parse(ev.end?.dateTime ?? ev.start?.dateTime ?? "");
  const attendees: CalAttendee[] = (ev.attendees ?? [])
    .filter((a) => a.email)
    .map((a) => ({
      email: a.email!,
      name: a.displayName ?? "",
      responseStatus: a.responseStatus ?? "needsAction",
      self: a.self === true,
      organizer: a.organizer === true,
    }));
  const self = attendees.find((a) => a.self);
  return {
    calendarId,
    id: ev.id,
    summary: ev.summary ?? "(sans titre)",
    description: ev.description ?? "",
    location: ev.location ?? "",
    startAt: Number.isFinite(startAt) ? startAt : 0,
    endAt: Number.isFinite(endAt) ? endAt : 0,
    allDay,
    startDate: ev.start?.date ?? "",
    endDate: ev.end?.date ?? "",
    status: ev.status ?? "confirmed",
    recurringEventId: ev.recurringEventId ?? "",
    htmlLink: ev.htmlLink ?? "",
    meetUrl: ev.hangoutLink ?? ev.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ?? "",
    attendees,
    selfResponse: self?.responseStatus ?? (ev.organizer?.self ? "accepted" : ""),
    etag: ev.etag ?? "",
    colorId: ev.colorId ?? "",
  };
}
```

- [ ] **Step 2: Vérifier** : `pnpm typecheck` → 15/15.

### Task 6: Miroir client, moteur de synchro et `CalendarRunner`

**Files:**
- Create: `apps/web/src/lib/calendar-mirror.ts`, `apps/web/src/lib/calendar-sync.ts`, `apps/web/src/components/agenda/CalendarRunner.tsx`
- Modify: `apps/web/src/RootLayout.tsx` (monter `<CalendarRunner />` juste après `<MailFollowupRunner />`)

**Interfaces:**
- Consumes: Tasks 2, 3, 5 ; `trpcVanillaClient` (même import que `lib/mail-mirror.ts`), `mirrorAvailable()` de `lib/mail-mirror.ts`, `hasValidToken` / `requestAccessToken` de `lib/google-drive.ts`
- Produces:
  - `calendar-mirror.ts` : `CALENDAR_CHANGED_EVENT`, `CALENDAR_OUTBOX_EVENT`, `emitCalendarChanged()`, `newCalendarOpId()`, `calApplyLocalMutation(input)`, `calListEvents(accountId, from, to)`, `calListCalendars(accountId)`
  - `calendar-sync.ts` : `CALENDAR_CONNECTED_KEY`, `isCalendarConnected()`, `calendarAccount(settings): { clientId: string; accountId: string } | null`, `connectCalendar(clientId): Promise<void>`, `disconnectCalendar(accountId): Promise<void>`, `hasCalendarToken(clientId): boolean`, `syncCalendars(clientId, accountId, opts?: { force?: boolean }): Promise<void>`, `CALENDAR_CONFLICT_EVENT`

- [ ] **Step 1: `calendar-mirror.ts`** :

```ts
import type { CalendarApplyLocalMutationInput, CalEventRow, CalCalendarRow } from "@supernote/ipc";
import { trpcVanillaClient } from "./trpc/client";

/** Le miroir a changé (synchro ou écriture locale) : les vues relisent. */
export const CALENDAR_CHANGED_EVENT = "supernote:calendar-changed";
/** Une écriture attend Google : le runner vide la file sans attendre son tour. */
export const CALENDAR_OUTBOX_EVENT = "supernote:calendar-outbox";

export function emitCalendarChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CALENDAR_CHANGED_EVENT));
}

export function newCalendarOpId(): string {
  return `calop_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
}

export async function calApplyLocalMutation(input: CalendarApplyLocalMutationInput): Promise<void> {
  await trpcVanillaClient.calendar.applyLocalMutation.mutate(input);
  emitCalendarChanged();
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CALENDAR_OUTBOX_EVENT));
}

export async function calListEvents(accountId: string, from: number, to: number): Promise<CalEventRow[]> {
  return (await trpcVanillaClient.calendar.listEvents.query({ accountId, from, to })).events;
}

export async function calListCalendars(accountId: string): Promise<CalCalendarRow[]> {
  return (await trpcVanillaClient.calendar.listCalendars.query({ accountId })).calendars;
}
```

(Vérifier le chemin exact de `trpcVanillaClient` dans l'en-tête de `lib/mail-mirror.ts` et utiliser le même.)

- [ ] **Step 2: `calendar-sync.ts`** :

```ts
import { hasValidToken, requestAccessToken } from "./google-drive";
import { GoogleApiError, GoogleAuthError, isTransientGoogleError, markScopeRecovered } from "./google-api";
import {
  CALENDAR_EVENTS_SCOPE, CALENDAR_SCOPES, deleteEvent, insertEvent, listCalendars, listEventsPage,
  patchEvent, toEventInput, type GcalEventBody, type GcalEventResource,
} from "./gcal";
import { emitCalendarChanged } from "./calendar-mirror";
import { trpcVanillaClient } from "./trpc/client";

const DAY_MS = 86_400_000;
const WINDOW_BACK_DAYS = 60;
const WINDOW_AHEAD_DAYS = 180;
const FULL_SYNC_MS = DAY_MS;
const WINDOW_SLIDE_MS = 7 * DAY_MS;
/** Marge sur `updatedMin` : une modification faite pendant la requête ne doit pas tomber entre deux deltas. */
const UPDATED_MIN_SKEW_MS = 60_000;

export const CALENDAR_CONNECTED_KEY = "supernote.calendar.connected";
/** Une modification locale a perdu contre une modification faite ailleurs (412). */
export const CALENDAR_CONFLICT_EVENT = "supernote:calendar-conflict";

export function isCalendarConnected(): boolean {
  try {
    return window.localStorage.getItem(CALENDAR_CONNECTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function calendarAccount(settings: {
  googleDrive: { clientId: string; connectedEmail: string };
  gmail: { connectedEmail: string };
}): { clientId: string; accountId: string } | null {
  const clientId = settings.googleDrive.clientId;
  const accountId = settings.gmail.connectedEmail || settings.googleDrive.connectedEmail;
  return clientId && accountId ? { clientId, accountId } : null;
}

export function hasCalendarToken(clientId: string): boolean {
  return hasValidToken(clientId, CALENDAR_EVENTS_SCOPE);
}

/** À appeler depuis un geste : GIS ouvre une popup. */
export async function connectCalendar(clientId: string): Promise<void> {
  await requestAccessToken(clientId, { scope: CALENDAR_SCOPES.join(" "), prompt: "" });
  for (const s of CALENDAR_SCOPES) markScopeRecovered(s);
  try {
    window.localStorage.setItem(CALENDAR_CONNECTED_KEY, "1");
  } catch {
    /* stockage refusé : la connexion vaut pour la session */
  }
}

export async function disconnectCalendar(accountId: string): Promise<void> {
  try {
    window.localStorage.removeItem(CALENDAR_CONNECTED_KEY);
  } catch {
    /* rien à retirer */
  }
  await trpcVanillaClient.calendar.clear.mutate({ accountId });
  emitCalendarChanged();
}

function currentWindow(now = Date.now()): { from: number; to: number } {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return { from: today.getTime() - WINDOW_BACK_DAYS * DAY_MS, to: today.getTime() + WINDOW_AHEAD_DAYS * DAY_MS };
}

async function fetchAll(clientId: string, calendarId: string, q: { timeMin: string; timeMax: string; updatedMin?: string }): Promise<GcalEventResource[]> {
  const items: GcalEventResource[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listEventsPage(clientId, calendarId, { ...q, pageToken });
    items.push(...page.items);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

async function flushOutbox(clientId: string, accountId: string): Promise<void> {
  const { items } = await trpcVanillaClient.calendar.listOutbox.query({ accountId });
  const now = Date.now();
  for (const op of items) {
    if (op.nextAttemptAt > now) continue;
    // Une op sur un événement encore provisoire attend l'acquittement de sa création.
    if (op.kind !== "create" && op.eventId.startsWith("local-")) continue;
    const body = (op.payload["body"] ?? {}) as GcalEventBody;
    try {
      let ev: GcalEventResource | null = null;
      if (op.kind === "create") ev = await insertEvent(clientId, op.calendarId, body, { meet: op.payload["meet"] === true });
      else if (op.kind === "delete") await deleteEvent(clientId, op.calendarId, op.eventId);
      else ev = await patchEvent(clientId, op.calendarId, op.eventId, body, typeof op.payload["etag"] === "string" ? op.payload["etag"] : undefined);
      await trpcVanillaClient.calendar.resolveOutbox.mutate({
        accountId, opId: op.opId, outcome: "ack", ...(ev ? { event: toEventInput(op.calendarId, ev) } : {}),
      });
    } catch (err) {
      if (err instanceof GoogleAuthError || isTransientGoogleError(err)) return;
      if (err instanceof GoogleApiError && err.status === 412) {
        await trpcVanillaClient.calendar.resolveOutbox.mutate({ accountId, opId: op.opId, outcome: "drop" });
        window.dispatchEvent(new CustomEvent(CALENDAR_CONFLICT_EVENT));
        continue;
      }
      const backoff = Math.min(10 * 60_000, 5_000 * 2 ** op.attempts);
      await trpcVanillaClient.calendar.resolveOutbox.mutate({
        accountId, opId: op.opId, outcome: "fail", error: err instanceof Error ? err.message : String(err), nextAttemptAt: now + backoff,
      });
    }
  }
}

const inflight = new Map<string, Promise<void>>();

/** Vide l'outbox puis tire les agendas cochés. Coalescé par compte. */
export function syncCalendars(clientId: string, accountId: string, opts: { force?: boolean } = {}): Promise<void> {
  const running = inflight.get(accountId);
  if (running) return running;
  const p = (async () => {
    await flushOutbox(clientId, accountId);
    const calendars = await listCalendars(clientId);
    await trpcVanillaClient.calendar.syncUpsert.mutate({ accountId, calendars });
    const { states } = await trpcVanillaClient.calendar.getState.query({ accountId });
    const win = currentWindow();
    const timeMin = new Date(win.from).toISOString();
    const timeMax = new Date(win.to).toISOString();
    for (const cal of calendars.filter((c) => c.selected)) {
      const startedAt = new Date(Date.now() - UPDATED_MIN_SKEW_MS).toISOString();
      const st = states.find((s) => s.calendarId === cal.id);
      const full =
        opts.force === true || !st || !st.updatedMin ||
        Date.now() - st.lastFullSyncAt > FULL_SYNC_MS || Math.abs(st.windowStart - win.from) > WINDOW_SLIDE_MS;
      const items = await fetchAll(clientId, cal.id, { timeMin, timeMax, ...(full ? {} : { updatedMin: st!.updatedMin }) });
      const live = items.filter((e) => e.status !== "cancelled");
      await trpcVanillaClient.calendar.syncUpsert.mutate({
        accountId,
        ...(full ? { replaceWindows: [{ calendarId: cal.id, from: win.from, to: win.to }] } : {}),
        events: live.map((e) => toEventInput(cal.id, e)),
        removals: full ? [] : items.filter((e) => e.status === "cancelled").map((e) => ({ calendarId: cal.id, id: e.id })),
        states: [{ calendarId: cal.id, updatedMin: startedAt, windowStart: win.from, windowEnd: win.to, fullSync: full }],
      });
    }
    emitCalendarChanged();
  })().finally(() => inflight.delete(accountId));
  inflight.set(accountId, p);
  return p;
}
```

- [ ] **Step 3: `CalendarRunner.tsx`** :

```tsx
"use client";

import { useEffect } from "react";
import { useToast } from "@supernote/ui";
import { useSettings } from "@/components/settings/SettingsContext";
import { mirrorAvailable } from "@/lib/mail-mirror";
import { CALENDAR_OUTBOX_EVENT } from "@/lib/calendar-mirror";
import {
  CALENDAR_CONFLICT_EVENT, calendarAccount, hasCalendarToken, isCalendarConnected, syncCalendars,
} from "@/lib/calendar-sync";

const TICK_MS = 5 * 60_000;

/**
 * Garde le miroir de l'agenda à jour hors de /agenda. Ne synchronise qu'avec un
 * jeton déjà en cache : une acquisition ouvrirait la popup Google hors geste.
 */
export function CalendarRunner() {
  const { settings } = useSettings();
  const { toast } = useToast();
  const account = calendarAccount(settings);

  useEffect(() => {
    if (!account) return;
    const { clientId, accountId } = account;
    let debounce: number | undefined;
    const run = () => {
      if (document.visibilityState !== "visible" || !isCalendarConnected()) return;
      if (!mirrorAvailable() || !hasCalendarToken(clientId)) return;
      void syncCalendars(clientId, accountId).catch((err: unknown) => console.warn("[agenda] synchro", err));
    };
    const soon = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(run, 1_000);
    };
    const onConflict = () => toast({ title: "Événement modifié ailleurs entre-temps : ta modification n'a pas été appliquée.", variant: "warning" });
    run();
    const id = window.setInterval(run, TICK_MS);
    document.addEventListener("visibilitychange", run);
    window.addEventListener("online", run);
    window.addEventListener(CALENDAR_OUTBOX_EVENT, soon);
    window.addEventListener(CALENDAR_CONFLICT_EVENT, onConflict);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(debounce);
      document.removeEventListener("visibilitychange", run);
      window.removeEventListener("online", run);
      window.removeEventListener(CALENDAR_OUTBOX_EVENT, soon);
      window.removeEventListener(CALENDAR_CONFLICT_EVENT, onConflict);
    };
  }, [account?.clientId, account?.accountId, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
```

(Vérifier que `useToast` accepte `variant: "warning"` ; sinon utiliser la variante existante la plus proche, cf. `MailFollowupRunner.tsx`.)

- [ ] **Step 4: Monter** `<CalendarRunner />` dans `RootLayout.tsx` après `<MailFollowupRunner />`, avec un commentaire d'une ligne : `{/* Miroir de l'agenda : synchro et file d'écriture, hors de /agenda aussi. */}`.
- [ ] **Step 5: Vérifier** : `pnpm typecheck` → 15/15.

---

## Lot 2 — Page `/agenda`

### Task 7: Dates et placement

**Files:**
- Create: `apps/web/src/lib/agenda/dates.ts`, `apps/web/src/lib/agenda/layout.ts`

**Interfaces:**
- Produces:
  - `type AgendaView = "day" | "week" | "month" | "list"`
  - `startOfDay(ms)`, `addDays(ms, n)`, `startOfWeek(ms)` (lundi), `dateKey(ms): string` (`YYYY-MM-DD` local), `parseDateKey(key): number`, `viewRange(view, anchor): { from: number; to: number; days: number[] }`, `minutesOfDay(ms)`, `formatRangeTitle(view, anchor): string`, `formatTime(ms): string`
  - `interface PlacedEvent<T> { item: T; top: number; height: number; column: number; columns: number }` et `layoutDay<T extends { startAt: number; endAt: number }>(items: T[], dayStart: number, pxPerMinute: number): PlacedEvent<T>[]`

- [ ] **Step 1: `dates.ts`** :

```ts
export type AgendaView = "day" | "week" | "month" | "list";

const DAY_MS = 86_400_000;

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Ajout calendaire (et non +24 h) : un passage à l'heure d'été garde minuit à minuit. */
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function startOfWeek(ms: number): number {
  const d = new Date(startOfDay(ms));
  const offset = (d.getDay() + 6) % 7;
  return addDays(d.getTime(), -offset);
}

export function dateKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDateKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).getTime();
}

export function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

export function viewRange(view: AgendaView, anchor: number): { from: number; to: number; days: number[] } {
  let first: number;
  let count: number;
  if (view === "day") {
    first = startOfDay(anchor);
    count = 1;
  } else if (view === "week") {
    first = startOfWeek(anchor);
    count = 7;
  } else if (view === "month") {
    const d = new Date(anchor);
    const firstOfMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    first = startOfWeek(firstOfMonth);
    count = 42;
  } else {
    first = startOfDay(anchor);
    count = 14;
  }
  const days = Array.from({ length: count }, (_, i) => addDays(first, i));
  return { from: first, to: addDays(first, count) - 1, days };
}

const TIME = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
export function formatTime(ms: number): string {
  return TIME.format(ms);
}

export function formatRangeTitle(view: AgendaView, anchor: number): string {
  if (view === "day") {
    return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(anchor);
  }
  if (view === "month") {
    return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(anchor);
  }
  const { days } = viewRange(view, anchor);
  const fmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
  return `${fmt.format(days[0]!)} – ${fmt.format(days[days.length - 1]!)}`;
}

export { DAY_MS };
```

- [ ] **Step 2: `layout.ts`** — groupes d'événements qui se chevauchent, colonnes gloutonnes :

```ts
import { minutesOfDay, startOfDay } from "./dates";

export interface PlacedEvent<T> {
  item: T;
  top: number;
  height: number;
  column: number;
  columns: number;
}

const MIN_HEIGHT_MIN = 20;

export function layoutDay<T extends { startAt: number; endAt: number }>(
  items: T[],
  dayStart: number,
  pxPerMinute: number,
): PlacedEvent<T>[] {
  const dayEnd = dayStart + 86_400_000;
  const clipped = items
    .map((item) => {
      const start = Math.max(item.startAt, dayStart);
      const end = Math.min(Math.max(item.endAt, item.startAt + MIN_HEIGHT_MIN * 60_000), dayEnd);
      const startMin = start === dayStart && startOfDay(item.startAt) < dayStart ? 0 : minutesOfDay(start);
      const endMin = end >= dayEnd ? 24 * 60 : minutesOfDay(end);
      return { item, startMin, endMin: Math.max(endMin, startMin + MIN_HEIGHT_MIN) };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const placed: PlacedEvent<T>[] = [];
  let cluster: { entry: (typeof clipped)[number]; column: number }[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const columns = Math.max(1, ...cluster.map((c) => c.column + 1));
    for (const c of cluster) {
      placed.push({
        item: c.entry.item,
        top: c.entry.startMin * pxPerMinute,
        height: (c.entry.endMin - c.entry.startMin) * pxPerMinute,
        column: c.column,
        columns,
      });
    }
    cluster = [];
  };
  for (const entry of clipped) {
    if (entry.startMin >= clusterEnd) flush();
    const taken = new Set(cluster.filter((c) => c.entry.endMin > entry.startMin).map((c) => c.column));
    let column = 0;
    while (taken.has(column)) column++;
    cluster.push({ entry, column });
    clusterEnd = Math.max(clusterEnd, entry.endMin);
  }
  flush();
  return placed;
}
```

- [ ] **Step 3: Vérifier** : `pnpm typecheck` → 15/15.

### Task 8: Route, navigation, données et page

**Files:**
- Create: `apps/web/src/app/agenda/page.tsx`, `apps/web/src/components/agenda/useAgendaData.ts`, `apps/web/src/components/agenda/AgendaToolbar.tsx`
- Modify: `apps/web/src/router.tsx` (`{ path: "agenda", lazy: lazyPage(() => import("./app/agenda/page")) },` après `mail`), `apps/web/src/lib/navigation/catalog.ts` (`{ href: "/agenda", labelKey: "nav.agenda", icon: CalendarBlank, group: "navigation" },` après `/mail`), `apps/web/messages/fr.json` (`"agenda": "Agenda"` dans `nav`), `apps/web/messages/en.json` (`"agenda": "Calendar"`), `apps/web/src/lib/commands/seed.ts` (commande `nav.agenda` « Aller à l'agenda » et `event.create` « Nouvel événement » qui navigue vers `/agenda?new=1`)

**Interfaces:**
- Consumes: Tasks 6, 7
- Produces:
  - `useAgendaData(range: { from: number; to: number }): { events: CalEventRow[]; calendars: CalCalendarRow[]; overlays: AgendaOverlay[]; loading: boolean }`
  - `type AgendaOverlay = { key: string; kind: "todo" | "checklist" | "snooze" | "followup" | "base"; title: string; date: string; atMs: number | null; onOpen: () => void }` (rempli au Lot 3 ; au Lot 2 le hook renvoie `overlays: []`)
  - `AgendaPage` : état `view`, `anchor`, sélection d'événement, ouverture de l'éditeur

- [ ] **Step 1: `useAgendaData.ts`** — lecture React Query du miroir, relue sur `CALENDAR_CHANGED_EVENT` :

```ts
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CalCalendarRow, CalEventRow } from "@supernote/ipc";
import { useSettings } from "@/components/settings/SettingsContext";
import { CALENDAR_CHANGED_EVENT, calListCalendars, calListEvents } from "@/lib/calendar-mirror";
import { calendarAccount } from "@/lib/calendar-sync";
import { mirrorAvailable } from "@/lib/mail-mirror";

export interface AgendaOverlay {
  key: string;
  kind: "todo" | "checklist" | "snooze" | "followup" | "base";
  title: string;
  /** `YYYY-MM-DD` du jour où l'afficher. */
  date: string;
  /** Heure précise (reports, relances), sinon null = bande « toute la journée ». */
  atMs: number | null;
  onOpen: () => void;
}

export function useAgendaData(range: { from: number; to: number }) {
  const { settings } = useSettings();
  const account = calendarAccount(settings);
  const accountId = account?.accountId ?? "";
  const enabled = !!accountId && mirrorAvailable();
  const qc = useQueryClient();

  const events = useQuery({
    queryKey: ["calendar", "events", accountId, range.from, range.to],
    queryFn: () => calListEvents(accountId, range.from, range.to),
    enabled,
    placeholderData: (prev) => prev,
  });
  const calendars = useQuery({
    queryKey: ["calendar", "calendars", accountId],
    queryFn: () => calListCalendars(accountId),
    enabled,
  });

  useEffect(() => {
    const refresh = () => void qc.invalidateQueries({ queryKey: ["calendar"] });
    window.addEventListener(CALENDAR_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CALENDAR_CHANGED_EVENT, refresh);
  }, [qc]);

  return {
    events: (events.data ?? []) as CalEventRow[],
    calendars: (calendars.data ?? []) as CalCalendarRow[],
    overlays: [] as AgendaOverlay[],
    loading: events.isLoading,
  };
}
```

(Vérifier le nom du paquet React Query importé ailleurs dans `apps/web` — `grep -rn "useQueryClient" apps/web/src | head -1` — et utiliser le même.)

- [ ] **Step 2: `AgendaToolbar.tsx`** — une rangée : « Aujourd'hui », précédent/suivant (boutons icône `CaretLeft`/`CaretRight` + Tooltip), titre de période (`formatRangeTitle`), sélecteur de vue (HeroUI `Tabs` ou groupe de `Button` : Jour · Semaine · Mois · Liste), état de synchro à droite (« Synchro en pause · Reprendre » quand connecté sans jeton en cache, badge « N en attente » si des événements `pending`). Sur téléphone : titre et flèches seulement, la vue passe par `useMobileHeaderActions` (action « Vue »). Props :

```ts
interface AgendaToolbarProps {
  view: AgendaView;
  anchor: number;
  onView: (v: AgendaView) => void;
  onNavigate: (dir: -1 | 0 | 1) => void;
  syncPaused: boolean;
  onResume: () => void;
  pendingCount: number;
}
```

- [ ] **Step 3: `app/agenda/page.tsx`** — état et branchements :
  - `view` initial : `"list"` si `useIsMobile()`, sinon `"week"` ; mémorisé dans `localStorage` (`supernote.agenda.view`, try/catch).
  - `anchor` = aujourd'hui ; `onNavigate(dir)` : `dir === 0` → aujourd'hui, sinon `addDays(anchor, dir * n)` avec n = 1 (jour), 7 (semaine), mois calendaire (mois), 14 (liste).
  - `const range = viewRange(view, anchor)` ; `useAgendaData(range)`.
  - États : pas de coffre (`!mirrorAvailable()`) → « Ouvre un coffre pour utiliser l'agenda » ; pas de compte Google (`!calendarAccount(settings)`) → lien vers Paramètres › Gmail ; non connecté (`!isCalendarConnected()`) → bouton « Connecter Google Agenda » qui appelle `connectCalendar(clientId)` puis `syncCalendars(clientId, accountId, { force: true })` ; reconnexion requise (`googleReconnectRequired("calendar")`, écouter `GOOGLE_AUTH_EVENT`) → même bouton libellé « Reconnecter ».
  - `syncPaused` = connecté et `!hasCalendarToken(clientId)` ; `onResume` = `connectCalendar` puis `syncCalendars`.
  - Menu « … » de la barre d'outils : « Synchroniser maintenant » (`syncCalendars(…, { force: true })`) et « Déconnecter l'agenda » (`ConfirmModal`, puis `disconnectCalendar(accountId)` qui vide le miroir).
  - Raccourcis clavier (ignorés quand le focus est dans un champ) : `j` jour, `s` semaine, `m` mois, `l` liste, `t` aujourd'hui, `ArrowLeft`/`ArrowRight`.
  - Mobile : `useMobileTitle("Agenda")`, `useMobileFab({ icon: Plus, label: "Nouvel événement", onPress: () => openEditor(null) })`.
  - `?new=1` dans l'URL → ouvre l'éditeur au montage (commande de palette).
  - Rend `<AgendaToolbar>` puis `TimeGrid` (jour/semaine), `MonthGrid` ou `AgendaList` (Task 9), `EventDetail` et `EventEditorModal` (Task 10).
- [ ] **Step 4: Vérifier** : `pnpm typecheck` → 15/15, puis `pnpm dev` et ouvrir `/agenda` : l'état « Connecter Google Agenda » s'affiche, l'entrée « Agenda » est dans la barre latérale et le MoreDrawer.

### Task 9: Grilles jour/semaine, mois et liste

**Files:**
- Create: `apps/web/src/components/agenda/TimeGrid.tsx`, `MonthGrid.tsx`, `AgendaList.tsx`, `EventBlock.tsx`

**Interfaces:**
- Consumes: `layoutDay`, `dateKey`, `formatTime` (Task 7) ; `CalEventRow`, `CalCalendarRow`, `AgendaOverlay` (Task 8)
- Produces (props communes) :

```ts
interface GridProps {
  days: number[];
  events: CalEventRow[];
  calendars: CalCalendarRow[];
  overlays: AgendaOverlay[];
  onSelectEvent: (ev: CalEventRow, anchorEl: HTMLElement) => void;
  onCreateAt: (startAt: number, endAt: number, allDay: boolean) => void;
  onMoveEvent: (ev: CalEventRow, startAt: number, endAt: number) => void;
}
```

- [ ] **Step 1: `EventBlock.tsx`** — bouton natif (justification : cible de glisser dnd-kit, cf. exceptions HeroUI) coloré par `calendar.backgroundColor` (fond `color-mix(in oklch, <couleur> 18%, var(--surface-1))`, bordure gauche 3 px de la couleur) : titre, heure (`formatTime`), icône `CloudArrowUp` quand `pending`, opacité réduite quand `selfResponse === "declined"`, pointillés quand `"needsAction"`. `aria-label` = « <titre>, <heure> ».
- [ ] **Step 2: `TimeGrid.tsx`** :
  - Colonne des heures (48 px) + une colonne par jour ; `PX_PER_MIN = 0.8` (48 px par heure) ; défilement vertical interne, défilé au montage sur 7 h 30 ou sur l'heure courante si c'est aujourd'hui.
  - Bande « toute la journée » en haut : événements `allDay` (étalés sur leurs jours, `endDate` exclusive) puis puces des `overlays` sans heure.
  - Par jour : `layoutDay(events non allDay du jour, dayStart, PX_PER_MIN)` ; chaque bloc en `position: absolute; top; height; left: column/columns; width: 1/columns`.
  - Ligne de l'heure courante (2 px, `var(--danger)`) sur la colonne du jour, rafraîchie toutes les minutes.
  - Overlays avec heure (`atMs`) : petit marqueur en ligne à leur heure, cliquable.
  - Glisser (ordinateur, calendrier `accessRole` `owner`/`writer` uniquement) avec `@dnd-kit/core` : déplacer un bloc = delta vertical arrondi à 15 min + changement de colonne ; poignée basse = redimensionner (fin arrondie à 15 min, durée ≥ 15 min) ; au relâchement `onMoveEvent(ev, newStart, newEnd)`.
  - Clic-glisser sur un créneau vide (ordinateur) ou clic simple (30 min par défaut) → `onCreateAt(start, end, false)` ; clic dans la bande journée → `onCreateAt(dayStart, dayStart + DAY_MS, true)`.
  - Mobile : pas de glisser ; la vue Jour se change par balayage horizontal (réutiliser `useSwipeGesture` de `components/mail/SwipeableRow.tsx` s'il est exporté, sinon écouteurs `touchstart`/`touchend` avec seuil 60 px).
- [ ] **Step 3: `MonthGrid.tsx`** — 6 × 7 cases (lundi en premier), jours hors mois estompés, jusqu'à 3 lignes par case (événements puis overlays) et « +N » qui bascule en vue Jour sur ce jour ; clic sur une case vide → `onCreateAt(day 9 h, 10 h, false)`.
- [ ] **Step 4: `AgendaList.tsx`** — liste groupée par jour (14 jours, en-tête collant par jour), chaque ligne = heure ou « Journée », pastille de couleur, titre, lieu ; overlays mêlés à leur date ; lignes de 44 px minimum ; état vide « Rien de prévu ».
- [ ] **Step 5: Vérifier** : `pnpm typecheck` → 15/15 ; banc Google simulé (Task 15) : semaine avec chevauchements, journée entière sur 3 jours, mois, liste à 360 px sans débordement.

### Task 10: Détail, éditeur, écritures

**Files:**
- Create: `apps/web/src/components/agenda/EventDetail.tsx`, `apps/web/src/components/agenda/EventEditorModal.tsx`, `apps/web/src/components/agenda/useEventWrites.ts`

**Interfaces:**
- Consumes: `calApplyLocalMutation`, `newCalendarOpId` (Task 6) ; `GcalEventBody` (Task 5)
- Produces:

```ts
export interface EventDraft {
  calendarId: string;
  summary: string;
  description: string;
  location: string;
  allDay: boolean;
  startAt: number;
  endAt: number;
  attendees: string[];
  meet: boolean;
}

export function useEventWrites(accountId: string): {
  create: (draft: EventDraft) => Promise<void>;
  update: (ev: CalEventRow, draft: EventDraft) => Promise<void>;
  move: (ev: CalEventRow, startAt: number, endAt: number) => Promise<void>;
  remove: (ev: CalEventRow) => Promise<void>;
  rsvp: (ev: CalEventRow, response: "accepted" | "tentative" | "declined") => Promise<void>;
};
```

- [ ] **Step 1: `useEventWrites.ts`** :

```ts
import { useCallback } from "react";
import type { CalEventInput, CalEventRow } from "@supernote/ipc";
import { calApplyLocalMutation, newCalendarOpId } from "@/lib/calendar-mirror";
import type { GcalEventBody } from "@/lib/gcal";
import { addDays, dateKey } from "@/lib/agenda/dates";

export interface EventDraft {
  calendarId: string;
  summary: string;
  description: string;
  location: string;
  allDay: boolean;
  startAt: number;
  endAt: number;
  attendees: string[];
  meet: boolean;
}

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

function timesOf(d: Pick<EventDraft, "allDay" | "startAt" | "endAt">): Pick<GcalEventBody, "start" | "end"> {
  if (d.allDay) {
    // Google : date de fin exclusive.
    const endExclusive = Math.max(addDays(d.startAt, 1), d.endAt);
    return { start: { date: dateKey(d.startAt) }, end: { date: dateKey(endExclusive) } };
  }
  return {
    start: { dateTime: new Date(d.startAt).toISOString(), timeZone: TZ },
    end: { dateTime: new Date(d.endAt).toISOString(), timeZone: TZ },
  };
}

function bodyOf(d: EventDraft): GcalEventBody {
  return {
    summary: d.summary,
    description: d.description,
    location: d.location,
    ...timesOf(d),
    attendees: d.attendees.map((email) => ({ email })),
  };
}

function rowOf(base: Partial<CalEventInput>, d: EventDraft, id: string): CalEventInput {
  return {
    calendarId: d.calendarId,
    id,
    summary: d.summary || "(sans titre)",
    description: d.description,
    location: d.location,
    startAt: d.startAt,
    endAt: d.endAt,
    allDay: d.allDay,
    startDate: d.allDay ? dateKey(d.startAt) : "",
    endDate: d.allDay ? dateKey(Math.max(addDays(d.startAt, 1), d.endAt)) : "",
    status: "confirmed",
    recurringEventId: base.recurringEventId ?? "",
    htmlLink: base.htmlLink ?? "",
    meetUrl: base.meetUrl ?? "",
    attendees: d.attendees.map((email) => base.attendees?.find((a) => a.email === email) ?? { email, name: "", responseStatus: "needsAction", self: false, organizer: false }),
    selfResponse: base.selfResponse ?? "accepted",
    etag: base.etag ?? "",
    colorId: base.colorId ?? "",
  };
}

export function useEventWrites(accountId: string) {
  const create = useCallback(async (d: EventDraft) => {
    const id = `local-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    await calApplyLocalMutation({
      accountId, opId: newCalendarOpId(), kind: "create", calendarId: d.calendarId, eventId: id,
      event: rowOf({}, d, id), payload: { body: bodyOf(d), meet: d.meet },
    });
  }, [accountId]);

  const update = useCallback(async (ev: CalEventRow, d: EventDraft) => {
    await calApplyLocalMutation({
      accountId, opId: newCalendarOpId(), kind: "patch", calendarId: ev.calendarId, eventId: ev.id,
      event: rowOf(ev, d, ev.id), payload: { body: bodyOf(d), etag: ev.etag },
    });
  }, [accountId]);

  const move = useCallback(async (ev: CalEventRow, startAt: number, endAt: number) => {
    const d = { allDay: ev.allDay, startAt, endAt };
    await calApplyLocalMutation({
      accountId, opId: newCalendarOpId(), kind: "patch", calendarId: ev.calendarId, eventId: ev.id,
      event: { ...ev, startAt, endAt, startDate: ev.allDay ? dateKey(startAt) : "", endDate: ev.allDay ? dateKey(endAt) : "" },
      payload: { body: timesOf(d), etag: ev.etag },
    });
  }, [accountId]);

  const remove = useCallback(async (ev: CalEventRow) => {
    await calApplyLocalMutation({
      accountId, opId: newCalendarOpId(), kind: "delete", calendarId: ev.calendarId, eventId: ev.id, payload: {},
    });
  }, [accountId]);

  const rsvp = useCallback(async (ev: CalEventRow, response: "accepted" | "tentative" | "declined") => {
    const attendees = ev.attendees.map((a) => (a.self ? { ...a, responseStatus: response } : a));
    await calApplyLocalMutation({
      accountId, opId: newCalendarOpId(), kind: "rsvp", calendarId: ev.calendarId, eventId: ev.id,
      event: { ...ev, attendees, selfResponse: response },
      payload: { body: { attendees: attendees.map((a) => ({ email: a.email, responseStatus: a.responseStatus })) }, etag: ev.etag },
    });
  }, [accountId]);

  return { create, update, move, remove, rsvp };
}
```

(`event: { ...ev, … }` transmet aussi `pending` et `noteId` : zod les ignore en entrée, `CalEventInputSchema` ne les déclare pas — les retirer explicitement si le typecheck le demande.)

- [ ] **Step 2: `EventDetail.tsx`** — popover (HeroUI `Popover`) ancré sur le bloc sur ordinateur, feuille (`MobileSheet` existant) sur téléphone. Contenu : titre, date et heures, nom et pastille de l'agenda, lieu, bouton « Rejoindre » si `meetUrl` (ouvre dans un nouvel onglet), participants (nom ou e-mail, statut de réponse ; nom cliquable vers la fiche quand `findContactMatch` de `lib/contact-from-email.ts` trouve le contact dans la liste des `personne`), réponse Oui / Peut-être / Non si l'utilisateur est invité (non organisateur), actions « Modifier » (agendas modifiables), « Supprimer » (confirmation par `ConfirmModal`), « Note de réunion » (Task 12, désactivé tant que l'id commence par `local-`), « Ouvrir dans Google Agenda » (`htmlLink`). Une occurrence de série (`recurringEventId` non vide) affiche « Occurrence d'une série — la série se modifie dans Google Agenda ».
- [ ] **Step 3: `EventEditorModal.tsx`** — `Modal` HeroUI : titre (focus), case « Journée entière », date + heure de début / fin (`<Input type="date">` / `<Input type="time">`, natifs justifiés par la règle HeroUI/natif du projet), agenda (`Select` limité à `accessRole` `owner`/`writer`, défaut = agenda principal), lieu, invités (e-mails séparés par virgule ou Entrée, puces supprimables), description, case « Ajouter une visio Meet » (création seulement). Validation : fin > début, sinon message sous le champ. « Enregistrer » → `create` ou `update`, fermeture, toast « Événement enregistré » (ou « … sera envoyé au retour du réseau » si `navigator.onLine === false`). Mobile : plein écran.
- [ ] **Step 4: Brancher** dans la page : `onSelectEvent` → `EventDetail`, `onCreateAt` → éditeur pré-rempli, `onMoveEvent` → `move` (refusé silencieusement si l'agenda n'est pas modifiable).
- [ ] **Step 5: Vérifier** : `pnpm typecheck` → 15/15 ; banc simulé : créer hors ligne (bloc « en attente »), revenir en ligne (l'id devient l'id Google), déplacer, répondre, supprimer ; 412 simulé → toast de conflit.

---

## Lot 3 — Sources superposées

### Task 11: Todos, checklists, reports, relances et dates des bases

**Files:**
- Create: `apps/web/src/components/todos/useNoteChecklistTodos.ts`
- Modify: `apps/web/src/app/todos/page.tsx` (remplacer la définition de `notesQuery` et le `useMemo` `noteRows`, l.~430-470, par l'appel au hook), `apps/web/src/components/agenda/useAgendaData.ts`, `apps/web/src/components/agenda/AgendaToolbar.tsx`

**Interfaces:**
- Produces: `useNoteChecklistTodos(): { rows: UiTodoRow[]; isLoading: boolean }` (le type `UiTodoRow` reste exporté depuis là où il vit ; l'exporter s'il est local à la page)
- Consumes: `trpc.calendar.overlay` (Task 4), `loadSnoozed()` (`lib/mail-triage.ts`), `pendingFollowups()` (`lib/mail-followup.ts`), `MAIL_FOLLOWUP_EVENT`, l'événement de changement des reports (le trouver dans `lib/mail-triage.ts` : `grep -n "dispatchEvent" apps/web/src/lib/mail-triage.ts`)

- [ ] **Step 1: Extraire le hook** : déplacer tel quel `notesQuery` et le `useMemo` `noteRows` de `app/todos/page.tsx` dans `useNoteChecklistTodos.ts` (avec leurs imports : `extractChecklists`, `filterChecklistsHeuristic`), renvoyer `{ rows: noteRows, isLoading: notesQuery.isLoading }` ; dans la page, `const { rows: noteRows } = useNoteChecklistTodos();`. Aucun changement de comportement de `/todos`.
- [ ] **Step 2: Compléter `useAgendaData`** : construire `overlays` pour la plage :
  - `trpc.calendar.overlay.useQuery({ from: dateKey(range.from), to: dateKey(range.to) })` → `kind: "todo"` (ouvre `/todos`) et `kind: "base"` (ouvre le side-peek : `window.dispatchEvent(new CustomEvent("supernote:open-peek", { detail: { baseId: item.typeId, entityId: item.entityId } }))`) ;
  - `useNoteChecklistTodos().rows` non faites dont `dueDate ?? startDate` tombe dans la plage → `kind: "checklist"` (ouvre `/notes/<sourceNoteId>`) ;
  - `loadSnoozed()` dont `until` tombe dans la plage → `kind: "snooze"`, `atMs = until`, titre = sujet mémorisé ou « Fil reporté » (ouvre `/mail?thread=<id>`) ;
  - `pendingFollowups(Date.now())` dont l'échéance tombe dans la plage → `kind: "followup"`, `atMs` = échéance, titre « Relance : <sujet> » (ouvre le fil) ;
  - relire reports et relances sur leurs événements de changement.
- [ ] **Step 3: Puces de filtre** dans `AgendaToolbar` : Todos · Reports et relances · Bases, activées par défaut, mémorisées dans `localStorage` (`supernote.agenda.sources`, try/catch) ; sur téléphone, dans la feuille de l'action d'en-tête « Vue ».
- [ ] **Step 4: Rendu** : puces d'overlay dans la bande « toute la journée » (icône par kind : `CheckSquare`, `ListChecks`, `Clock`, `ArrowBendUpLeft`, `Database`), marqueurs horaires pour reports et relances, lignes dans la liste et le mois.
- [ ] **Step 5: Vérifier** : `pnpm typecheck` → 15/15 ; `/todos` identique à avant (mêmes lignes, même nombre) ; `/agenda` montre une tâche datée, un report, une date de base.

---

## Lot 4 — Liens

### Task 12: Note de réunion

**Files:**
- Create: `apps/web/src/lib/meeting-note.ts`
- Modify: `apps/web/src/components/agenda/EventDetail.tsx`

**Interfaces:**
- Consumes: `trpc.entities.create` (même mutation que `useCreateNote`), `noteFilePath` (`components/notes/adapters.ts`), `findContactMatch`, `entityName` (`lib/contact-from-email.ts`)
- Produces: `buildMeetingNote(ev: CalEventRow, contacts: EntityRow[]): { title: string; fields: Record<string, string>; body: string; filePath: string }`

- [ ] **Step 1: `meeting-note.ts`** :

```ts
import type { CalEventRow } from "@supernote/ipc";
import { noteFilePath } from "@/components/notes/adapters";
import { entityName, findContactMatch, type EntityRow } from "./contact-from-email";

export const MEETING_FOLDER = "Réunions";

const DAY = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" });

export function buildMeetingNote(ev: CalEventRow, contacts: EntityRow[]) {
  const title = `${ev.summary} — ${DAY.format(ev.startAt)}`;
  const people = ev.attendees
    .filter((a) => !a.self)
    .map((a) => {
      const match = findContactMatch(contacts, a.email, a.name);
      return match ? `@${entityName(match.row)}` : a.name || a.email;
    });
  const where = ev.meetUrl ? `Visio : ${ev.meetUrl}` : ev.location ? `Lieu : ${ev.location}` : "";
  const body = [
    people.length ? `Participants : ${people.join(", ")}` : "",
    where,
    "",
    "## Ordre du jour",
    "",
    "## Notes",
    "",
    "## Actions",
    "",
    "- [ ] ",
  ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
  return {
    title,
    fields: { title, gcalEventId: ev.id, gcalCalendarId: ev.calendarId, eventStart: new Date(ev.startAt).toISOString() },
    body,
    filePath: noteFilePath(MEETING_FOLDER, title),
  };
}
```

- [ ] **Step 2: Bouton « Note de réunion »** dans `EventDetail` : si `ev.noteId` → `navigate(\`/notes/${ev.noteId}\`)` ; sinon charger les contacts (`utils.entities.listSummaries.fetch({ typeId: "personne", limit: 2000, offset: 0 })`), `buildMeetingNote`, `trpc.entities.create.mutateAsync({ typeId: "note", fields: { ...fields, filePath }, body })`, invalider `vault.folders.list`, émettre `CALENDAR_CHANGED_EVENT` (pour que `noteId` remonte), naviguer vers la note. Toast d'échec « Impossible de créer la note de réunion ».
- [ ] **Step 3: Vérifier** : `pnpm typecheck` → 15/15 ; créer la note depuis un événement simulé, rouvrir l'événement : le bouton ouvre la même note ; les participants qui sont des contacts deviennent des pastilles `@`.

### Task 13: Panneau « Aujourd'hui » dans `/mail`

**Files:**
- Create: `apps/web/src/components/agenda/TodayPanel.tsx`
- Modify: `apps/web/src/app/mail/page.tsx`

**Interfaces:**
- Consumes: `useAgendaData`, `viewRange("day", now)`, `EventDetail`, `buildMeetingNote` via le bouton de `EventDetail`
- Produces: `TodayPanel({ onClose }: { onClose?: () => void })`

- [ ] **Step 1: `TodayPanel.tsx`** — colonne de 300 px : en-tête « Aujourd'hui » + date ; « Prochain » en tête (premier événement non terminé, compte à rebours « dans 25 min », boutons « Rejoindre » et « Note de réunion ») ; chronologie des événements du jour (heure, titre, pastille) ; todos et checklists du jour (overlays sans heure) ; état non connecté : « Connecter Google Agenda » (même flux que la page) ; clic sur un événement → `EventDetail`.
- [ ] **Step 2: Monter dans `/mail`** (desktop) : dans le `return` final de `MailPage`, envelopper `<div className="relative flex min-h-0 flex-1 overflow-hidden">…</div>` dans une rangée `flex` et ajouter à droite `{todayOpen && <aside className="hidden h-full w-[300px] shrink-0 border-l xl:block" style={{ borderColor: "var(--border-subtle)" }}><TodayPanel /></aside>}` ; bouton icône `CalendarBlank` + Tooltip « Aujourd'hui » dans la rangée d'onglets (`tabStrip`) qui bascule `todayOpen`, mémorisé dans `localStorage` (`supernote.mail.todayPanel`, try/catch).
- [ ] **Step 3: Mobile** : `useMobileHeaderActions([{ id: "today", icon: CalendarBlank, label: "Aujourd'hui", onPress: () => setTodaySheet(true) }])` (fusionner avec les actions existantes de la page s'il y en a) et `MobileSheet` contenant `<TodayPanel onClose={…} />`.
- [ ] **Step 4: Vérifier** : `pnpm typecheck` → 15/15 ; ≥ 1280 px : panneau visible et repliable ; 360 px : action d'en-tête et feuille, pas de débordement.

### Task 14: Mail → événement

**Files:**
- Modify: `apps/web/src/components/mail/EmailToEventButton.tsx`, `apps/web/src/components/agenda/EventEditorModal.tsx` (prop `initial?: Partial<EventDraft>`)

- [ ] **Step 1:** Quand `isCalendarConnected()` et que le miroir est disponible, le bouton ouvre `EventEditorModal` avec `initial` = `{ summary: message.subject, description: \`${extrait}\n\n${lien Gmail}\`, startAt/endAt }` en reprenant la détection de date existante de `lib/email-to-event.ts` (exporter la fonction de détection si elle est interne) ; sinon comportement actuel (URL Google, `.ics`).
- [ ] **Step 2: Vérifier** : `pnpm typecheck` → 15/15 ; depuis un fil simulé, l'éditeur s'ouvre pré-rempli et l'événement apparaît dans `/agenda`.

### Task 15: e2e, banc simulé, carte du codebase

**Files:**
- Modify: `tests/e2e/03-navigate.spec.ts` (ajouter `/agenda` à la liste des pages rendues, attente : le texte « Agenda » ou l'état « Connecter Google Agenda »/« Ouvre un coffre »)
- Modify: `.claude/.codebase-info/` via `update-codebase-map` (`database.md` : tables `cal_*` ; `communication.md` : Google Agenda ; `entry-points.md` : `/agenda`)

- [ ] **Step 1:** Ajouter `/agenda` à l'e2e de navigation ; `pnpm test:e2e` → tout vert.
- [ ] **Step 2: Banc navigateur** (Chromium headless + CDP, coffre cloud pour un vrai worker OPFS, cf. mémoire « banc de test mobile émulé ») avec un `initScript` qui installe un faux `google.accounts.oauth2` (jeton immédiat) et intercepte `fetch` vers `www.googleapis.com/calendar/v3` : `calendarList` (2 agendas), `events` (10 événements dont un chevauchement, une journée entière sur 3 jours, une occurrence de série), `POST`/`PATCH`/`DELETE` qui renvoient l'événement. Scénarios : connexion, semaine, mois, liste 360 px, création hors ligne puis retour réseau, déplacement, RSVP, 401 deux fois → bandeau « Reconnecter », 412 → toast.
- [ ] **Step 3:** `pnpm typecheck` → 15/15, `pnpm test:e2e` vert, puis mise à jour de la carte.
- [ ] **Step 4: Contrôle réel** sur le compte Google connecté (autoriser le port de dev dans les origines OAuth, cf. mémoire « Port dev WSL/OAuth ») avant tout push.

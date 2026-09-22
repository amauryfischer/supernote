/**
 * Moteur de synchro du miroir Google Agenda. Google fait foi : on tire une
 * fenêtre glissante (J−60 → J+180) par agenda coché, en complet une fois par jour
 * et en delta (`updatedMin`) entre-temps, après avoir vidé la file d'écriture.
 * Pas de `syncToken` : Google l'interdit avec `timeMin`/`timeMax`, et sans
 * fenêtre une synchro initiale déplierait des années de récurrences.
 */

import { hasValidToken, requestAccessToken } from "./google-drive";
import { GoogleApiError, GoogleAuthError, isTransientGoogleError, markScopeRecovered } from "./google-api";
import {
  CALENDAR_EVENTS_SCOPE,
  CALENDAR_SCOPES,
  deleteEvent,
  insertEvent,
  listCalendars,
  listEventsPage,
  patchEvent,
  toEventInput,
  type GcalEventBody,
  type GcalEventResource,
} from "./gcal";
import { emitCalendarChanged } from "./calendar-mirror";
import { trpcVanillaClient } from "@/lib/trpc/client";

const DAY_MS = 86_400_000;
const WINDOW_BACK_DAYS = 60;
const WINDOW_AHEAD_DAYS = 180;
const FULL_SYNC_MS = DAY_MS;
const WINDOW_SLIDE_MS = 7 * DAY_MS;
/** Marge sur `updatedMin` : une modification faite pendant la requête ne tombe pas entre deux deltas. */
const UPDATED_MIN_SKEW_MS = 60_000;
const MAX_BACKOFF_MS = 10 * 60_000;

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

/** Jeton frais en cache, sans jamais déclencher d'acquisition (donc de popup). */
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
  return {
    from: today.getTime() - WINDOW_BACK_DAYS * DAY_MS,
    to: today.getTime() + WINDOW_AHEAD_DAYS * DAY_MS,
  };
}

async function fetchAll(
  clientId: string,
  calendarId: string,
  q: { timeMin: string; timeMax: string; updatedMin?: string },
): Promise<GcalEventResource[]> {
  const items: GcalEventResource[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listEventsPage(clientId, calendarId, { ...q, ...(pageToken ? { pageToken } : {}) });
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
    const etag = typeof op.payload["etag"] === "string" && op.payload["etag"] ? op.payload["etag"] : undefined;
    try {
      let ev: GcalEventResource | null = null;
      if (op.kind === "create") {
        ev = await insertEvent(clientId, op.calendarId, body, { meet: op.payload["meet"] === true });
      } else if (op.kind === "delete") {
        await deleteEvent(clientId, op.calendarId, op.eventId);
      } else {
        ev = await patchEvent(clientId, op.calendarId, op.eventId, body, {
          ...(etag ? { etag } : {}),
          sendUpdates: op.payload["sendUpdates"] === "none" ? "none" : "all",
        });
      }
      await trpcVanillaClient.calendar.resolveOutbox.mutate({
        accountId,
        opId: op.opId,
        outcome: "ack",
        ...(ev ? { event: toEventInput(op.calendarId, ev) } : {}),
      });
    } catch (err) {
      // Réseau, jeton ou quota : rien n'est compté, on reprendra au prochain tour.
      if (err instanceof GoogleAuthError || isTransientGoogleError(err)) return;
      if (err instanceof GoogleApiError && err.status === 412) {
        await trpcVanillaClient.calendar.resolveOutbox.mutate({ accountId, opId: op.opId, outcome: "drop" });
        window.dispatchEvent(new CustomEvent(CALENDAR_CONFLICT_EVENT));
        continue;
      }
      await trpcVanillaClient.calendar.resolveOutbox.mutate({
        accountId,
        opId: op.opId,
        outcome: "fail",
        error: err instanceof Error ? err.message : String(err),
        nextAttemptAt: now + Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** op.attempts),
      });
    }
  }
}

const inflight = new Map<string, Promise<void>>();
const queued = new Map<string, Promise<void>>();

/**
 * Vide la file d'écriture puis tire les agendas cochés. Coalescé par compte :
 * une demande pendant un tour en cours en relance un seul derrière lui, sans quoi
 * une écriture faite pendant la synchro attendrait le tour suivant (5 min).
 */
export function syncCalendars(clientId: string, accountId: string, opts: { force?: boolean } = {}): Promise<void> {
  const running = inflight.get(accountId);
  if (running) {
    let next = queued.get(accountId);
    if (!next) {
      next = running
        .catch(() => undefined)
        .then(() => {
          queued.delete(accountId);
          return syncCalendars(clientId, accountId, opts);
        });
      queued.set(accountId, next);
    }
    return next;
  }
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
      const delta =
        opts.force !== true &&
        !!st?.updatedMin &&
        Date.now() - st.lastFullSyncAt <= FULL_SYNC_MS &&
        Math.abs(st.windowStart - win.from) <= WINDOW_SLIDE_MS;
      const items = await fetchAll(clientId, cal.id, {
        timeMin,
        timeMax,
        ...(delta && st ? { updatedMin: st.updatedMin } : {}),
      });
      await trpcVanillaClient.calendar.syncUpsert.mutate({
        accountId,
        ...(delta ? {} : { replaceWindows: [{ calendarId: cal.id, from: win.from, to: win.to }] }),
        events: items.filter((e) => e.status !== "cancelled").map((e) => toEventInput(cal.id, e)),
        removals: delta
          ? items.filter((e) => e.status === "cancelled").map((e) => ({ calendarId: cal.id, id: e.id }))
          : [],
        states: [{ calendarId: cal.id, updatedMin: startedAt, windowStart: win.from, windowEnd: win.to, fullSync: !delta }],
      });
    }
    emitCalendarChanged();
  })().finally(() => inflight.delete(accountId));
  inflight.set(accountId, p);
  return p;
}

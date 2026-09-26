/**
 * Client REST Google Calendar v3 (agendas du compte, événements) et conversion
 * vers les lignes du miroir. Jeton et 401 passent par `googleRequest`.
 */

import type { CalAttendee, CalCalendarRow, CalEventInput } from "@supernote/ipc";
import { googleRequest, GoogleApiError } from "./google-api";

export const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const CALENDAR_SCOPES: readonly string[] = [CALENDAR_EVENTS_SCOPE, CALENDAR_LIST_SCOPE];
/** Demandé seulement au premier affichage/masquage ou changement de couleur (consentement incrémental). */
export const CALENDAR_LIST_WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist";

const BASE = "https://www.googleapis.com/calendar/v3";

interface GcalTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

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
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
  }>;
  organizer?: { self?: boolean };
  etag?: string;
  colorId?: string;
  extendedProperties?: { private?: Record<string, string> };
}

export interface GcalEventBody {
  summary?: string;
  description?: string;
  location?: string;
  start?: GcalTime;
  end?: GcalTime;
  attendees?: Array<{ email: string; responseStatus?: string }>;
  extendedProperties?: { private?: Record<string, string> };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function eventUrl(calendarId: string, eventId?: string): string {
  const base = `${BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
}

export type CalendarListPatch = Partial<Pick<CalCalendarRow, "selected" | "backgroundColor" | "foregroundColor">>;

/** Coché/décoché et couleur vivent dans la liste d'agendas Google : le réglage suit sur tous les appareils. */
export async function patchCalendarListEntry(clientId: string, calendarId: string, patch: CalendarListPatch): Promise<void> {
  await googleRequest(
    clientId,
    CALENDAR_LIST_WRITE_SCOPE,
    `${BASE}/users/me/calendarList/${encodeURIComponent(calendarId)}?colorRgbFormat=true`,
    { method: "PATCH", json: true, body: JSON.stringify(patch) },
    "Calendar list patch",
  );
}

export async function listCalendars(clientId: string): Promise<CalCalendarRow[]> {
  const out: CalCalendarRow[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ minAccessRole: "reader", maxResults: "250" });
    if (pageToken) q.set("pageToken", pageToken);
    const page = await json<{
      items?: Array<{
        id: string;
        summary?: string;
        summaryOverride?: string;
        backgroundColor?: string;
        foregroundColor?: string;
        selected?: boolean;
        primary?: boolean;
        accessRole?: string;
      }>;
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
  const page = await json<{ items?: GcalEventResource[]; nextPageToken?: string }>(
    await googleRequest(clientId, CALENDAR_EVENTS_SCOPE, `${eventUrl(calendarId)}?${params}`, {}, "Calendar events"),
  );
  return { items: page.items ?? [], ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}) };
}

export async function insertEvent(
  clientId: string,
  calendarId: string,
  body: GcalEventBody,
  opts: { meet: boolean },
): Promise<GcalEventResource> {
  const payload = opts.meet
    ? {
        ...body,
        conferenceData: {
          createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
        },
      }
    : body;
  return json(
    await googleRequest(
      clientId,
      CALENDAR_EVENTS_SCOPE,
      `${eventUrl(calendarId)}?conferenceDataVersion=1&sendUpdates=all`,
      { method: "POST", json: true, body: JSON.stringify(payload) },
      "Calendar insert",
    ),
  );
}

/** `none` : pas d'e-mail aux invités (un simple glisser dans la grille). */
export type SendUpdates = "all" | "none";

export async function patchEvent(
  clientId: string,
  calendarId: string,
  eventId: string,
  body: GcalEventBody,
  opts: { etag?: string; sendUpdates?: SendUpdates } = {},
): Promise<GcalEventResource> {
  const etag = opts.etag;
  return json(
    await googleRequest(
      clientId,
      CALENDAR_EVENTS_SCOPE,
      `${eventUrl(calendarId, eventId)}?sendUpdates=${opts.sendUpdates ?? "all"}`,
      { method: "PATCH", json: true, body: JSON.stringify(body), headers: etag ? { "If-Match": etag } : {} },
      "Calendar patch",
    ),
  );
}

export async function deleteEvent(clientId: string, calendarId: string, eventId: string): Promise<void> {
  try {
    await googleRequest(
      clientId,
      CALENDAR_EVENTS_SCOPE,
      `${eventUrl(calendarId, eventId)}?sendUpdates=all`,
      { method: "DELETE" },
      "Calendar delete",
    );
  } catch (err) {
    // Déjà supprimé côté Google : le but est atteint.
    if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
    throw err;
  }
}

function dateToLocalMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime();
}

export function toEventInput(calendarId: string, ev: GcalEventResource): CalEventInput {
  const allDay = !!ev.start?.date;
  const startAt = allDay ? dateToLocalMs(ev.start?.date ?? "") : Date.parse(ev.start?.dateTime ?? "");
  const endAt = allDay
    ? dateToLocalMs(ev.end?.date ?? ev.start?.date ?? "")
    : Date.parse(ev.end?.dateTime ?? ev.start?.dateTime ?? "");
  const attendees: CalAttendee[] = (ev.attendees ?? []).flatMap((a) =>
    a.email
      ? [{
          email: a.email,
          name: a.displayName ?? "",
          responseStatus: a.responseStatus ?? "needsAction",
          self: a.self === true,
          organizer: a.organizer === true,
        }]
      : [],
  );
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
    sourceRef: ev.extendedProperties?.private?.["supernoteRef"] ?? "",
  };
}

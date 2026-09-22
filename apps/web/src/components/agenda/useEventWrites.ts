import { useCallback, useMemo } from "react";
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

export type RsvpResponse = "accepted" | "tentative" | "declined";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Google : la date de fin d'un événement sur la journée entière est exclusive. */
function allDayEnd(startAt: number, endAt: number): number {
  return Math.max(addDays(startAt, 1), endAt);
}

function timesOf(d: Pick<EventDraft, "allDay" | "startAt" | "endAt">): Pick<GcalEventBody, "start" | "end"> {
  if (d.allDay) {
    return { start: { date: dateKey(d.startAt) }, end: { date: dateKey(allDayEnd(d.startAt, d.endAt)) } };
  }
  return {
    start: { dateTime: new Date(d.startAt).toISOString(), timeZone: TZ },
    end: { dateTime: new Date(d.endAt).toISOString(), timeZone: TZ },
  };
}

/**
 * Google remplace la liste d'invités entière : on ne l'envoie que si elle change,
 * avec la réponse déjà connue de chacun, sinon toutes repasseraient « en attente ».
 */
function bodyOf(d: EventDraft, base?: CalEventRow): GcalEventBody {
  const body: GcalEventBody = { summary: d.summary, description: d.description, location: d.location, ...timesOf(d) };
  const before = new Set(base?.attendees.map((a) => a.email) ?? []);
  const changed = !base || d.attendees.length !== before.size || d.attendees.some((e) => !before.has(e));
  if (changed && (d.attendees.length > 0 || before.size > 0)) {
    body.attendees = d.attendees.map((email) => {
      const known = base?.attendees.find((a) => a.email === email);
      return known ? { email, responseStatus: known.responseStatus } : { email };
    });
  }
  return body;
}

function toInput(ev: CalEventRow): CalEventInput {
  const { pending: _pending, noteId: _noteId, ...input } = ev;
  return input;
}

function rowOf(base: Partial<CalEventInput>, d: EventDraft, id: string): CalEventInput {
  return {
    calendarId: d.calendarId,
    id,
    summary: d.summary || "(sans titre)",
    description: d.description,
    location: d.location,
    startAt: d.startAt,
    endAt: d.allDay ? allDayEnd(d.startAt, d.endAt) : d.endAt,
    allDay: d.allDay,
    startDate: d.allDay ? dateKey(d.startAt) : "",
    endDate: d.allDay ? dateKey(allDayEnd(d.startAt, d.endAt)) : "",
    status: "confirmed",
    recurringEventId: base.recurringEventId ?? "",
    htmlLink: base.htmlLink ?? "",
    meetUrl: base.meetUrl ?? "",
    attendees: d.attendees.map(
      (email) =>
        base.attendees?.find((a) => a.email === email) ?? {
          email,
          name: "",
          responseStatus: "needsAction",
          self: false,
          organizer: false,
        },
    ),
    selfResponse: base.selfResponse ?? "accepted",
    etag: base.etag ?? "",
    colorId: base.colorId ?? "",
  };
}

/** Écritures optimistes : miroir modifié tout de suite, Google servi par l'outbox. */
export function useEventWrites(accountId: string) {
  const create = useCallback(
    async (d: EventDraft) => {
      const id = `local-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      await calApplyLocalMutation({
        accountId,
        opId: newCalendarOpId(),
        kind: "create",
        calendarId: d.calendarId,
        eventId: id,
        event: rowOf({}, d, id),
        payload: { body: bodyOf(d), meet: d.meet },
      });
    },
    [accountId],
  );

  const update = useCallback(
    async (ev: CalEventRow, draft: EventDraft) => {
      // L'éditeur ne montre pas l'utilisateur lui-même : il reste invité.
      const selfEmails = ev.attendees.filter((a) => a.self).map((a) => a.email);
      const d = { ...draft, attendees: [...new Set([...draft.attendees, ...selfEmails])] };
      await calApplyLocalMutation({
        accountId,
        opId: newCalendarOpId(),
        kind: "patch",
        calendarId: ev.calendarId,
        eventId: ev.id,
        event: rowOf(ev, d, ev.id),
        payload: { body: bodyOf(d, ev), etag: ev.etag },
      });
    },
    [accountId],
  );

  const move = useCallback(
    async (ev: CalEventRow, startAt: number, endAt: number) => {
      await calApplyLocalMutation({
        accountId,
        opId: newCalendarOpId(),
        kind: "patch",
        calendarId: ev.calendarId,
        eventId: ev.id,
        event: {
          ...toInput(ev),
          startAt,
          endAt,
          startDate: ev.allDay ? dateKey(startAt) : "",
          endDate: ev.allDay ? dateKey(endAt) : "",
        },
        // Un glisser dans la grille ne prévient pas les invités, comme un réglage fin ; l'éditeur, si.
        payload: { body: timesOf({ allDay: ev.allDay, startAt, endAt }), etag: ev.etag, sendUpdates: "none" },
      });
    },
    [accountId],
  );

  const remove = useCallback(
    async (ev: CalEventRow) => {
      await calApplyLocalMutation({
        accountId,
        opId: newCalendarOpId(),
        kind: "delete",
        calendarId: ev.calendarId,
        eventId: ev.id,
        payload: {},
      });
    },
    [accountId],
  );

  const rsvp = useCallback(
    async (ev: CalEventRow, response: RsvpResponse) => {
      const attendees = ev.attendees.map((a) => (a.self ? { ...a, responseStatus: response } : a));
      await calApplyLocalMutation({
        accountId,
        opId: newCalendarOpId(),
        kind: "rsvp",
        calendarId: ev.calendarId,
        eventId: ev.id,
        event: { ...toInput(ev), attendees, selfResponse: response },
        payload: {
          body: { attendees: attendees.map((a) => ({ email: a.email, responseStatus: a.responseStatus })) },
          etag: ev.etag,
        },
      });
    },
    [accountId],
  );

  return useMemo(() => ({ create, update, move, remove, rsvp }), [create, update, move, remove, rsvp]);
}

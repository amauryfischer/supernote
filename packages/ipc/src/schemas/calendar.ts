import { z } from "zod";

/**
 * Contrats du miroir Google Agenda (tables `cal_*` du coffre). Google reste la
 * source de vérité : le thread principal fait le réseau, le worker range et sert.
 * Noms préfixés : `export *` depuis l'index ne doit pas heurter `schemas/mail.ts`.
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
  /** Tâche liée au bloc (`todo:<id>`, `mail:<threadId>`, `checklist:<noteId>:<hash>`), sinon vide. */
  sourceRef: z.string(),
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
  /** Corps Google prêt à envoyer et options (`meet`, `etag`). */
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
  replaceWindows: z
    .array(z.object({ calendarId: z.string(), from: z.number(), to: z.number() }))
    .optional(),
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

export const CalendarSyncUpsertOutput = z.object({
  events: z.number().int(),
  removed: z.number().int(),
});
export type CalendarSyncUpsertOutput = z.infer<typeof CalendarSyncUpsertOutput>;

// ── calendar.listEvents ─────────────────────────────────────────────────────

export const CalendarListEventsInput = z.object({
  accountId: z.string(),
  from: z.number(),
  to: z.number(),
});
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
  /** État Google après ack : remplace la ligne, et l'id `local-…` d'une création. */
  event: CalEventInputSchema.optional(),
});
export type CalendarResolveOutboxInput = z.infer<typeof CalendarResolveOutboxInput>;

// ── calendar.overlay ────────────────────────────────────────────────────────

export const CalendarOverlayInput = z.object({ from: z.string(), to: z.string() });
export type CalendarOverlayInput = z.infer<typeof CalendarOverlayInput>;

export const CalendarOverlayOutput = z.object({ items: z.array(CalOverlayItemSchema) });
export type CalendarOverlayOutput = z.infer<typeof CalendarOverlayOutput>;

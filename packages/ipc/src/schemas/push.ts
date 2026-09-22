import { z } from "zod";

export const PushUpcomingInput = z.object({
  from: z.number(),
  to: z.number(),
  /** Compte de l'agenda connecté ; vide = pas d'événements. */
  accountId: z.string(),
});
export type PushUpcomingInput = z.infer<typeof PushUpcomingInput>;

export const PushUpcomingReminderSchema = z.object({
  todoId: z.string(),
  reminderAt: z.number(),
  text: z.string(),
  reminderText: z.string(),
});
export type PushUpcomingReminder = z.infer<typeof PushUpcomingReminderSchema>;

export const PushUpcomingEventSchema = z.object({
  calendarId: z.string(),
  eventId: z.string(),
  summary: z.string(),
  startAt: z.number(),
  meetUrl: z.string(),
  sourceRef: z.string(),
});
export type PushUpcomingEvent = z.infer<typeof PushUpcomingEventSchema>;

export const PushUpcomingOutput = z.object({
  reminders: z.array(PushUpcomingReminderSchema),
  events: z.array(PushUpcomingEventSchema),
});
export type PushUpcomingOutput = z.infer<typeof PushUpcomingOutput>;

/**
 * Accès client au miroir Google Agenda (routes `calendar.*` du worker). Même
 * garde de disponibilité que le miroir mail : il faut un coffre avec worker.
 */

import type { CalendarApplyLocalMutationInput, CalCalendarRow, CalEventRow } from "@supernote/ipc";
import { trpcVanillaClient } from "@/lib/trpc/client";

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

import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  CalendarSyncUpsertInput,
  CalendarSyncUpsertOutput,
  CalendarListEventsInput,
  CalendarListEventsOutput,
  CalendarAccountInput,
  CalendarListCalendarsOutput,
  CalendarGetStateOutput,
  CalendarOkOutput,
  CalendarApplyLocalMutationInput,
  CalendarListOutboxOutput,
  CalendarResolveOutboxInput,
  CalendarOverlayInput,
  CalendarOverlayOutput,
} from "../schemas/calendar.js";

/**
 * Miroir Google Agenda — implémenté par le worker du coffre
 * (`apps/web/src/lib/vault-worker/calendar-routes.ts`). Le réseau Google se fait
 * sur le thread principal (`apps/web/src/lib/gcal.ts`).
 */
export const calendarRouter = router({
  syncUpsert: publicProcedure
    .input(CalendarSyncUpsertInput)
    .output(CalendarSyncUpsertOutput)
    .mutation(() => {
      throw notImplemented("calendar.syncUpsert");
    }),

  listEvents: publicProcedure
    .input(CalendarListEventsInput)
    .output(CalendarListEventsOutput)
    .query(() => {
      throw notImplemented("calendar.listEvents");
    }),

  listCalendars: publicProcedure
    .input(CalendarAccountInput)
    .output(CalendarListCalendarsOutput)
    .query(() => {
      throw notImplemented("calendar.listCalendars");
    }),

  getState: publicProcedure
    .input(CalendarAccountInput)
    .output(CalendarGetStateOutput)
    .query(() => {
      throw notImplemented("calendar.getState");
    }),

  applyLocalMutation: publicProcedure
    .input(CalendarApplyLocalMutationInput)
    .output(CalendarOkOutput)
    .mutation(() => {
      throw notImplemented("calendar.applyLocalMutation");
    }),

  listOutbox: publicProcedure
    .input(CalendarAccountInput)
    .output(CalendarListOutboxOutput)
    .query(() => {
      throw notImplemented("calendar.listOutbox");
    }),

  resolveOutbox: publicProcedure
    .input(CalendarResolveOutboxInput)
    .output(CalendarOkOutput)
    .mutation(() => {
      throw notImplemented("calendar.resolveOutbox");
    }),

  clear: publicProcedure
    .input(CalendarAccountInput)
    .output(CalendarOkOutput)
    .mutation(() => {
      throw notImplemented("calendar.clear");
    }),

  overlay: publicProcedure
    .input(CalendarOverlayInput)
    .output(CalendarOverlayOutput)
    .query(() => {
      throw notImplemented("calendar.overlay");
    }),
});

export type CalendarRouter = typeof calendarRouter;

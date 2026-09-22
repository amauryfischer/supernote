"use client";

import { useEffect } from "react";
import { useToast } from "@supernote/ui";
import { useSettings } from "@/components/settings/SettingsContext";
import { mirrorAvailable } from "@/lib/mail-mirror";
import { CALENDAR_OUTBOX_EVENT } from "@/lib/calendar-mirror";
import {
  CALENDAR_CONFLICT_EVENT,
  calendarAccount,
  hasCalendarToken,
  isCalendarConnected,
  syncCalendars,
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
  const clientId = account?.clientId ?? "";
  const accountId = account?.accountId ?? "";

  useEffect(() => {
    if (!clientId || !accountId) return undefined;
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
    const onConflict = () =>
      toast({
        title: "Événement modifié ailleurs entre-temps",
        description: "Ta modification n'a pas été appliquée.",
        variant: "warning",
      });
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
  }, [clientId, accountId, toast]);

  return null;
}

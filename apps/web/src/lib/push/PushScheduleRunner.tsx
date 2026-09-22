"use client";

import { useEffect, useState } from "react";
import type { EntityOp } from "@supernote/sync";
import { useSettings } from "@/components/settings/SettingsContext";
import { useOnlineSync } from "@/lib/online-sync/OnlineSyncProvider";
import { onWorkerMessage } from "@/lib/trpc/browser-link";
import { hasWorkerBackend, trpcVanillaClient } from "@/lib/trpc/client";
import { mirrorAvailable } from "@/lib/mail-mirror";
import { CALENDAR_CHANGED_EVENT } from "@/lib/calendar-mirror";
import { calendarAccount, isCalendarConnected } from "@/lib/calendar-sync";
import { loadFollowups, MAIL_FOLLOWUP_EVENT } from "@/lib/mail-followup";
import { loadSnoozed, MAIL_SNOOZE_EVENT } from "@/lib/mail-triage";
import {
  refreshPushSubscription,
  sendPushSchedule,
  type PushCategory,
  type PushScheduleRow,
} from "./push-client";

const HORIZON_MS = 7 * 24 * 60 * 60_000;
// ponytail: prévenance fixe de 10 min ; un réglage si les notifications d'événement doublonnent avec Google Agenda.
const EVENT_LEAD_MS = 10 * 60_000;
const DEBOUNCE_MS = 10_000;
const TICK_MS = 15 * 60_000;
const CHANGE_EVENTS = [MAIL_FOLLOWUP_EVENT, MAIL_SNOOZE_EVENT, CALENDAR_CHANGED_EVENT];

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const threadUrl = (threadId: string) => `/mail?thread=${encodeURIComponent(threadId)}`;

function blockUrl(ref: string): string {
  const [kind = "", id = ""] = ref.split(":");
  if (kind === "todo") return `/todos?edit=${encodeURIComponent(id)}`;
  if (kind === "mail") return threadUrl(id);
  if (kind === "checklist") return `/notes/${encodeURIComponent(id)}`;
  return "/agenda";
}

async function computeSchedule(calendarAccountId: string): Promise<Partial<Record<PushCategory, PushScheduleRow[]>>> {
  const now = Date.now();
  // Lu à l'envoi : connecter l'agenda pose un drapeau localStorage sans re-rendre le runner.
  const accountId = isCalendarConnected() ? calendarAccountId : "";
  const ahead = (at: number) => at > now && at <= now + HORIZON_MS;
  const schedule: Partial<Record<PushCategory, PushScheduleRow[]>> = {
    followup: loadFollowups()
      .filter((f) => ahead(f.dueAt))
      .map((f) => ({
        key: `followup:${f.threadId}`,
        fireAt: f.dueAt,
        title: "Pas de réponse",
        body: f.subject,
        url: threadUrl(f.threadId),
        joinUrl: "",
      })),
    snooze: loadSnoozed()
      .filter((s) => ahead(s.until))
      .map((s) => ({
        key: `snooze:${s.threadId}`,
        fireAt: s.until,
        title: "De retour",
        body: s.subject || "Fil reporté",
        url: threadUrl(s.threadId),
        joinUrl: "",
      })),
  };
  // Sans worker, pas de source : une liste vide effacerait celle du salon.
  if (!mirrorAvailable()) return schedule;
  const { reminders, events } = await trpcVanillaClient.push.upcoming.query({
    from: now,
    to: now + HORIZON_MS,
    accountId,
  });
  schedule.reminder = reminders.map((r) => ({
    key: `reminder:${r.todoId}`,
    fireAt: r.reminderAt,
    title: "Rappel",
    body: r.reminderText || r.text,
    url: "/todos",
    joinUrl: "",
  }));
  // Sans agenda connecté, ne rien envoyer : un appareil sans Google viderait les événements du salon.
  if (accountId) {
    schedule.event = events
      .map((e): PushScheduleRow => {
        const key = `event:${e.calendarId}:${e.eventId}`;
        const body = e.summary || "(sans titre)";
        return e.sourceRef
          ? { key, fireAt: e.startAt, title: "C'est l'heure", body, url: blockUrl(e.sourceRef), joinUrl: e.meetUrl }
          : { key, fireAt: e.startAt - EVENT_LEAD_MS, title: `Dans ${EVENT_LEAD_MS / 60_000} min · ${hhmm(e.startAt)}`, body, url: "/agenda", joinUrl: e.meetUrl };
      })
      .filter((row) => row.fireAt > now);
  }
  return schedule;
}

export function PushScheduleRunner(): null {
  const { settings } = useSettings();
  const online = useOnlineSync();
  const subscribed = settings.notifications.pushSubscribed;
  const syncOn = Boolean(online?.config.enabled);
  const [synced, setSynced] = useState(false);
  const accountId = calendarAccount(settings)?.accountId ?? "";

  useEffect(() => {
    if (online?.status === "connected") setSynced(true);
  }, [online?.status]);

  useEffect(() => {
    if (!subscribed || !syncOn || !synced) return undefined;
    let debounce: number | undefined;
    const send = (keepalive = false) =>
      void computeSchedule(accountId)
        .then((categories) => sendPushSchedule(categories, keepalive))
        .catch((err: unknown) => console.warn("[push] envoi des échéances", err));
    const soon = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => send(), DEBOUNCE_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") send(true);
    };
    const tick = window.setInterval(() => {
      if (document.visibilityState === "visible") send();
    }, TICK_MS);
    const stopWorker = hasWorkerBackend()
      ? onWorkerMessage((msg) => {
          const m = msg as { type?: string; op?: EntityOp };
          if (m.type === "ENTITY_CHANGE" && (m.op?.kind === "delete" || m.op?.payload?.typeId === "todo")) soon();
        })
      : () => undefined;
    void refreshPushSubscription().catch((err: unknown) => console.warn("[push] réabonnement", err));
    soon();
    for (const name of CHANGE_EVENTS) window.addEventListener(name, soon);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(tick);
      stopWorker();
      for (const name of CHANGE_EVENTS) window.removeEventListener(name, soon);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [subscribed, syncOn, synced, accountId]);

  return null;
}

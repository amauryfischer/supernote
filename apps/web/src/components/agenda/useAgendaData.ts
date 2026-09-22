import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CalCalendarRow, CalEventRow } from "@supernote/ipc";
import { useSettings } from "@/components/settings/SettingsContext";
import { CALENDAR_CHANGED_EVENT, calListCalendars, calListEvents } from "@/lib/calendar-mirror";
import { calendarAccount } from "@/lib/calendar-sync";
import { mirrorAvailable } from "@/lib/mail-mirror";
import { loadSnoozed, MAIL_SNOOZE_EVENT } from "@/lib/mail-triage";
import { loadFollowups, MAIL_FOLLOWUP_EVENT } from "@/lib/mail-followup";
import { trpc } from "@/lib/trpc/client";
import { dateKey } from "@/lib/agenda/dates";
import { useNoteChecklistTodos } from "@/components/todos/useNoteChecklistTodos";

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

export interface AgendaData {
  events: CalEventRow[];
  calendars: CalCalendarRow[];
  overlays: AgendaOverlay[];
  loading: boolean;
}

const NO_EVENTS: CalEventRow[] = [];
const NO_CALENDARS: CalCalendarRow[] = [];
export type OverlaySource = "todos" | "mail" | "bases";

export function overlaySource(kind: AgendaOverlay["kind"]): OverlaySource {
  if (kind === "snooze" || kind === "followup") return "mail";
  return kind === "base" ? "bases" : "todos";
}

/** Reports et relances vivent en localStorage : relus quand leur store annonce un changement. */
function useMailTimers() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    window.addEventListener(MAIL_SNOOZE_EVENT, bump);
    window.addEventListener(MAIL_FOLLOWUP_EVENT, bump);
    window.addEventListener("storage", bump);
    return () => {
      window.removeEventListener(MAIL_SNOOZE_EVENT, bump);
      window.removeEventListener(MAIL_FOLLOWUP_EVENT, bump);
      window.removeEventListener("storage", bump);
    };
  }, []);
  return useMemo(() => ({ snoozes: loadSnoozed(), followups: loadFollowups() }), [tick]);
}

/** `checklists: false` : pas de lecture de toutes les notes (panneau de l'accueil). */
export function useAgendaData(range: { from: number; to: number }, opts: { checklists?: boolean } = {}): AgendaData {
  const { settings } = useSettings();
  const accountId = calendarAccount(settings)?.accountId ?? "";
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

  const navigate = useNavigate();
  const overlayQuery = trpc.calendar.overlay.useQuery(
    { from: dateKey(range.from), to: dateKey(range.to) },
    { enabled: mirrorAvailable(), staleTime: 30_000 },
  );
  const checklists = useNoteChecklistTodos(opts.checklists !== false).rows;
  const timers = useMailTimers();

  const overlays = useMemo<AgendaOverlay[]>(() => {
    const from = dateKey(range.from);
    const to = dateKey(range.to);
    const inRange = (key: string) => key >= from && key <= to;
    const out: AgendaOverlay[] = [];
    for (const item of overlayQuery.data?.items ?? []) {
      out.push({
        key: `${item.kind}:${item.entityId}:${item.fieldLabel}`,
        kind: item.kind,
        title: item.kind === "base" ? `${item.title} · ${item.fieldLabel}` : item.title,
        date: item.date,
        atMs: null,
        onOpen:
          item.kind === "todo"
            ? () => navigate("/todos")
            : () =>
                window.dispatchEvent(
                  new CustomEvent("supernote:open-peek", { detail: { baseId: item.typeId, entityId: item.entityId } }),
                ),
      });
    }
    for (const row of checklists) {
      const date = (row.dueDate ?? row.startDate ?? "").slice(0, 10);
      if (row.done || !date || !inRange(date) || !row.sourceNoteId) continue;
      const noteId = row.sourceNoteId;
      out.push({ key: `checklist:${row.id}`, kind: "checklist", title: row.text, date, atMs: null, onOpen: () => navigate(`/notes/${noteId}`) });
    }
    const openThread = (id: string) => () => navigate(`/mail?thread=${encodeURIComponent(id)}`);
    for (const s of timers.snoozes) {
      if (s.until < range.from || s.until > range.to) continue;
      out.push({ key: `snooze:${s.threadId}`, kind: "snooze", title: s.subject || "Fil reporté", date: dateKey(s.until), atMs: s.until, onOpen: openThread(s.threadId) });
    }
    for (const f of timers.followups) {
      if (f.dueAt < range.from || f.dueAt > range.to) continue;
      out.push({ key: `followup:${f.threadId}`, kind: "followup", title: `Relance : ${f.subject || "sans objet"}`, date: dateKey(f.dueAt), atMs: f.dueAt, onOpen: openThread(f.threadId) });
    }
    return out;
  }, [overlayQuery.data, checklists, timers, range.from, range.to, navigate]);

  useEffect(() => {
    const refresh = () => void qc.invalidateQueries({ queryKey: ["calendar"] });
    window.addEventListener(CALENDAR_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CALENDAR_CHANGED_EVENT, refresh);
  }, [qc]);

  return {
    events: events.data ?? NO_EVENTS,
    calendars: calendars.data ?? NO_CALENDARS,
    overlays,
    loading: enabled && events.isLoading,
  };
}

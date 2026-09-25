"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router-dom";
import type { CalEventRow } from "@supernote/ipc";
import { CalendarBlank, CalendarPlus, Plus } from "@phosphor-icons/react";
import { EmptyState, useToast } from "@supernote/ui";
import { AppShell, MobileSheet, useMobileFab, useMobileHeaderActions, useMobileTitle } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSettings } from "@/components/settings/SettingsContext";
import { useWorkerReady } from "@/components/notes/hooks";
import { useConfirm } from "@/lib/confirm";
import { GOOGLE_AUTH_EVENT, googleReconnectRequired } from "@/lib/google-api";
import {
  calendarAccount,
  connectCalendar,
  disconnectCalendar,
  hasCalendarToken,
  isCalendarConnected,
  syncCalendars,
} from "@/lib/calendar-sync";
import { stepAnchor, viewRange, type AgendaView } from "@/lib/agenda/dates";
import { SLOT_MIN } from "@/lib/agenda/free-slots";
import { AgendaToolbar } from "@/components/agenda/AgendaToolbar";
import { AgendaList } from "@/components/agenda/AgendaList";
import { EventDetail } from "@/components/agenda/EventDetail";
import { EventEditorModal } from "@/components/agenda/EventEditorModal";
import { MonthGrid } from "@/components/agenda/MonthGrid";
import { TimeGrid } from "@/components/agenda/TimeGrid";
import { canEditCalendar } from "@/components/agenda/EventBlock";
import { overlaySource, useAgendaData, type OverlaySource } from "@/components/agenda/useAgendaData";
import { useEventWrites, type EventDraft } from "@/components/agenda/useEventWrites";
import { useSchedulableTasks } from "@/components/agenda/useSchedulableTasks";
import { TaskDrawer } from "@/components/agenda/TaskDrawer";
import { ScheduleTaskSheet } from "@/components/agenda/ScheduleTaskSheet";

const VIEW_KEY = "supernote.agenda.view";
const SOURCES_KEY = "supernote.agenda.sources";
const ALL_SOURCES: Record<OverlaySource, boolean> = { todos: true, mail: true, bases: true };

function readSources(): Record<OverlaySource, boolean> {
  try {
    const raw = window.localStorage.getItem(SOURCES_KEY);
    return raw ? { ...ALL_SOURCES, ...(JSON.parse(raw) as Partial<Record<OverlaySource, boolean>>) } : ALL_SOURCES;
  } catch {
    return ALL_SOURCES;
  }
}
const VIEWS: readonly AgendaView[] = ["day", "week", "month", "list"];
const SHORTCUTS: Record<string, AgendaView> = { j: "day", s: "week", m: "month", l: "list" };

function readView(isMobile: boolean): AgendaView {
  try {
    const v = window.localStorage.getItem(VIEW_KEY);
    if (v && (VIEWS as readonly string[]).includes(v)) return v as AgendaView;
  } catch {
    /* stockage indisponible : vue par défaut */
  }
  return isMobile ? "list" : "week";
}

function subscribeAuth(onChange: () => void): () => void {
  window.addEventListener(GOOGLE_AUTH_EVENT, onChange);
  return () => window.removeEventListener(GOOGLE_AUTH_EVENT, onChange);
}

type EditorState = { mode: "create"; initial: Partial<EventDraft> & { startAt: number; endAt: number } } | { mode: "edit"; event: CalEventRow };

export default function AgendaPage() {
  const isMobile = useIsMobile();
  const workerReady = useWorkerReady();
  const { settings } = useSettings();
  const account = calendarAccount(settings);
  const clientId = account?.clientId ?? "";
  const accountId = account?.accountId ?? "";
  const { toast } = useToast();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();

  const [view, setViewState] = useState<AgendaView>(() => readView(isMobile));
  const [anchor, setAnchor] = useState(() => Date.now());
  const [connected, setConnected] = useState(() => isCalendarConnected());
  const [tokenTick, setTokenTick] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [sources, setSources] = useState(readSources);
  const [scheduling, setScheduling] = useState<{ task: { ref: string; title: string } | null } | null>(null);
  const reconnectRequired = useSyncExternalStore(subscribeAuth, () => googleReconnectRequired("calendar"), () => false);

  const range = useMemo(() => viewRange(view, anchor), [view, anchor]);
  const data = useAgendaData(range);
  const writes = useEventWrites(accountId);
  const { tasks, openRefs } = useSchedulableTasks();
  const toPlan = useMemo(() => tasks.filter((t) => !t.block), [tasks]);
  const selected = data.events.find((e) => e.id === selectedId) ?? null;
  const overlays = useMemo(() => data.overlays.filter((o) => sources[overlaySource(o.kind)]), [data.overlays, sources]);
  const toggleSource = (s: OverlaySource) =>
    setSources((prev) => {
      const next = { ...prev, [s]: !prev[s] };
      try {
        window.localStorage.setItem(SOURCES_KEY, JSON.stringify(next));
      } catch {
        /* filtre valable pour la session */
      }
      return next;
    });
  const pendingCount = data.events.filter((e) => e.pending).length;
  // Relu à chaque rendu : un jeton expire sans prévenir (1 h).
  const syncPaused = connected && !!clientId && !hasCalendarToken(clientId) && tokenTick >= 0;

  useMobileTitle("Agenda");
  const openCreate = useCallback((startAt?: number, endAt?: number, allDay = false) => {
    const start = startAt ?? Math.ceil(Date.now() / 1_800_000) * 1_800_000;
    setEditor({ mode: "create", initial: { startAt: start, endAt: endAt ?? start + 3_600_000, allDay } });
  }, []);
  useMobileFab(connected ? { icon: Plus, label: "Nouvel événement", onPress: () => openCreate() } : null);
  useMobileHeaderActions(
    isMobile && connected
      ? [{ id: "schedule-task", icon: CalendarPlus, label: "Planifier une tâche", onPress: () => setScheduling({ task: null }) }]
      : [],
  );

  const setView = (v: AgendaView) => {
    setViewState(v);
    try {
      window.localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* la vue reste valable pour la session */
    }
  };

  const onNavigate = (dir: -1 | 0 | 1) => setAnchor((a) => (dir === 0 ? Date.now() : stepAnchor(view, a, dir)));

  const runSync = useCallback(
    async (force = false) => {
      if (!clientId || !accountId) return;
      try {
        await syncCalendars(clientId, accountId, { force });
      } catch (err) {
        console.warn("[agenda] synchro", err);
      }
    },
    [clientId, accountId],
  );

  const connect = async () => {
    if (!clientId) return;
    try {
      await connectCalendar(clientId);
      setConnected(true);
      setTokenTick((t) => t + 1);
      await runSync(true);
    } catch (err) {
      toast({
        title: "Connexion à Google Agenda impossible",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: "Déconnecter l'agenda ?",
      body: "Les événements copiés sur cet appareil sont effacés. Rien n'est supprimé dans Google Agenda.",
      confirmLabel: "Déconnecter",
      variant: "danger",
    });
    if (!ok) return;
    await disconnectCalendar(accountId);
    setConnected(false);
    setSelectedId(null);
  };

  // Synchro à l'ouverture, et rafraîchissement de l'état du jeton au retour sur l'onglet.
  useEffect(() => {
    if (connected && workerReady && clientId && hasCalendarToken(clientId)) void runSync();
    const onVisible = () => setTokenTick((t) => t + 1);
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [connected, workerReady, clientId, runSync]);

  // `?event=&at=` : clic sur la notification d'avant-réunion, qui ouvre la fiche et son brief.
  useEffect(() => {
    const eventId = params.get("event");
    if (!eventId) return;
    const at = Number(params.get("at"));
    if (Number.isFinite(at) && at > 0) setAnchor(at);
    setSelectedId(eventId);
    params.delete("event");
    params.delete("at");
    setParams(params, { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  // `?new=1` : commande de palette « Nouvel événement ».
  useEffect(() => {
    if (params.get("new") !== "1" || !connected) return;
    openCreate();
    params.delete("new");
    setParams(params, { replace: true });
  }, [params, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || editor) return;
      if (document.querySelector('[role="dialog"], [cmdk-root]')) return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const v = SHORTCUTS[e.key];
      if (v) setView(v);
      else if (e.key === "t") onNavigate(0);
      else if (e.key === "ArrowLeft") onNavigate(-1);
      else if (e.key === "ArrowRight") onNavigate(1);
      else if (e.key === "Escape") setSelectedId(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Balayage horizontal en vue Jour, au doigt.
  const touchX = useRef<number | null>(null);
  const swipeHandlers = isMobile && view === "day"
    ? {
        onTouchStart: (e: React.TouchEvent) => {
          touchX.current = e.touches[0]?.clientX ?? null;
        },
        onTouchEnd: (e: React.TouchEvent) => {
          const x0 = touchX.current;
          const x1 = e.changedTouches[0]?.clientX;
          touchX.current = null;
          if (x0 === null || x1 === undefined || Math.abs(x1 - x0) < 60) return;
          onNavigate(x1 < x0 ? 1 : -1);
        },
      }
    : {};

  const save = async (draft: EventDraft) => {
    if (editor?.mode === "edit") await writes.update(editor.event, draft);
    else await writes.create(draft);
    toast({
      title: navigator.onLine ? "Événement enregistré" : "Événement enregistré, envoyé au retour du réseau",
      variant: "success",
    });
  };

  const remove = async (ev: CalEventRow) => {
    const ok = await confirm({
      title: "Supprimer l'événement ?",
      body: ev.attendees.length > 1 ? "Les invités seront prévenus par Google." : `« ${ev.summary} » sera supprimé de Google Agenda.`,
      confirmLabel: "Supprimer",
      variant: "danger",
    });
    if (!ok) return;
    await writes.remove(ev);
    setSelectedId(null);
  };

  const move = (ev: CalEventRow, startAt: number, endAt: number) => {
    if (!canEditCalendar(data.calendars, ev.calendarId)) return;
    void writes.move(ev, startAt, endAt);
  };

  const dropTask = (ref: string, startAt: number) => {
    const task = tasks.find((t) => t.ref === ref);
    if (!task) return;
    // Après un lâcher il n'y a plus de contrôle pour porter l'erreur : toast.
    writes
      .scheduleTask({ ref, title: task.title, startAt, endAt: startAt + SLOT_MIN * 60_000 })
      .catch((err: unknown) =>
        toast({
          title: "Planification impossible",
          description: err instanceof Error ? err.message : String(err),
          variant: "danger",
        }),
      );
  };

  const gridProps = {
    days: range.days,
    events: data.events,
    calendars: data.calendars,
    overlays,
    openTaskRefs: openRefs,
    onSelectEvent: (ev: CalEventRow) => setSelectedId(ev.id),
    onCreateAt: (startAt: number, endAt: number, allDay: boolean) => openCreate(startAt, endAt, allDay),
  };

  let body: React.ReactNode;
  if (!workerReady) {
    body = (
      <EmptyState
        icon={<CalendarBlank size={28} aria-hidden />}
        title="Ouvre un coffre pour utiliser l'agenda"
        description="Les événements sont copiés dans le coffre pour rester lisibles hors ligne."
      />
    );
  } else if (!account) {
    body = (
      <EmptyState
        icon={<CalendarBlank size={28} aria-hidden />}
        title="Connecte d'abord ton compte Google"
        description="L'agenda utilise le compte Google configuré dans Paramètres › Gmail."
      />
    );
  } else if (!connected || reconnectRequired) {
    body = (
      <EmptyState
        icon={<CalendarBlank size={28} aria-hidden />}
        title={reconnectRequired ? "Reconnexion à Google Agenda requise" : "Google Agenda n'est pas connecté"}
        description="Tes événements s'affichent ici avec tes todos, tes reports de mail et les dates de tes bases."
        action={{ label: reconnectRequired ? "Reconnecter" : "Connecter Google Agenda", onClick: () => void connect() }}
      />
    );
  }

  const gridView =
    view === "month" ? (
      <MonthGrid
        {...gridProps}
        month={anchor}
        onPickDay={(day) => {
          setAnchor(day);
          setView("day");
        }}
      />
    ) : view === "list" ? (
      <AgendaList {...gridProps} />
    ) : (
      <TimeGrid {...gridProps} interactive={!isMobile} onMoveEvent={move} onDropTask={isMobile ? undefined : dropTask} />
    );

  const detail = selected && (
    <EventDetail
      event={selected}
      calendars={data.calendars}
      onClose={() => setSelectedId(null)}
      onEdit={() => setEditor({ mode: "edit", event: selected })}
      onDelete={() => void remove(selected)}
      onRsvp={(r) => void writes.rsvp(selected, r)}
      onUnschedule={() => {
        void writes.remove(selected);
        setSelectedId(null);
      }}
    />
  );

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col">
        {body ? (
          <div className="flex flex-1 items-center justify-center p-6">{body}</div>
        ) : (
          <>
            <AgendaToolbar
              view={view}
              anchor={anchor}
              isMobile={isMobile}
              onView={setView}
              onNavigate={onNavigate}
              syncPaused={syncPaused}
              onResume={() => void connect()}
              pendingCount={pendingCount}
              onSyncNow={() => void runSync(true)}
              onDisconnect={() => void disconnect()}
              sources={sources}
              onToggleSource={toggleSource}
            />
            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col" {...swipeHandlers}>
                {gridView}
              </div>
              {!isMobile && (view === "day" || view === "week") && (
                <TaskDrawer tasks={toPlan} onPick={(t) => setScheduling({ task: { ref: t.ref, title: t.title } })} />
              )}
              {!isMobile && detail && (
                <aside
                  className="w-[340px] shrink-0 overflow-y-auto border-l"
                  style={{ borderColor: "var(--border-subtle)", background: "var(--surface-0)" }}
                  aria-label="Détail de l'événement"
                >
                  {detail}
                </aside>
              )}
            </div>
          </>
        )}
      </div>

      {isMobile && selected && (
        <MobileSheet isOpen onClose={() => setSelectedId(null)} title={selected.summary} size="lg">
          {detail}
        </MobileSheet>
      )}

      {editor && (
        <EventEditorModal
          isOpen
          isMobile={isMobile}
          calendars={data.calendars}
          mode={editor.mode}
          initial={
            editor.mode === "edit"
              ? {
                  calendarId: editor.event.calendarId,
                  summary: editor.event.summary,
                  description: editor.event.description,
                  location: editor.event.location,
                  allDay: editor.event.allDay,
                  startAt: editor.event.startAt,
                  endAt: editor.event.endAt,
                  attendees: editor.event.attendees.filter((a) => !a.self).map((a) => a.email),
                }
              : editor.initial
          }
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}

      {scheduling && (
        <ScheduleTaskSheet task={scheduling.task} pickFrom={toPlan} onClose={() => setScheduling(null)} />
      )}
    </AppShell>
  );
}

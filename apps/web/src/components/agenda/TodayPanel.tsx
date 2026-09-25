"use client";

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CalEventRow } from "@supernote/ipc";
import { CalendarBlank, VideoCamera, X } from "@phosphor-icons/react";
import { Button, Tooltip } from "@supernote/ui";
import { useSettings } from "@/components/settings/SettingsContext";
import { useConfirm } from "@/lib/confirm";
import { calendarAccount, isCalendarConnected } from "@/lib/calendar-sync";
import { formatDayLong, formatSpan, viewRange } from "@/lib/agenda/dates";
import { calendarColor } from "./EventBlock";
import { EventDetail } from "./EventDetail";
import { OverlayChip } from "./OverlayChip";
import { useAgendaData } from "./useAgendaData";
import { useEventWrites } from "./useEventWrites";
import { CommitmentsTodaySection } from "@/components/mail/CommitmentsTodaySection";

function untilLabel(ev: CalEventRow, now: number): string {
  if (ev.startAt <= now) return "en cours";
  const min = Math.round((ev.startAt - now) / 60_000);
  if (min < 60) return `dans ${min} min`;
  const h = Math.floor(min / 60);
  return `dans ${h} h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}` : ""}`;
}

/** Journée en cours à côté de la boîte : prochain événement, chronologie, todos du jour. */
export function TodayPanel({ onClose }: { onClose?: () => void }) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { settings } = useSettings();
  const accountId = calendarAccount(settings)?.accountId ?? "";
  const [now, setNow] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const range = useMemo(() => viewRange("day", now), [Math.floor(now / 86_400_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = useAgendaData(range, { checklists: false });
  const writes = useEventWrites(accountId);
  const connected = isCalendarConnected();

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const timed = data.events.filter((e) => !e.allDay);
  const allDay = data.events.filter((e) => e.allDay);
  const next = timed.find((e) => e.endAt > now) ?? null;
  const selected = data.events.find((e) => e.id === selectedId) ?? null;

  if (selected) {
    return (
      <div className="h-full overflow-y-auto">
        <EventDetail
          event={selected}
          calendars={data.calendars}
          onClose={() => setSelectedId(null)}
          onEdit={() => navigate("/agenda")}
          onDelete={async () => {
            const ok = await confirm({
              title: "Supprimer l'événement ?",
              body: `« ${selected.summary} » sera supprimé de Google Agenda.`,
              confirmLabel: "Supprimer",
              variant: "danger",
            });
            if (!ok) return;
            await writes.remove(selected);
            setSelectedId(null);
          }}
          onRsvp={(r) => void writes.rsvp(selected, r)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex items-start gap-2 px-4 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Aujourd'hui
          </h2>
          <p className="text-xs capitalize" style={{ color: "var(--text-muted)" }}>
            {formatDayLong(now)}
          </p>
        </div>
        <Tooltip content="Ouvrir l'agenda">
          <Button variant="ghost" size="icon" isIconOnly aria-label="Ouvrir l'agenda" onPress={() => navigate("/agenda")}>
            <CalendarBlank size={16} aria-hidden />
          </Button>
        </Tooltip>
        {onClose && (
          <Tooltip content="Fermer">
            <Button variant="ghost" size="icon" isIconOnly aria-label="Fermer le panneau Aujourd'hui" onPress={onClose}>
              <X size={16} aria-hidden />
            </Button>
          </Tooltip>
        )}
      </div>

      {!connected ? (
        <div className="flex flex-col items-start gap-2 px-4 py-3 text-sm" style={{ color: "var(--text-secondary)" }}>
          <p>Connecte Google Agenda pour voir ta journée ici.</p>
          <Button variant="outline" size="sm" onPress={() => navigate("/agenda")}>
            Aller à l'agenda
          </Button>
        </div>
      ) : (
        <>
          {next && (
            <div className="mx-3 mb-3 flex flex-col gap-2 rounded-lg border p-3" style={{ borderColor: "var(--border-subtle)", background: "var(--surface-1)" }}>
              <span className="sn-eyebrow sn-eyebrow--compact">Prochain · {untilLabel(next, now)}</span>
              <button
                type="button"
                onClick={() => setSelectedId(next.id)}
                className="text-left text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                style={{ color: "var(--text-primary)" }}
              >
                {next.summary}
              </button>
              <span className="text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {formatSpan(next)}
                {next.location ? ` · ${next.location}` : ""}
              </span>
              {next.meetUrl && (
                <Button variant="primary" size="sm" className="self-start" onPress={() => window.open(next.meetUrl, "_blank", "noopener")}>
                  <VideoCamera size={14} aria-hidden />
                  Rejoindre
                </Button>
              )}
            </div>
          )}

          <ul className="flex flex-col px-2 pb-3">
            {[...allDay, ...timed].map((ev) => (
              <li key={ev.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(ev.id)}
                  className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left outline-none transition-colors hover:bg-[var(--nav-hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                  style={{ opacity: ev.endAt <= now && !ev.allDay ? 0.55 : 1 }}
                >
                  <span className="w-11 shrink-0 text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {ev.allDay ? "Journée" : formatSpan(ev).split(" – ")[0]}
                  </span>
                  <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: calendarColor(data.calendars, ev.calendarId) }} />
                  <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text-primary)" }}>
                    {ev.summary}
                  </span>
                </button>
              </li>
            ))}
            {data.events.length === 0 && !data.loading && (
              <li className="px-2 py-2 text-sm" style={{ color: "var(--text-muted)" }}>
                Aucun événement aujourd'hui.
              </li>
            )}
          </ul>

          {data.overlays.length > 0 && (
            <div className="flex flex-col gap-1 border-t px-3 py-3" style={{ borderColor: "var(--border-subtle)" }}>
              <span className="sn-eyebrow sn-eyebrow--compact px-1">À faire aujourd'hui</span>
              {data.overlays.map((o) => (
                <OverlayChip key={o.key} overlay={o} showTime />
              ))}
            </div>
          )}
        </>
      )}

      <CommitmentsTodaySection />
    </div>
  );
}

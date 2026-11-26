"use client";

import { CalendarCheck, CaretRight } from "@phosphor-icons/react";
import { Button } from "@supernote/ui";
import { meetingWhen, type MeetingAgenda } from "@/lib/mail-agenda";

const MAX_SHOWN = 3;

/** Ordres du jour des réunions à venir : les fils étiquetés pour une réunion, à côté de son créneau. */
export function MeetingAgendaStrip({
  agendas,
  now,
  onOpen,
}: {
  agendas: MeetingAgenda[];
  now: number;
  onOpen: (agenda: MeetingAgenda) => void;
}) {
  if (agendas.length === 0) return null;
  return (
    <section
      aria-label="Ordres du jour à venir"
      className="flex flex-col gap-0.5 px-2 py-1.5"
      style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}
    >
      {agendas.slice(0, MAX_SHOWN).map((a) => {
        const soon = a.event.startAt - now <= 86_400_000;
        return (
          <Button
            key={`${a.event.id}:${a.labelId}`}
            variant="ghost"
            className="h-auto min-h-9 w-full justify-start gap-2 px-2 py-1 text-left"
            onPress={() => onOpen(a)}
          >
            <CalendarCheck size={16} aria-hidden style={{ color: soon ? "var(--sn-ember-ink)" : "var(--text-muted)" }} />
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
              <span className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {a.event.summary}
              </span>
              <span className="font-mono text-[11px] tabular-nums" style={{ color: soon ? "var(--sn-ember-ink)" : "var(--text-secondary)" }}>
                {meetingWhen(a.event.startAt, now)}
              </span>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {a.items.length} fil{a.items.length > 1 ? "s" : ""} « {a.labelName} »
                {a.oldestDays >= 7 ? ` · le plus ancien attend depuis ${a.oldestDays} j` : ""}
              </span>
            </span>
            <CaretRight size={14} aria-hidden style={{ color: "var(--text-muted)" }} />
          </Button>
        );
      })}
      {agendas.length > MAX_SHOWN && (
        <span className="px-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
          + {agendas.length - MAX_SHOWN} autre{agendas.length - MAX_SHOWN > 1 ? "s" : ""} réunion{agendas.length - MAX_SHOWN > 1 ? "s" : ""} avec des fils en attente
        </span>
      )}
    </section>
  );
}

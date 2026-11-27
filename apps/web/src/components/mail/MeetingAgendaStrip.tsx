"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarCheck, CaretRight, ListChecks } from "@phosphor-icons/react";
import { Button, Checkbox, Tooltip } from "@supernote/ui";
import { meetingWhen, type MeetingAgenda } from "@/lib/mail-agenda";
import { displaySubject, type MailAnnotation } from "@/lib/mail-annotations";

const MAX_SHOWN = 3;
const UNDO_MS = 8000;

const keyOf = (a: MeetingAgenda) => `${a.event.id}:${a.labelId}`;

/** Ordres du jour des réunions à venir : les fils étiquetés pour une réunion, à côté de son créneau. */
export function MeetingAgendaStrip({
  agendas,
  now,
  onOpen,
  onSetLabel,
  annotations,
}: {
  annotations?: ReadonlyMap<string, MailAnnotation>;
  agendas: MeetingAgenda[];
  now: number;
  onOpen: (agenda: MeetingAgenda) => void;
  /** Retire (ou remet, pour annuler) le label de l'ordre du jour sur ces fils. */
  onSetLabel?: (threadIds: string[], labelId: string, on: boolean) => void;
}) {
  const [ticking, setTicking] = useState<string | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [undo, setUndo] = useState<{ ids: string[]; labelId: string; labelName: string } | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  if (agendas.length === 0 && !undo) return null;

  const clear = (a: MeetingAgenda) => {
    const ids = a.items.filter((it) => checked.has(it.id)).map((it) => it.id);
    if (!onSetLabel || ids.length === 0) return;
    onSetLabel(ids, a.labelId, false);
    setTicking(null);
    setChecked(new Set());
    window.clearTimeout(undoTimer.current);
    setUndo({ ids, labelId: a.labelId, labelName: a.labelName });
    undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
  };

  return (
    <section
      aria-label="Ordres du jour à venir"
      className="flex flex-col gap-0.5 px-2 py-1.5"
      style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}
    >
      {agendas.slice(0, MAX_SHOWN).map((a) => {
        const soon = a.event.startAt - now <= 86_400_000;
        const open = ticking === keyOf(a);
        return (
          <div key={keyOf(a)} className="flex flex-col">
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                className="h-auto min-h-9 min-w-0 flex-1 justify-start gap-2 px-2 py-1 text-left"
                onPress={() => onOpen(a)}
              >
                <CalendarCheck size={16} aria-hidden style={{ color: soon ? "var(--sn-ember-ink)" : "var(--text-muted)" }} />
                <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                  <span className="truncate text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {a.event.summary}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums" style={{ color: soon ? "var(--sn-ember-ink)" : "var(--text-secondary)" }}>
                    {meetingWhen(a.event.startAt, now, a.event.endAt)}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {a.items.length} fil{a.items.length > 1 ? "s" : ""} « {a.labelName} »
                    {a.oldestDays >= 7 ? ` · le plus ancien a ${a.oldestDays} j` : ""}
                  </span>
                </span>
                <CaretRight size={14} aria-hidden style={{ color: "var(--text-muted)" }} />
              </Button>
              {onSetLabel && (
                <Tooltip content={open ? "Fermer la liste" : "Cocher les points traités"}>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={open ? "Fermer la liste des points" : `Cocher les points traités de ${a.event.summary}`}
                    aria-expanded={open}
                    className="sn-hit h-9 min-h-9 w-9 min-w-9 shrink-0"
                    style={open ? { color: "var(--text-primary)", background: "var(--surface-2)" } : { color: "var(--text-muted)" }}
                    onPress={() => {
                      setTicking(open ? null : keyOf(a));
                      setChecked(new Set());
                    }}
                  >
                    <ListChecks size={16} aria-hidden />
                  </Button>
                </Tooltip>
              )}
            </div>
            {open && (
              <div className="flex flex-col gap-1 pb-1.5 pl-8 pr-1 pt-0.5">
                <ul className="flex flex-col">
                  {a.items.map((it) => (
                    <li key={it.id} className="min-h-8">
                      <Checkbox
                        isSelected={checked.has(it.id)}
                        onChange={(on) =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            if (on) next.add(it.id);
                            else next.delete(it.id);
                            return next;
                          })
                        }
                        className="flex min-h-8 w-full items-center gap-2 text-[13px]"
                      >
                        <span className="min-w-0 truncate" style={{ color: "var(--text-primary)" }}>
                          {displaySubject(it.subject, it.snippet, annotations?.get(it.id)) || "(sans objet)"}
                        </span>
                        <span className="shrink-0 text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {it.from.name || it.from.email}
                        </span>
                      </Checkbox>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-end gap-2">
                  <span className="mr-auto text-[11px]" style={{ color: "var(--text-muted)" }}>
                    Les fils restent dans la boîte, seul le label part.
                  </span>
                  <Button
                    size="sm"
                    isDisabled={checked.size === 0}
                    onPress={() => clear(a)}
                    style={{ backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }}
                  >
                    Retirer « {a.labelName} »{checked.size > 0 ? ` (${checked.size})` : ""}
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {agendas.length > MAX_SHOWN && (
        <span className="px-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
          + {agendas.length - MAX_SHOWN} autre{agendas.length - MAX_SHOWN > 1 ? "s" : ""} réunion{agendas.length - MAX_SHOWN > 1 ? "s" : ""} avec des fils étiquetés
        </span>
      )}
      {undo && (
        <div className="flex items-center gap-2 px-2 text-xs" role="status" style={{ color: "var(--text-secondary)" }}>
          <span className="min-w-0 flex-1 truncate">
            « {undo.labelName} » retiré de {undo.ids.length} fil{undo.ids.length > 1 ? "s" : ""}
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 min-h-8 px-2 text-xs"
            onPress={() => {
              onSetLabel?.(undo.ids, undo.labelId, true);
              window.clearTimeout(undoTimer.current);
              setUndo(null);
            }}
          >
            Annuler
          </Button>
        </div>
      )}
    </section>
  );
}

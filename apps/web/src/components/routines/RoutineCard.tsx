"use client";

import { Calendar, Lightning, Alarm, WebhooksLogo, PencilSimple, Play, Power, Trash } from "@phosphor-icons/react";
import Link from "next/link";
import type { RoutineFixture } from "./fixtures";
import { formatNextRun, formatRunDate } from "./fixtures";
import { TriggerChip } from "./TriggerChip";
import { RunStatusPill } from "./RunStatusPill";

interface RoutineCardProps {
  routine: RoutineFixture;
  onToggleEnabled: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onRun: (id: string) => void;
}

const TRIGGER_ICON: Record<string, React.ElementType> = {
  cron: Calendar,
  event: Lightning,
  alarm: Alarm,
  webhook: WebhooksLogo,
};

export function RoutineCard({ routine, onToggleEnabled, onDelete, onRun }: RoutineCardProps) {
  const Icon = TRIGGER_ICON[routine.trigger.type] ?? Lightning;
  const nextRun = formatNextRun(routine.nextRunAt);

  return (
    <div
      className="rounded-xl border p-4 transition-shadow hover:shadow-sm"
      style={{
        backgroundColor: "var(--surface-1)",
        borderColor: routine.enabled ? "var(--border-subtle)" : "var(--border-subtle)",
        opacity: routine.enabled ? 1 : 0.65,
      }}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: "var(--accent-subtle)" }}
        >
          <Icon size={18} style={{ color: "var(--accent)" }} />
        </div>

        {/* Main info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3
              className="truncate text-sm font-semibold"
              style={{ color: "var(--text-primary)" }}
            >
              {routine.name}
            </h3>
            <TriggerChip type={routine.trigger.type} />
            {!routine.enabled && (
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
              >
                Inactive
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs" style={{ color: "var(--text-muted)" }}>
            {routine.description}
          </p>

          {/* Stats row */}
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--text-muted)" }}>Prochain run :</span>{" "}
              {routine.enabled ? nextRun : "—"}
            </span>
            {routine.lastRun && (
              <span className="flex items-center gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                <span style={{ color: "var(--text-muted)" }}>Dernier :</span>
                <RunStatusPill status={routine.lastRun.status} />
                <span style={{ color: "var(--text-muted)" }}>
                  {formatRunDate(routine.lastRun.startedAt)}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Toggle switch */}
        <label className="flex flex-shrink-0 cursor-pointer items-center gap-1.5">
          <div className="relative">
            <input
              type="checkbox"
              className="sr-only"
              checked={routine.enabled}
              onChange={(e) => onToggleEnabled(routine.id, e.target.checked)}
            />
            <div
              className="h-5 w-9 rounded-full transition-colors"
              style={{
                backgroundColor: routine.enabled ? "var(--accent)" : "var(--surface-3)",
              }}
            />
            <div
              className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform"
              style={{ left: routine.enabled ? "calc(100% - 18px)" : "2px" }}
            />
          </div>
        </label>
      </div>

      {/* Actions bar */}
      <div
        className="mt-3 flex items-center gap-1 border-t pt-3"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <Link
          href={`/routines/${routine.id}`}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-secondary)" }}
        >
          <PencilSimple size={13} />
          Modifier
        </Link>
        <button
          onClick={() => onRun(routine.id)}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-secondary)" }}
        >
          <Play size={13} />
          Lancer
        </button>
        <button
          onClick={() => onToggleEnabled(routine.id, !routine.enabled)}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-secondary)" }}
        >
          <Power size={13} />
          {routine.enabled ? "Désactiver" : "Activer"}
        </button>
        <div className="flex-1" />
        <button
          onClick={() => onDelete(routine.id)}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-[oklch(0.93_0.10_28_/_0.15)]"
          style={{ color: "var(--danger)" }}
        >
          <Trash size={13} />
          Supprimer
        </button>
      </div>
    </div>
  );
}

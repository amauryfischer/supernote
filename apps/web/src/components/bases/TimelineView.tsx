"use client";

/**
 * TimelineView — frise chronologique horizontale type Gantt simple.
 *
 * Phase MVP : un champ "start" obligatoire (date / datetime), un champ "end"
 * facultatif. Si end absent, on dessine une barre d'un jour. Pas de zoom
 * configurable — auto-fit horizontalement sur la plage observée.
 */

import { useMemo } from "react";
import type { EntityType, Field } from "@supernote/core";
import type { TimelineConfig, View } from "@supernote/ipc";
import { NativeSelect } from "@/components/settings/NativeSelect";
import { useEntitiesForView, useViewMutations, resolveVisibleFieldIds } from "./hooks";

interface TimelineViewProps {
  base: EntityType;
  view: View;
}

interface BarPoint {
  id: string;
  label: string;
  startTs: number;
  endTs: number;
}

export function TimelineView({ base, view }: TimelineViewProps) {
  const { data, isLoading } = useEntitiesForView(base.id, view.filters, view.sorts);
  const { update: updateView } = useViewMutations();
  const items = data?.items ?? [];

  const dateFields = useMemo<Field[]>(
    () =>
      base.fields.filter((f) =>
        ["date", "datetime", "createdAt", "updatedAt"].includes(f.kind),
      ),
    [base.fields],
  );

  const cfg: TimelineConfig = view.timelineConfig ?? {};
  const startField = cfg.startField ?? dateFields[0]?.id;
  const endField = cfg.endField;

  const setStart = (id: string) =>
    updateView.mutate({
      id: view.id,
      timelineConfig: { ...cfg, startField: id || undefined },
    });
  const setEnd = (id: string) =>
    updateView.mutate({
      id: view.id,
      timelineConfig: { ...cfg, endField: id || undefined },
    });

  const allIds = useMemo(() => base.fields.map((f) => f.id), [base.fields]);
  const visibleIds = useMemo(() => resolveVisibleFieldIds(view, allIds), [view, allIds]);
  const labelFieldId = visibleIds[0];

  const bars = useMemo<BarPoint[]>(() => {
    if (!startField) return [];
    const out: BarPoint[] = [];
    for (const e of items) {
      const sRaw = e.fields[startField];
      const eRaw = endField ? e.fields[endField] : undefined;
      const sTs = toTs(sRaw);
      if (sTs === null) continue;
      const eTs = toTs(eRaw) ?? sTs + 86_400_000;
      const label =
        (labelFieldId && (e.fields[labelFieldId] as string)) || "(sans titre)";
      out.push({ id: e.id, label, startTs: sTs, endTs: Math.max(eTs, sTs + 3_600_000) });
    }
    return out.sort((a, b) => a.startTs - b.startTs);
  }, [items, startField, endField, labelFieldId]);

  const range = useMemo(() => {
    if (bars.length === 0) return { min: 0, max: 1 };
    const min = Math.min(...bars.map((b) => b.startTs));
    const max = Math.max(...bars.map((b) => b.endTs));
    return { min, max: max === min ? min + 86_400_000 : max };
  }, [bars]);

  if (isLoading) {
    return <Placeholder label="Chargement…" />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Picker champs */}
      <div
        className="flex flex-wrap items-center gap-3 border-b px-3 py-2 text-xs"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <PickerSelect
          label="Début"
          value={startField ?? ""}
          options={[
            { value: "", label: "—" },
            ...dateFields.map((f) => ({ value: f.id, label: f.label || f.name })),
          ]}
          onChange={setStart}
        />
        <PickerSelect
          label="Fin"
          value={endField ?? ""}
          options={[
            { value: "", label: "(durée d'un jour)" },
            ...dateFields.map((f) => ({ value: f.id, label: f.label || f.name })),
          ]}
          onChange={setEnd}
        />
      </div>

      {/* Frise */}
      <div className="flex-1 overflow-auto p-3">
        {bars.length === 0 ? (
          <Placeholder label="Aucune entrée datée. Renseignez un champ de date." />
        ) : (
          <div className="flex flex-col gap-1">
            {bars.map((b) => {
              const left = ((b.startTs - range.min) / (range.max - range.min)) * 100;
              const width = Math.max(
                1.5,
                ((b.endTs - b.startTs) / (range.max - range.min)) * 100,
              );
              return (
                <div
                  key={b.id}
                  className="grid grid-cols-[180px_1fr] items-center gap-2 text-xs"
                >
                  <span className="truncate" style={{ color: "var(--text-secondary)" }}>
                    {b.label}
                  </span>
                  <div
                    className="relative h-6 rounded"
                    style={{ backgroundColor: "var(--surface-2)" }}
                  >
                    <div
                      className="absolute top-1 h-4 rounded"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: "var(--accent)",
                        opacity: 0.85,
                      }}
                      title={`${new Date(b.startTs).toLocaleDateString()} → ${new Date(b.endTs).toLocaleDateString()}`}
                    />
                  </div>
                </div>
              );
            })}
            <Ruler min={range.min} max={range.max} />
          </div>
        )}
      </div>
    </div>
  );
}

function toTs(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function Ruler({ min, max }: { min: number; max: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="mt-2 grid grid-cols-[180px_1fr] gap-2">
      <span />
      <div className="relative h-4 text-[10px]" style={{ color: "var(--text-muted)" }}>
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute"
            style={{ left: `${t * 100}%`, transform: "translateX(-50%)" }}
          >
            {new Date(min + (max - min) * t).toLocaleDateString()}
          </span>
        ))}
      </div>
    </div>
  );
}

function PickerSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
      <span>{label}</span>
      <NativeSelect value={value} onChange={onChange} options={options} />
    </label>
  );
}

function Placeholder({ label }: { label: string }) {
  return (
    <div
      className="flex h-full items-center justify-center text-xs"
      style={{ color: "var(--text-muted)" }}
    >
      {label}
    </div>
  );
}

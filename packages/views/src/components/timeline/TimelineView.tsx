import React, { useMemo } from "react";
import type { Entity } from "@supernote/core/types";
import type { ViewProps } from "../../types/index.js";
import { queryEntities } from "../../query/index.js";
import { formatFieldValue, getEntityLabel, groupEntities } from "../../utils/field.js";

interface TimelineItem {
  id: string;
  label: string;
  start: Date;
  end: Date;
  group: string;
  color?: string;
  entity: Entity;
}

interface TimelineGroup {
  key: string;
  items: TimelineItem[];
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function TimelineView<T extends Entity = Entity>({
  view,
  entities,
  schema,
  onEntityClick,
}: ViewProps<T>): React.JSX.Element {
  const dateField = view.dateField ?? schema.fields.find(
    (f) => f.kind === "date" || f.kind === "datetime"
  )?.id;
  const endDateField = view.endDateField ?? dateField;

  const processed = useMemo(
    () => queryEntities(entities, view.filters ?? [], view.sort ?? []),
    [entities, view.filters, view.sort]
  );

  const items = useMemo<TimelineItem[]>(() => {
    if (!dateField) return [];
    return processed.flatMap((entity) => {
      const startRaw = entity.fields[dateField];
      const endRaw = endDateField ? entity.fields[endDateField] : null;
      const start = toDate(startRaw);
      if (!start) return [];
      const end = toDate(endRaw) ?? new Date(start.getTime() + 86400000);
      const group = view.groupBy ? String(entity.fields[view.groupBy] ?? "default") : "default";
      return [{
        id: entity.id,
        label: getEntityLabel(entity, schema),
        start,
        end,
        group,
        entity,
      }];
    });
  }, [processed, dateField, endDateField, view.groupBy, schema]);

  const groups = useMemo<TimelineGroup[]>(() => {
    const map = new Map<string, TimelineItem[]>();
    for (const item of items) {
      const arr = map.get(item.group) ?? [];
      arr.push(item);
      map.set(item.group, arr);
    }
    return Array.from(map.entries()).map(([key, grpItems]) => ({ key, items: grpItems }));
  }, [items]);

  if (!dateField) {
    return (
      <div data-testid="timeline-view" style={{ padding: 24, color: "#64748b" }}>
        Configure a dateField in the view definition to use Timeline view.
      </div>
    );
  }

  const allDates = items.flatMap((i) => [i.start, i.end]);
  const minDate = allDates.length > 0 ? new Date(Math.min(...allDates.map((d) => d.getTime()))) : new Date();
  const maxDate = allDates.length > 0 ? new Date(Math.max(...allDates.map((d) => d.getTime()))) : new Date();
  const totalMs = Math.max(maxDate.getTime() - minDate.getTime(), 86400000);

  return (
    <div data-testid="timeline-view" style={{ padding: 16, overflowX: "auto" }}>
      <div style={{ minWidth: 800 }}>
        <TimelineHeader minDate={minDate} maxDate={maxDate} />
        {groups.map((group) => (
          <TimelineGroupRow
            key={group.key}
            group={group}
            minDate={minDate}
            totalMs={totalMs}
            onClick={onEntityClick as ((e: Entity) => void) | undefined}
          />
        ))}
        {items.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>
            No events to display.
          </div>
        )}
      </div>
    </div>
  );
}

function TimelineHeader({ minDate, maxDate }: { minDate: Date; maxDate: Date }): React.JSX.Element {
  const months: Date[] = [];
  const cur = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
  const end = new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 1);
  while (cur < end) {
    months.push(new Date(cur));
    cur.setMonth(cur.getMonth() + 1);
  }

  return (
    <div style={{ display: "flex", borderBottom: "2px solid #e2e8f0", paddingLeft: 120, marginBottom: 4 }}>
      {months.map((m) => (
        <div key={m.toISOString()} style={{ flex: 1, padding: "4px 8px", fontSize: 12, fontWeight: 600, color: "#475569" }}>
          {m.toLocaleString("default", { month: "short", year: "numeric" })}
        </div>
      ))}
    </div>
  );
}

interface TimelineGroupRowProps {
  group: TimelineGroup;
  minDate: Date;
  totalMs: number;
  onClick?: (e: Entity) => void;
}

function TimelineGroupRow({ group, minDate, totalMs, onClick }: TimelineGroupRowProps): React.JSX.Element {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 8, minHeight: 40 }}>
      <div style={{ width: 120, flexShrink: 0, fontWeight: 500, fontSize: 13, paddingRight: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {group.key === "default" ? "" : group.key}
      </div>
      <div style={{ flex: 1, position: "relative", height: 36, background: "#f8fafc", borderRadius: 4 }}>
        {group.items.map((item) => {
          const left = ((item.start.getTime() - minDate.getTime()) / totalMs) * 100;
          const width = Math.max(((item.end.getTime() - item.start.getTime()) / totalMs) * 100, 1);
          return (
            <div
              key={item.id}
              data-testid="timeline-item"
              title={`${item.label}: ${item.start.toLocaleDateString()} — ${item.end.toLocaleDateString()}`}
              onClick={() => onClick?.(item.entity)}
              style={{
                position: "absolute",
                left: `${left}%`,
                width: `${width}%`,
                height: "100%",
                background: "#3b82f6",
                borderRadius: 4,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                paddingLeft: 6,
                overflow: "hidden",
                fontSize: 12,
                color: "#fff",
                boxSizing: "border-box",
              }}
            >
              {item.label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

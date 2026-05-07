"use client";

import {
  Table,
  Kanban,
  Images,
  CalendarBlank,
  ChartBar,
  Graph,
} from "@phosphor-icons/react";
import type { ViewKind } from "@supernote/views";

interface KindOption {
  value: ViewKind;
  label: string;
  icon: React.ElementType;
}

const KIND_OPTIONS: KindOption[] = [
  { value: "table", label: "Table", icon: Table },
  { value: "kanban", label: "Kanban", icon: Kanban },
  { value: "gallery", label: "Galerie", icon: Images },
  { value: "calendar", label: "Calendrier", icon: CalendarBlank },
  { value: "timeline", label: "Timeline", icon: ChartBar },
  { value: "graph", label: "Graphe", icon: Graph },
];

interface ViewKindPickerProps {
  value: ViewKind;
  onChange: (kind: ViewKind) => void;
}

export function ViewKindPicker({ value, onChange }: ViewKindPickerProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border p-1" style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}>
      {KIND_OPTIONS.map(({ value: kind, label, icon: Icon }) => {
        const isActive = value === kind;
        return (
          <button
            key={kind}
            onClick={() => onChange(kind)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all"
            style={{
              backgroundColor: isActive ? "var(--accent)" : "transparent",
              color: isActive ? "white" : "var(--text-secondary)",
            }}
            aria-pressed={isActive}
            title={label}
          >
            <Icon size={13} weight={isActive ? "bold" : "regular"} />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

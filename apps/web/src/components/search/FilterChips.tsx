"use client";

import { useState } from "react";
import { Plus, X, FunnelSimple } from "@phosphor-icons/react";
import { Button } from "@heroui/react";
import type { ActiveFilter, FilterKey } from "./types";

interface FilterChipsProps {
  filters: ActiveFilter[];
  onAdd: (filter: ActiveFilter) => void;
  onRemove: (index: number) => void;
}

const FILTER_PRESETS: Array<{ key: FilterKey; label: string; values: string[] }> = [
  { key: "type", label: "Type", values: ["note", "personne", "ressource", "journal"] },
  { key: "tag", label: "Tag", values: ["client", "urgent", "dev", "design", "IA", "archive"] },
  { key: "in", label: "Dossier", values: ["Inbox", "Notes", "Daily", "Contacts"] },
  { key: "relation", label: "Relation", values: ["mentionne", "lié-à", "parent-de"] },
  { key: "created", label: "Créé", values: [">2026-01-01", ">2026-04-01", ">2026-05-01"] },
];

const FILTER_COLORS: Record<FilterKey, { bg: string; text: string }> = {
  type:     { bg: "oklch(0.92 0.06 295)", text: "oklch(0.40 0.20 295)" },
  tag:      { bg: "oklch(0.92 0.06 200)", text: "oklch(0.40 0.18 200)" },
  in:       { bg: "oklch(0.92 0.04 140)", text: "oklch(0.40 0.14 140)" },
  relation: { bg: "oklch(0.93 0.06 60)",  text: "oklch(0.42 0.16 60)" },
  created:  { bg: "oklch(0.93 0.04 30)",  text: "oklch(0.42 0.12 30)" },
  modified: { bg: "oklch(0.93 0.04 30)",  text: "oklch(0.42 0.12 30)" },
};

export function FilterChips({ filters, onAdd, onRemove }: FilterChipsProps) {
  const [pickerKey, setPickerKey] = useState<FilterKey | null>(null);

  const handlePickerSelect = (key: FilterKey, value: string) => {
    onAdd({ key, value });
    setPickerKey(null);
  };

  const preset = FILTER_PRESETS.find((p) => p.key === pickerKey);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FunnelSimple size={14} style={{ color: "var(--text-muted)" }} />

      {filters.map((f, i) => {
        const colors = FILTER_COLORS[f.key];
        return (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ backgroundColor: colors.bg, color: colors.text }}
          >
            <span className="opacity-70">{f.key}:</span>
            <span>{f.value}</span>
            <Button
              isIconOnly
              variant="ghost"
              size="sm"
              onPress={() => onRemove(i)}
              className="ml-0.5 h-auto min-h-0 min-w-0 p-0 hover:opacity-70"
            >
              <X size={10} />
            </Button>
          </span>
        );
      })}

      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          onPress={() => setPickerKey((k) => (k ? null : "type"))}
          className="rounded-full px-2.5 py-0.5 text-xs"
          style={{ borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}
        >
          <Plus size={10} />
          Filtre
        </Button>

        {pickerKey === null && false && null}

        {pickerKey !== null && (
          <div
            className="absolute left-0 top-7 z-50 min-w-48 rounded-xl border p-2 shadow-lg"
            style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border-subtle)" }}
          >
            {pickerKey === "type" ? (
              <>
                <div className="mb-1 flex gap-1">
                  {FILTER_PRESETS.map((p) => (
                    <Button
                      key={p.key}
                      variant="ghost"
                      size="sm"
                      onPress={() => setPickerKey(p.key)}
                      className="rounded px-2 py-0.5 text-xs"
                      style={
                        pickerKey === p.key
                          ? { backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }
                          : { color: "var(--text-secondary)" }
                      }
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
                <div className="mt-2 flex flex-col gap-0.5">
                  {/* eslint-disable-next-line @typescript-eslint/no-non-null-assertion */}
                  {FILTER_PRESETS[0]!.values.map((v) => (
                    <Button
                      key={v}
                      variant="ghost"
                      size="sm"
                      onPress={() => handlePickerSelect("type", v)}
                      className="w-full justify-start rounded px-2 py-1 text-xs"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {v}
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="mb-1 flex flex-wrap gap-1">
                  {FILTER_PRESETS.map((p) => (
                    <Button
                      key={p.key}
                      variant="ghost"
                      size="sm"
                      onPress={() => setPickerKey(p.key)}
                      className="rounded px-2 py-0.5 text-xs"
                      style={
                        pickerKey === p.key
                          ? { backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }
                          : { color: "var(--text-secondary)" }
                      }
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
                <div className="mt-2 flex flex-col gap-0.5">
                  {preset?.values.map((v) => (
                    <Button
                      key={v}
                      variant="ghost"
                      size="sm"
                      onPress={() => handlePickerSelect(pickerKey, v)}
                      className="w-full justify-start rounded px-2 py-1 text-xs"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {v}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

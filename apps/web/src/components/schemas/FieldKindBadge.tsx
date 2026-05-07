"use client";

import type { FieldKind } from "@supernote/core";
import { FIELD_KINDS } from "./fixtures";
import { getIcon } from "./icon-map";

interface FieldKindBadgeProps {
  kind: FieldKind;
}

const KIND_COLORS: Record<string, string> = {
  text: "#6366F1", longtext: "#6366F1", markdown: "#6366F1",
  url: "#6366F1", email: "#6366F1", phone: "#6366F1", color: "#6366F1",
  number: "#0EA5E9", currency: "#0EA5E9", percent: "#0EA5E9",
  rating: "#0EA5E9", progress: "#0EA5E9", duration: "#0EA5E9",
  date: "#10B981", datetime: "#10B981",
  bool: "#F59E0B", select: "#F59E0B", multiselect: "#F59E0B", status: "#F59E0B",
  file: "#8B5CF6", image: "#8B5CF6",
  formula: "#EC4899", rollup: "#EC4899", lookup: "#EC4899",
  relation: "#F97316",
  createdAt: "#94A3B8", updatedAt: "#94A3B8", createdBy: "#94A3B8", autoNumber: "#94A3B8",
};

export function FieldKindBadge({ kind }: FieldKindBadgeProps) {
  const meta = FIELD_KINDS.find((k) => k.kind === kind);
  const label = meta?.label ?? kind;
  const iconName = meta?.icon ?? "Box";
  const Icon = getIcon(iconName);
  const color = KIND_COLORS[kind] ?? "#64748B";

  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: color + "18", color }}
    >
      <Icon size={10} />
      {label}
    </span>
  );
}

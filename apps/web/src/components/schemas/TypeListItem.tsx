"use client";

import { Button } from "@heroui/react";
import { EntityType } from "@supernote/core";
import { ENTITY_COUNTS } from "./fixtures";
import { getIcon } from "./icon-map";

interface TypeListItemProps {
  type: EntityType;
  selected: boolean;
  onSelect: () => void;
}

export function TypeListItem({ type, selected, onSelect }: TypeListItemProps) {
  const Icon = getIcon(type.icon ?? "Box");
  const count = ENTITY_COUNTS[type.id] ?? 0;

  return (
    <Button
      variant="ghost"
      onPress={onSelect}
      className="flex h-auto w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors"
      style={
        selected
          ? { backgroundColor: "var(--accent-subtle)", color: "var(--accent)" }
          : { color: "var(--text-secondary)" }
      }
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor: selected ? "var(--accent)" : (type.color ?? "#64748B") + "22",
          color: selected ? "var(--accent-foreground)" : (type.color ?? "#64748B"),
        }}
      >
        <Icon size={14} />
      </span>
      <span className="flex-1 text-sm font-medium" style={{ color: selected ? "var(--accent)" : "var(--text-primary)" }}>
        {type.name}
      </span>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {count}
      </span>
    </Button>
  );
}

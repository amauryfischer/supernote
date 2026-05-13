"use client";

/**
 * ViewTabs — horizontal tab strip listing every saved view of a Base.
 *
 * One tab per view. The active tab is highlighted; clicking a tab swaps the
 * grid. A trailing "+" button creates a fresh view (defaults to a table
 * named "Nouvelle vue").
 */

import { Plus } from "@phosphor-icons/react";
import type { View } from "@supernote/ipc";
import { ViewKindIcon } from "./ViewKindIcon";

interface ViewTabsProps {
  views: View[];
  activeViewId: string | undefined;
  onSelect: (viewId: string) => void;
  onCreate: () => void;
}

export function ViewTabs({ views, activeViewId, onSelect, onCreate }: ViewTabsProps) {
  return (
    <div
      className="flex items-center gap-1 overflow-x-auto border-b px-3 py-1.5"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      {views.map((v) => {
        const active = v.id === activeViewId;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v.id)}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            style={
              active
                ? { backgroundColor: "var(--surface-3)", color: "var(--text-primary)" }
                : { color: "var(--text-muted)" }
            }
          >
            <ViewKindIcon kind={v.kind} size={12} />
            <span>{v.name}</span>
          </button>
        );
      })}
      <button
        type="button"
        onClick={onCreate}
        className="ml-1 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
        style={{ color: "var(--text-muted)" }}
        title="Nouvelle vue"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

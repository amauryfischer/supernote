"use client";

/**
 * ViewTabs — horizontal tab strip listing every saved view of a Base.
 *
 * One tab per view. The active tab is highlighted; clicking a tab swaps the
 * grid. A small kebab (⋯) on the active tab opens ViewSettingsMenu. A
 * trailing "+" creates a fresh view.
 */

import { useState } from "react";
import { Button } from "@heroui/react";
import { Plus, DotsThree } from "@phosphor-icons/react";
import type { View } from "@supernote/ipc";
import { ViewKindIcon } from "./ViewKindIcon";
import { ViewSettingsMenu } from "./ViewSettingsMenu";

interface ViewTabsProps {
  views: View[];
  activeViewId: string | undefined;
  onSelect: (viewId: string) => void;
  onCreate: () => void;
}

export function ViewTabs({ views, activeViewId, onSelect, onCreate }: ViewTabsProps) {
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const activeView = views.find((v) => v.id === menuOpenFor);
  return (
    <div
      className="flex items-center gap-0.5 overflow-x-auto border-b px-4 py-2"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      {views.map((v) => {
        const active = v.id === activeViewId;
        return (
          <div key={v.id} className="relative flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="sm"
              onPress={() => onSelect(v.id)}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors"
              style={
                active
                  ? { backgroundColor: "var(--surface-2)", color: "var(--text-primary)" }
                  : { color: "var(--text-muted)" }
              }
            >
              <ViewKindIcon kind={v.kind} size={13} />
              <span>{v.name}</span>
            </Button>
            {active && (
              <Button
                variant="ghost"
                size="sm"
                onPress={(e) => {
                  setMenuOpenFor((cur) => (cur === v.id ? null : v.id));
                }}
                className="ml-0.5 rounded p-1 hover:bg-[var(--surface-2)]"
                style={{ color: "var(--text-muted)" }}
                aria-label="Options de la vue"
              >
                <DotsThree size={12} weight="bold" />
              </Button>
            )}
            {menuOpenFor === v.id && activeView && (
              <ViewSettingsMenu
                view={activeView}
                onClose={() => setMenuOpenFor(null)}
                onDeleted={() => {
                  // Caller's onSelect will switch to a fallback once the list
                  // refetches; we just close the menu.
                  setMenuOpenFor(null);
                }}
                onDuplicated={(newId) => {
                  onSelect(newId);
                  setMenuOpenFor(null);
                }}
              />
            )}
          </div>
        );
      })}
      <Button
        variant="ghost"
        size="sm"
        onPress={onCreate}
        className="ml-1 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
        style={{ color: "var(--text-muted)" }}
        aria-label="Nouvelle vue"
      >
        <Plus size={12} />
      </Button>
    </div>
  );
}

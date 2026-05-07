"use client";

import { Plus } from "@phosphor-icons/react";
import type { Template } from "@supernote/templates";

interface TemplateListProps {
  templates: Template[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

const ICON_MAP: Record<string, string> = {
  "book-open": "📖",
  "users": "👥",
  "chef-hat": "🍳",
  "briefcase": "💼",
};

export function TemplateList({ templates, selectedId, onSelect, onNew }: TemplateListProps) {
  return (
    <aside
      className="flex flex-col border-r"
      style={{
        width: 260,
        minWidth: 260,
        backgroundColor: "var(--surface-1)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Templates
        </span>
        <button
          onClick={onNew}
          aria-label="Nouveau template"
          className="flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-muted)" }}
        >
          <Plus size={14} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {templates.map((t) => {
          const isActive = t.id === selectedId;
          const emoji = t.icon ? (ICON_MAP[t.icon] ?? "📄") : "📄";
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className="flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left transition-colors"
              style={{
                backgroundColor: isActive ? "var(--accent-subtle)" : undefined,
                color: isActive ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              <span className="mt-0.5 text-sm">{emoji}</span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium" style={{ color: isActive ? "var(--accent)" : "var(--text-primary)" }}>
                  {t.name}
                </p>
                {t.description && (
                  <p className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {t.description}
                  </p>
                )}
              </div>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

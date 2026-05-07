"use client";

import { Plus, Trash } from "@phosphor-icons/react";
import type { Template } from "@supernote/templates";

interface TemplateListProps {
  templates: Template[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** If provided, shows a delete button on each item. */
  onDelete?: (id: string) => void;
}

const ICON_MAP: Record<string, string> = {
  "book-open": "📖",
  "users": "👥",
  "chef-hat": "🍳",
  "briefcase": "💼",
};

export function TemplateList({ templates, selectedId, onSelect, onNew, onDelete }: TemplateListProps) {
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
        {templates.length === 0 && (
          <p className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
            Aucun template
          </p>
        )}
        {templates.map((t) => {
          const isActive = t.id === selectedId;
          const emoji = t.icon ? (ICON_MAP[t.icon] ?? "📄") : "📄";
          return (
            <div key={t.id} className="group relative">
              <button
                onClick={() => onSelect(t.id)}
                className="flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left transition-colors pr-8"
                style={{
                  backgroundColor: isActive ? "var(--accent-subtle)" : undefined,
                  color: isActive ? "var(--accent)" : "var(--text-secondary)",
                }}
              >
                <span className="mt-0.5 text-sm">{emoji}</span>
                <div className="min-w-0">
                  <p
                    className="truncate text-sm font-medium"
                    style={{ color: isActive ? "var(--accent)" : "var(--text-primary)" }}
                  >
                    {t.name}
                  </p>
                  {t.description && (
                    <p className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {t.description}
                    </p>
                  )}
                </div>
              </button>

              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(t.id);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-[oklch(0.93_0.10_28_/_0.15)]"
                  style={{ color: "var(--danger)" }}
                  aria-label="Supprimer le template"
                >
                  <Trash size={12} />
                </button>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

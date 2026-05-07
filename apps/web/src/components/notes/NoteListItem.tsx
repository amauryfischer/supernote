"use client";

import { Trash } from "@phosphor-icons/react";
import { useState } from "react";
import { formatRelativeDate, type Note } from "./fixtures";
import { useTranslations } from "next-intl";

interface NoteListItemProps {
  note: Note;
  isActive: boolean;
  onClick: () => void;
  onDelete?: () => void;
}

export function NoteListItem({ note, isActive, onClick, onDelete }: NoteListItemProps) {
  const [hovered, setHovered] = useState(false);
  const t = useTranslations("notes");
  const preview = note.body.split("\n").slice(0, 2).join(" ").slice(0, 120);

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onClick}
        className="w-full text-left transition-colors focus-visible:outline-none"
        style={{
          borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
          backgroundColor: isActive
            ? "var(--accent-subtle)"
            : hovered
              ? "var(--surface-2)"
              : undefined,
        }}
      >
        <div className="px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <h3
              className="truncate text-sm font-medium leading-snug"
              style={{ color: "var(--text-primary)" }}
            >
              {note.title}
            </h3>
            <span
              className="flex-shrink-0 text-[11px]"
              style={{ color: "var(--text-muted)" }}
            >
              {formatRelativeDate(note.updatedAt)}
            </span>
          </div>

          {preview && (
            <p
              className="mt-1 line-clamp-2 text-xs leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              {preview}
            </p>
          )}

          {note.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {note.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor: "var(--surface-3)",
                    color: "var(--text-muted)",
                  }}
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div
          className="mx-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        />
      </button>

      {onDelete && hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={t("deleteNote")}
          className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-3)]"
          style={{ color: "var(--text-muted)" }}
        >
          <Trash size={13} />
        </button>
      )}
    </div>
  );
}

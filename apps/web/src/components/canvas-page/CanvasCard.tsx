"use client";

import { SquaresFour, Clock } from "@phosphor-icons/react";
import type { CanvasMeta } from "./fixtures";
import { useDateFormat } from "@/lib/dateFormat";

interface CanvasCardProps {
  canvas: CanvasMeta;
  onClick: (id: string) => void;
}

function buildRelativeOrCalendar(isoDate: string, compact: (s: string) => string): string {
  const date = new Date(isoDate);
  const now = new Date();
  // Floor at 0: a freshly written timestamp slightly in the future
  // (clock skew) would otherwise render "Il y a -1j".
  const diffDays = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
  if (diffDays === 0) return "Aujourd'hui";
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) return `Il y a ${diffDays}j`;
  // Older than a week → fall back to the user's preferred compact pattern.
  return compact(isoDate);
}

export function CanvasCard({ canvas, onClick }: CanvasCardProps) {
  const { compact } = useDateFormat();
  return (
    <button
      onClick={() => onClick(canvas.id)}
      className="group flex flex-col rounded-xl border text-left transition-shadow hover:shadow-md"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      {/* Thumbnail placeholder */}
      <div
        className="flex h-36 w-full items-center justify-center rounded-t-xl"
        style={{ backgroundColor: "var(--surface-2)" }}
      >
        <SquaresFour
          size={40}
          style={{ color: "var(--text-muted)", opacity: 0.5 }}
        />
      </div>

      {/* Card body */}
      <div className="flex flex-col gap-2 p-3">
        <p
          className="truncate text-sm font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {canvas.title}
        </p>

        <div className="flex items-center justify-between">
          <div className="flex flex-wrap gap-1">
            {canvas.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="rounded-full px-2 py-0.5 text-xs"
                style={{
                  backgroundColor: "var(--surface-3)",
                  color: "var(--text-muted)",
                }}
              >
                {tag}
              </span>
            ))}
          </div>

          <div
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            <Clock size={11} />
            {buildRelativeOrCalendar(canvas.updatedAt, compact)}
          </div>
        </div>

        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {canvas.nodeCount} noeuds · {canvas.edgeCount} liens
        </p>
      </div>
    </button>
  );
}

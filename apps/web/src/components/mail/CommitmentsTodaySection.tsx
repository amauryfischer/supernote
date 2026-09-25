"use client";

import { useNavigate } from "react-router-dom";
import { useSettings } from "@/components/settings/SettingsContext";
import type { Commitment, ThreadCommitments } from "@/lib/mail-commitments";
import { useMailCommitments } from "./useMailCommitments";

const HORIZON_DAYS = 2;

interface Line {
  c: Commitment;
  tc: ThreadCommitments;
}

const OVERDUE_DAYS = 7;

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Un « Je dois » accepté vit dans /todos (qui sait s'il est fait) : ici, seulement les suggestions et les relances récentes.
function relevant(c: Commitment, from: string, to: string): boolean {
  if (c.status === "suggested") return true;
  return c.status === "accepted" && c.direction === "eux" && c.due !== null && c.due >= from && c.due <= to;
}

/** Engagements du moment : suggestions en attente et échéances proches, groupés par sens. */
export function CommitmentsTodaySection() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { all } = useMailCommitments();
  const from = dayOffset(-OVERDUE_DAYS);
  const limit = dayOffset(HORIZON_DAYS);
  const today = dayOffset(0);
  const lines: Line[] = all
    .filter((tc) => tc.accountId === settings.gmail.connectedEmail)
    .flatMap((tc) => tc.items.filter((c) => relevant(c, from, limit)).map((c) => ({ c, tc })))
    .sort((a, b) => (a.c.due ?? "9999").localeCompare(b.c.due ?? "9999"));
  if (lines.length === 0) return null;

  const group = (dir: Commitment["direction"], title: string) => {
    const rows = lines.filter((l) => l.c.direction === dir);
    if (rows.length === 0) return null;
    return (
      <div className="flex flex-col gap-0.5">
        <span className="sn-eyebrow sn-eyebrow--compact px-1">{title}</span>
        {rows.map(({ c, tc }) => (
          <button
            key={`${tc.threadId}:${c.key}`}
            type="button"
            onClick={() => navigate(`/mail?thread=${encodeURIComponent(tc.threadId)}`)}
            className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left outline-none transition-colors hover:bg-[var(--nav-hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            <span className="min-w-0 flex-1 truncate text-sm" style={{ color: "var(--text-primary)" }}>
              {c.text}
            </span>
            <span
              className="shrink-0 text-[11px] tabular-nums"
              style={{ color: c.due && c.due < today ? "var(--danger, #c0392b)" : "var(--text-muted)" }}
            >
              {c.status === "suggested" ? "à valider" : c.due}
            </span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2 border-t px-3 py-3" style={{ borderColor: "var(--border-subtle)" }}>
      {group("moi", "Je dois")}
      {group("eux", "On me doit")}
    </div>
  );
}

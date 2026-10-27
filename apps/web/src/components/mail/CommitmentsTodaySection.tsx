"use client";

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@supernote/ui";
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

function dueLabel(due: string, today: string): string {
  const days = Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000);
  if (Number.isNaN(days)) return due;
  if (days === 0) return "auj.";
  if (days === 1) return "demain";
  if (days < 0) return `−${-days} j`;
  return `J+${days}`;
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
  const [showLater, setShowLater] = useState(false);
  const soon = dayOffset(7);
  const from = dayOffset(-OVERDUE_DAYS);
  const limit = dayOffset(HORIZON_DAYS);
  const today = dayOffset(0);
  const lines: Line[] = all
    .filter((tc) => tc.accountId === settings.gmail.connectedEmail)
    .flatMap((tc) => tc.items.filter((c) => relevant(c, from, limit)).map((c) => ({ c, tc })))
    .filter((l, i, arr) => arr.findIndex((o) => o.c.text === l.c.text && o.tc.threadId === l.tc.threadId) === i)
    // Le retard le plus ancien d'abord, puis les échéances, puis le sans-date.
    .sort((a, b) => (a.c.due ?? "9999").localeCompare(b.c.due ?? "9999"));
  if (lines.length === 0) return null;

  const group = (dir: Commitment["direction"], title: string) => {
    const all = lines.filter((l) => l.c.direction === dir);
    if (all.length === 0) return null;
    // Une semaine d'horizon ; le lointain et le sans-date attendent derrière « plus tard ».
    const later = all.filter((l) => (l.c.due ? l.c.due > soon : l.c.status !== "suggested"));
    const rows = showLater ? all : all.filter((l) => !later.includes(l));
    return (
      <div className="flex flex-col gap-0.5">
        <span className="sn-eyebrow sn-eyebrow--compact flex items-baseline gap-1.5 px-1">
          {title}
          <span className="font-mono tabular-nums">{all.length}</span>
        </span>
        {rows.map(({ c, tc }) => (
          <button
            key={`${tc.threadId}:${c.key}`}
            type="button"
            onClick={() =>
              navigate(`/mail?thread=${encodeURIComponent(tc.threadId)}${c.due && c.due < today ? "&engagements=1" : ""}`)
            }
            className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left outline-none transition-colors hover:bg-[var(--nav-hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
          >
            <span
              aria-label={c.status === "suggested" ? "Suggestion à valider" : undefined}
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={
                c.status === "suggested"
                  ? { boxShadow: "inset 0 0 0 1px var(--text-muted)" }
                  : { background: "var(--text-secondary)" }
              }
            />
            <span className="min-w-0 flex-1 truncate text-[13px]" style={{ color: "var(--text-primary)" }} title={`${c.text} — ${tc.subject}`}>
              {c.text}
            </span>
            <span className="max-w-[9rem] shrink-0 truncate text-[12px]" style={{ color: "var(--text-muted)" }}>
              {c.who}
            </span>
            {c.direction === "eux" && c.due && c.due < today && (
              <span className="shrink-0 font-mono text-[11px]" style={{ color: "var(--text-secondary)" }}>
                relancer ›
              </span>
            )}
            {c.due && (
              <span
                className="shrink-0 font-mono text-[11px] tabular-nums"
                title={c.due}
                style={{
                  color: c.due < today ? "var(--danger, #c0392b)" : c.due === today ? "var(--text-primary)" : "var(--text-muted)",
                  fontWeight: c.due <= dayOffset(1) ? 600 : undefined,
                }}
              >
                {dueLabel(c.due, today)}
              </span>
            )}
          </button>
        ))}
        {later.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 min-h-7 justify-start px-2 font-mono text-[11px]"
            style={{ color: "var(--text-muted)" }}
            onPress={() => setShowLater((v) => !v)}
          >
            {showLater ? "masquer plus tard" : `plus tard · ${later.length}`}
          </Button>
        )}
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

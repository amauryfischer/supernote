"use client";

import { Clock, GitBranch, Sparkles, X } from "lucide-react";
import { useShellChrome } from "./shell-chrome-context";

interface RecentItem {
  label: string;
  time: string;
}

const RECENT_ITEMS: RecentItem[] = [
  { label: "Jean Dupont — Réunion Q2", time: "il y a 2 min" },
  { label: "Projet Falcon — Brief", time: "il y a 1 h" },
  { label: "Daily 2026-05-07", time: "ce matin" },
];

export function RightPanel() {
  const { setRightPanelVisible } = useShellChrome();
  return (
    <aside
      className="flex h-full flex-col border-l"
      style={{
        width: "var(--panel-width)",
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-4"
        style={{ height: "var(--header-height)" }}
      >
        <span
          className="text-xs font-medium uppercase tracking-widest"
          style={{ color: "var(--text-muted)" }}
        >
          Contexte
        </span>
        <button
          onClick={() => setRightPanelVisible(false)}
          aria-label="Fermer le panneau"
          className="flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-muted)" }}
        >
          <X size={13} />
        </button>
      </div>

      <div
        className="border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      />

      {/* Recent */}
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center gap-1.5 px-1 pb-2">
          <Clock size={12} className="text-[var(--text-muted)]" />
          <span
            className="text-xs font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            Récent
          </span>
        </div>
        {RECENT_ITEMS.map((item) => (
          <button
            key={item.label}
            className="group flex flex-col rounded-md px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-2)]"
          >
            <span
              className="text-xs font-medium leading-snug"
              style={{ color: "var(--text-primary)" }}
            >
              {item.label}
            </span>
            <span
              className="mt-0.5 text-[11px]"
              style={{ color: "var(--text-muted)" }}
            >
              {item.time}
            </span>
          </button>
        ))}
      </div>

      <div
        className="border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      />

      {/* AI / Suggestions */}
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center gap-1.5 px-1 pb-2">
          <Sparkles size={12} className="text-[var(--accent)]" />
          <span
            className="text-xs font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            Suggestions IA
          </span>
        </div>
        <p
          className="rounded-md px-3 py-2.5 text-xs leading-relaxed"
          style={{
            color: "var(--text-muted)",
            backgroundColor: "var(--surface-2)",
          }}
        >
          Ouvre un fichier ou lance une recherche pour voir des suggestions
          contextuelles.
        </p>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Git status footer */}
      <div
        className="border-t p-3"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-1.5 px-1">
          <GitBranch size={11} className="text-[var(--text-muted)]" />
          <span
            className="text-[11px]"
            style={{ color: "var(--text-muted)" }}
          >
            vault · aucun changement
          </span>
        </div>
      </div>
    </aside>
  );
}

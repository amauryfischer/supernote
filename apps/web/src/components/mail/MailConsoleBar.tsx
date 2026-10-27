"use client";

import { useMemo } from "react";
import type { ThreadListItem } from "@/lib/gmail";
import { awaitsMyReply } from "@/lib/mail-awaiting";

const EMBER = "oklch(0.72 0.17 50)";

const KEYS: Array<[string, string]> = [
  ["j k", "naviguer"],
  ["↵", "ouvrir"],
  ["e", "fait"],
  ["h", "reporter"],
  ["?", "raccourcis"],
];

/**
 * Bandeau de tête de liste : compteurs et raccourcis. Tiré des fils déjà chargés :
 * aucun appel Gmail.
 */
export function MailConsoleBar({
  items,
  selfEmails,
  position,
  inline = false,
}: {
  /** Dans une barre existante : compteurs seuls, sans filet ni aide clavier. */
  inline?: boolean;
  items: readonly ThreadListItem[];
  selfEmails: readonly string[];
  /** Fil ouvert : sa place dans la liste affichée (rafale de tri). */
  position?: { index: number; total: number } | null;
}) {
  const { unread, waiting, today } = useMemo(() => {
    const now = new Date();
    let unread = 0;
    let waiting = 0;
    let today = 0;
    for (const it of items) {
      const isUnread = it.labelIds.includes("UNREAD");
      if (isUnread) unread++;
      if (awaitsMyReply(it, selfEmails)) waiting++;
      const d = new Date(it.date);
      if (Number.isNaN(d.getTime()) || d.toDateString() !== now.toDateString()) continue;
      today++;
    }
    return { unread, waiting, today };
  }, [items, selfEmails]);

  const stats: Array<[string, number, boolean]> = [
    ["à toi", waiting, waiting > 0],
    [unread > 1 ? "non lus" : "non lu", unread, false],
    ["auj.", today, false],
    ["fils", items.length, false],
  ];

  if (inline) {
    return (
      <div className="mr-2 flex shrink-0 items-baseline gap-3 font-mono text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
        {position && (
          <span style={{ color: "var(--text-secondary)" }} aria-label={`Fil ${position.index} sur ${position.total}`}>
            {position.index}/{position.total}
          </span>
        )}
        {stats.map(([label, value, hot]) => (
          <span key={label} className="flex items-baseline gap-1">
            <span className="text-[12.5px] font-medium" style={{ color: hot ? EMBER : "var(--text-secondary)" }}>
              {value}
            </span>
            <span className="text-[10px] uppercase tracking-[0.06em]">{label}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <div className="@container">
    <div
      className="mb-1 flex items-center gap-4 border-b px-2.5 pb-2 pt-1 font-mono text-[11px] tabular-nums"
      style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
    >
      <div className="flex min-w-0 shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        {stats.map(([label, value, hot]) => (
          <span key={label} className="flex items-baseline gap-1">
            <span
              className="text-[13px] font-medium"
              style={{ color: hot ? "oklch(0.72 0.17 50)" : value > 0 && label.startsWith("non lu") ? "var(--text-primary)" : "var(--text-secondary)" }}
            >
              {value}
            </span>
            <span className="uppercase tracking-[0.06em] text-[10px]">{label}</span>
          </span>
        ))}
      </div>

      <span className="flex-1" />
      {position && (
        <span className="shrink-0 text-[11px]" style={{ color: "var(--text-secondary)" }} aria-label={`Fil ${position.index} sur ${position.total}`}>
          {position.index}/{position.total}
        </span>
      )}

      <div className="hidden shrink-0 items-center gap-2.5 @2xl:flex" aria-label="Raccourcis clavier">
        {KEYS.map(([k, label]) => (
          <span key={k} className="flex items-center gap-1">
            <kbd
              className="rounded-[3px] border px-1 text-[10px] leading-4"
              style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
            >
              {k}
            </kbd>
            {label}
          </span>
        ))}
      </div>
    </div>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import type { ThreadListItem } from "@/lib/gmail";
import { awaitsMyReply } from "@/lib/mail-awaiting";

/** Valeur de console : libellé minuscule au-dessus, chiffre mono en grand. */
export function MailStat({
  label,
  value,
  hot = false,
  strong = false,
}: {
  label: string;
  value: string | number;
  /** Braise : la valeur réclame une action. */
  hot?: boolean;
  strong?: boolean;
}) {
  return (
    <span className="flex flex-col items-start gap-[3px] leading-none">
      <span className="font-mono text-[9px] uppercase leading-none tracking-[0.08em]" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span
        className="font-mono text-[15px] font-semibold leading-none tabular-nums"
        style={{ color: hot ? "var(--sn-ember-ink)" : strong ? "var(--text-primary)" : "var(--text-secondary)" }}
      >
        {value}
      </span>
    </span>
  );
}

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

  const values = stats.map(([label, value, hot]) => (
    <MailStat
      key={label}
      label={label}
      value={value}
      hot={hot}
      strong={value > 0 && label.startsWith("non lu")}
    />
  ));

  if (inline) {
    return (
      <div className="mr-2 flex shrink-0 items-end gap-4">
        {position && (
          <span
            className="font-mono text-[11px] tabular-nums"
            style={{ color: "var(--text-secondary)" }}
            aria-label={`Fil ${position.index} sur ${position.total}`}
          >
            {position.index}/{position.total}
          </span>
        )}
        {values}
      </div>
    );
  }

  return (
    <div className="@container">
    <div
      className="mb-1 flex items-end gap-4 border-b px-2.5 pb-2.5 pt-1.5 font-mono text-[11px] tabular-nums"
      style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
    >
      <div className="flex min-w-0 shrink-0 flex-wrap items-end gap-x-5 gap-y-2">{values}</div>

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

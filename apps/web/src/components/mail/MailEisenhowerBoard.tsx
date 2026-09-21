"use client";

/**
 * MailEisenhowerBoard — grille 2×2 des threads de l'inbox rangés dans un label
 * todo (cf. `mail-eisenhower`). Présentationnel : la page porte les mutations.
 */

import { Button } from "@heroui/react";
import { Envelope, Sparkle } from "@phosphor-icons/react";
import { QUADRANTS, type EisenhowerQuadrant } from "@/lib/mail-eisenhower";
import type { ThreadListItem } from "@/lib/gmail";

export interface MailTodoCard {
  item: ThreadListItem;
  quadrant: EisenhowerQuadrant;
}

export interface MailEisenhowerBoardProps {
  cards: MailTodoCard[];
  /** Mini-résumés IA de la liste, par threadId. */
  summaries?: ReadonlyMap<string, string>;
  onOpen: (threadId: string) => void;
}

/** Sous-titre d'aide par quadrant (axes urgence/importance lisibles). */
const QUADRANT_HINT: Record<EisenhowerQuadrant, string> = {
  do: "Urgent · important",
  schedule: "Important · non urgent",
  delegate: "Urgent · non important",
  eliminate: "Ni urgent ni important",
};

/** Teinte d'accent par quadrant (dérivée de tokens sémantiques, sans globals). */
const QUADRANT_ACCENT: Record<EisenhowerQuadrant, string> = {
  do: "var(--danger, #ef4444)",
  schedule: "var(--accent)",
  delegate: "var(--warning, #f5b300)",
  eliminate: "var(--text-muted)",
};

function TodoCard({
  card: { item },
  summary,
  onOpen,
}: {
  card: MailTodoCard;
  summary?: string;
  onOpen: (threadId: string) => void;
}) {
  return (
    <Button
      variant="ghost"
      onPress={() => onOpen(item.id)}
      aria-label={`Ouvrir : ${item.subject || "Email sans sujet"}`}
      className="h-auto w-full min-w-0 flex-col items-stretch justify-start gap-2 whitespace-normal rounded-lg border p-3 text-left"
      style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
    >
      <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
        <Envelope size={13} aria-hidden style={{ color: "var(--accent)" }} />
        <span className="truncate">{item.from.name || item.from.email || "Email"}</span>
      </span>
      <span
        className="line-clamp-2 break-words text-sm font-medium"
        style={{ color: "var(--text-primary)" }}
      >
        {item.subject || "Email sans sujet"}
      </span>
      {summary ? (
        <span className="flex flex-col gap-1">
          <span
            className="sn-eyebrow sn-eyebrow--compact flex items-center gap-1"
            style={{ color: "var(--accent)" }}
          >
            <Sparkle size={11} weight="fill" aria-hidden /> Résumé
          </span>
          <span className="line-clamp-4 break-words text-xs" style={{ color: "var(--text-secondary)" }}>
            {summary}
          </span>
        </span>
      ) : (
        item.snippet && (
          <span className="line-clamp-3 break-words text-xs" style={{ color: "var(--text-secondary)" }}>
            {item.snippet}
          </span>
        )
      )}
    </Button>
  );
}

export function MailEisenhowerBoard({
  cards,
  summaries,
  onOpen,
}: MailEisenhowerBoardProps) {
  const byQuadrant = new Map<EisenhowerQuadrant, MailTodoCard[]>();
  for (const q of QUADRANTS) byQuadrant.set(q.id, []);
  for (const c of cards) byQuadrant.get(c.quadrant)?.push(c);

  if (cards.length === 0) {
    return (
      <p className="px-3 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
        Aucun email à traiter. Range un email avec le bouton « Todo » de sa fiche, ou pose un
        label « Todo/… » depuis Gmail ou Shortwave.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-2 md:grid-cols-2">
      {QUADRANTS.map((q) => {
        const quadrantCards = byQuadrant.get(q.id) ?? [];
        return (
          <section
            key={q.id}
            className="flex flex-col gap-2 rounded-xl border p-3"
            style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
            aria-label={`Quadrant ${q.label}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span
                className="text-sm font-semibold"
                style={{ color: QUADRANT_ACCENT[q.id] }}
              >
                {q.label}
              </span>
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {QUADRANT_HINT[q.id]} · {quadrantCards.length}
              </span>
            </div>
            {quadrantCards.length === 0 ? (
              <p className="px-1 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                Vide
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {quadrantCards.map((c) => (
                  <TodoCard
                    key={c.item.id}
                    card={c}
                    summary={summaries?.get(c.item.id)}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

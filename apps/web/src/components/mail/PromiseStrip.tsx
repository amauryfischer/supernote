"use client";

/**
 * PromiseStrip — les promesses datées de la réponse en cours, sous la zone de
 * texte. Éteintes par défaut : « Suivre » en fait, à l'envoi, une tâche datée
 * liée au fil et un engagement « je dois ». La phrase affichée est celle qu'on
 * vient d'écrire, l'échéance celle qu'elle donne : rien n'est deviné.
 */

import { Handshake } from "@phosphor-icons/react";
import { Button, Tooltip } from "@supernote/ui";
import { dueLabel, type DraftPromise } from "@/lib/mail-parapheur";

export function PromiseStrip({
  promises,
  followed,
  onToggle,
}: {
  promises: readonly DraftPromise[];
  followed: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  if (promises.length === 0) return null;
  return (
    <ul aria-label="Promesses de la réponse" className="mt-1.5 flex flex-col gap-0.5">
      {promises.map((p) => {
        const on = followed.has(p.key);
        return (
          <li key={p.key} className="flex min-h-8 items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
            <Handshake size={14} weight={on ? "fill" : "regular"} aria-hidden style={on ? { color: "var(--text-primary)" } : undefined} />
            <span className="shrink-0 font-mono tabular-nums" style={{ color: on ? "var(--text-primary)" : "var(--text-secondary)" }}>
              {dueLabel(p.due)}
            </span>
            <span className="min-w-0 flex-1 truncate" title={p.quote}>
              « {p.quote} »
            </span>
            <Tooltip content={on ? "Ne plus suivre (⌥P)" : "À l'envoi : tâche datée liée au fil, rappel le jour dit (⌥P)"}>
              <Button
                size="sm"
                variant={on ? "secondary" : "ghost"}
                aria-pressed={on}
                aria-label={on ? `Ne plus suivre : ${p.quote}` : `Suivre la promesse : ${p.quote}`}
                className="h-8 min-h-8 shrink-0 px-2 text-xs md:h-7 md:min-h-7"
                onPress={() => onToggle(p.key)}
              >
                {on ? "Suivie" : "Suivre"}
              </Button>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

"use client";

/**
 * MailEisenhowerPicker — bouton « Todo » qui ouvre la matrice d'Eisenhower en
 * grille 2×2 ; `onConvert(quadrant)` laisse l'appelant poser le label Gmail.
 */

import { useEffect, useState } from "react";
import { Button, Popover } from "@heroui/react";
import { ListChecks, Sparkle } from "@phosphor-icons/react";
import { Tooltip } from "@supernote/ui";
import { QUADRANTS, type EisenhowerQuadrant } from "@/lib/mail-eisenhower";

export interface MailEisenhowerPickerProps {
  /** Choix d'un quadrant → l'appelant matérialise la tâche. */
  onConvert: (quadrant: EisenhowerQuadrant) => void;
  /** Verrouille le déclencheur pendant une conversion en cours. */
  isBusy?: boolean;
  /**
   * Quadrant suggéré par l'IA (best-effort). Quand il passe d'absent à présent,
   * le Popover s'ouvre automatiquement et la cellule correspondante est mise en
   * évidence (anneau + pastille « Suggéré ») — l'utilisateur garde le dernier
   * mot (il peut choisir un autre quadrant ou fermer). Optionnel : sans cette
   * prop le composant se comporte exactement comme avant.
   */
  suggestedQuadrant?: EisenhowerQuadrant | null;
  /** Quadrant où le fil est déjà rangé (label todo présent). */
  currentQuadrant?: EisenhowerQuadrant | null;
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

export function MailEisenhowerPicker({
  onConvert,
  isBusy = false,
  suggestedQuadrant = null,
  currentQuadrant = null,
}: MailEisenhowerPickerProps) {
  const current = QUADRANTS.find((q) => q.id === currentQuadrant);
  const [open, setOpen] = useState(false);

  // Suggestion IA reçue → ouvre le Popover sur la matrice (cellule suggérée mise
  // en évidence). On ne déclenche AUCUNE conversion : best-effort, non bloquant.
  useEffect(() => {
    if (suggestedQuadrant) setOpen(true);
  }, [suggestedQuadrant]);

  const pick = (quadrant: EisenhowerQuadrant) => {
    setOpen(false);
    onConvert(quadrant);
  };

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Tooltip content={current ? `Todo · ${current.label} (1–4)` : "Mettre en todo (1–4)"}>
        <Button
          variant="ghost"
          size="sm"
          isIconOnly
          isDisabled={isBusy}
          className="h-9"
          aria-label={
            current
              ? `Rangé dans « ${current.label} » : changer de quadrant`
              : "Mettre en todo (matrice d'Eisenhower)"
          }
        >
          <ListChecks
            size={18}
            weight={current ? "fill" : "regular"}
            style={current ? { color: QUADRANT_ACCENT[current.id] } : undefined}
            aria-hidden
          />
        </Button>
      </Tooltip>
      <Popover.Content className="w-72 p-2">
        <Popover.Dialog className="outline-none">
          <div className="mb-2 px-1">
            <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
              Mettre en todo
            </p>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Choisis un quadrant de la matrice.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1.5" aria-label="Quadrants d'Eisenhower">
            {QUADRANTS.map((q) => {
              const isSuggested = suggestedQuadrant === q.id;
              return (
                <Button
                  key={q.id}
                  variant="ghost"
                  onPress={() => pick(q.id)}
                  isDisabled={isBusy}
                  className="relative flex h-auto min-h-16 w-full flex-col items-start justify-start gap-0.5 rounded-lg border px-2.5 py-2 text-left"
                  style={{
                    borderColor: isSuggested ? QUADRANT_ACCENT[q.id] : "var(--border-subtle)",
                    backgroundColor: isSuggested
                      ? "var(--accent-subtle)"
                      : "var(--surface-1)",
                    boxShadow: isSuggested ? `0 0 0 1px ${QUADRANT_ACCENT[q.id]}` : undefined,
                  }}
                  aria-label={`${q.label} — ${QUADRANT_HINT[q.id]}${isSuggested ? " (suggéré par l'IA)" : ""}`}
                >
                  {isSuggested && (
                    <span
                      className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold"
                      style={{ backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg, #fff)" }}
                    >
                      <Sparkle size={9} weight="fill" aria-hidden /> Suggéré
                    </span>
                  )}
                  <span
                    className="text-sm font-semibold leading-tight"
                    style={{ color: QUADRANT_ACCENT[q.id] }}
                  >
                    {q.label}
                  </span>
                  <span
                    className="text-[11px] leading-tight"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {QUADRANT_HINT[q.id]}
                  </span>
                </Button>
              );
            })}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

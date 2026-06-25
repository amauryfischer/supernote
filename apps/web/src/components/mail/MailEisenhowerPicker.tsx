"use client";

/**
 * MailEisenhowerPicker — bouton « → Todo » qui ouvre un Popover présentant la
 * matrice d'Eisenhower en grille 2×2. Au choix d'un quadrant, déclenche
 * `onConvert(quadrant)` : l'appelant (EmailThreadView) crée la tâche, enregistre
 * la liaison thread ↔ todo et sort le fil de l'inbox.
 *
 * Le composant est purement présentational : il ne crée RIEN lui-même (pas de
 * réseau, pas de store). Il expose juste le choix du quadrant. La grille reprend
 * l'ordre canonique de `QUADRANTS` (do / schedule / delegate / eliminate) et les
 * deux axes (urgent / important) pour que l'utilisateur situe son choix d'un
 * coup d'œil, exactement comme la matrice de /todos.
 *
 * Mobile : déclencheur à hit-target tactile (h-9 ≈ 36px), libellé masqué sous
 * `sm` (icône seule) ; la grille du Popover reste lisible (cellules ~h-16,
 * min-w borné) sans débordement horizontal.
 */

import { useState } from "react";
import { Button, Popover } from "@heroui/react";
import { ListChecks } from "@phosphor-icons/react";
import { QUADRANTS, type EisenhowerQuadrant } from "@/lib/mail-eisenhower";

export interface MailEisenhowerPickerProps {
  /** Choix d'un quadrant → l'appelant matérialise la tâche. */
  onConvert: (quadrant: EisenhowerQuadrant) => void;
  /** Verrouille le déclencheur pendant une conversion en cours. */
  isBusy?: boolean;
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

export function MailEisenhowerPicker({ onConvert, isBusy = false }: MailEisenhowerPickerProps) {
  const [open, setOpen] = useState(false);

  const pick = (quadrant: EisenhowerQuadrant) => {
    setOpen(false);
    onConvert(quadrant);
  };

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        isDisabled={isBusy}
        className="h-9 gap-1.5"
        aria-label="Convertir cet email en tâche (matrice d'Eisenhower)"
      >
        <ListChecks size={18} aria-hidden />
        <span className="hidden sm:inline">Todo</span>
      </Button>
      <Popover.Content className="w-72 p-2">
        <Popover.Dialog className="outline-none">
          <div className="mb-2 px-1">
            <p className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
              Convertir en tâche
            </p>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Choisis un quadrant de la matrice.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-1.5" aria-label="Quadrants d'Eisenhower">
            {QUADRANTS.map((q) => (
              <Button
                key={q.id}
                variant="ghost"
                onPress={() => pick(q.id)}
                isDisabled={isBusy}
                className="flex h-auto min-h-16 w-full flex-col items-start justify-start gap-0.5 rounded-lg border px-2.5 py-2 text-left"
                style={{
                  borderColor: "var(--border-subtle)",
                  backgroundColor: "var(--surface-1)",
                }}
                aria-label={`${q.label} — ${QUADRANT_HINT[q.id]}`}
              >
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
            ))}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

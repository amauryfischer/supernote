"use client";

/**
 * MailEisenhowerBoard — grille 2×2 des emails convertis en tâches, classés par
 * quadrant d'Eisenhower. Source de vérité : les liaisons thread ↔ todo du store
 * local (`mail-todo-binding`), passées en props par la page mail.
 *
 * Chaque carte = sujet du fil + actions :
 *   - « Ouvrir »   → charge et affiche le thread dans le pane de droite.
 *   - « Fait »     → marque la tâche `done` (et retire la liaison) côté appelant.
 *   - « → quadrant » (Popover) → reclasse la carte dans un autre quadrant
 *                    (MAJ optimiste du store + des axes urgent/importance du todo).
 *
 * Purement présentational : aucune écriture (réseau / store) ici. Tout effet est
 * délégué via `onOpen` / `onDone` / `onMoveQuadrant`.
 *
 * Responsive : grille 2×2 dès `md:` (4 quadrants), empilée en 1 colonne sous
 * mobile. Hit-targets tactiles (boutons `size="sm"`, ~32px+), pas de débordement
 * horizontal (sujets tronqués / wrappés).
 */

import { useState } from "react";
import { Button, Popover } from "@heroui/react";
import { ArrowRight, CheckCircle, EnvelopeOpen, Envelope, Sparkle } from "@phosphor-icons/react";
import { QUADRANTS, type EisenhowerQuadrant } from "@/lib/mail-eisenhower";
import type { MailTodoBinding } from "@/lib/mail-todo-binding";

export interface MailEisenhowerBoardProps {
  /** Liaisons thread ↔ todo (toutes confondues) à répartir dans les quadrants. */
  bindings: MailTodoBinding[];
  /** Ouvrir le fil correspondant dans le pane de droite. */
  onOpen: (threadId: string) => void;
  /** Marquer la tâche faite (done) — l'appelant retire ensuite la carte. */
  onDone: (binding: MailTodoBinding) => void;
  /** Déplacer la tâche vers un autre quadrant. */
  onMoveQuadrant: (binding: MailTodoBinding, quadrant: EisenhowerQuadrant) => void;
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

/** Carte d'un email-todo : sujet + actions (ouvrir / fait / déplacer). */
function TodoCard({
  binding,
  onOpen,
  onDone,
  onMoveQuadrant,
}: {
  binding: MailTodoBinding;
  onOpen: (threadId: string) => void;
  onDone: (binding: MailTodoBinding) => void;
  onMoveQuadrant: (binding: MailTodoBinding, quadrant: EisenhowerQuadrant) => void;
}) {
  const [moveOpen, setMoveOpen] = useState(false);
  // Quadrants de destination : tous sauf celui où la carte se trouve déjà.
  const targets = QUADRANTS.filter((q) => q.id !== binding.quadrant);

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border p-3"
      style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-1)" }}
    >
      {/* En-tête « c'est un email » : icône + expéditeur → lève l'ambiguïté
          tâche/email. Aperçu compact (snippet) en dessous = vue « quelques lignes ». */}
      <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
        <Envelope size={13} aria-hidden style={{ color: "var(--accent)" }} />
        <span className="truncate">{binding.fromName || binding.fromEmail || "Email"}</span>
      </div>
      <p
        className="line-clamp-2 break-words text-sm font-medium"
        style={{ color: "var(--text-primary)" }}
      >
        {binding.subject || "Email sans sujet"}
      </p>
      {/* Aperçu compact : résumé IA si dispo (badge ✦), sinon snippet brut. */}
      {binding.summary ? (
        <div className="flex flex-col gap-1">
          <span
            className="sn-eyebrow sn-eyebrow--compact flex items-center gap-1"
            style={{ color: "var(--accent)" }}
          >
            <Sparkle size={11} weight="fill" aria-hidden /> Résumé
          </span>
          <p className="line-clamp-4 break-words text-xs" style={{ color: "var(--text-secondary)" }}>
            {binding.summary}
          </p>
        </div>
      ) : (
        binding.snippet && (
          <p className="line-clamp-3 break-words text-xs" style={{ color: "var(--text-secondary)" }}>
            {binding.snippet}
          </p>
        )
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="ghost"
          size="sm"
          onPress={() => onOpen(binding.threadId)}
          aria-label="Ouvrir le fil de cet email"
        >
          <EnvelopeOpen size={15} aria-hidden /> Ouvrir
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => onDone(binding)}
          aria-label="Marquer la tâche comme faite"
        >
          <CheckCircle size={15} aria-hidden /> Fait
        </Button>
        <Popover isOpen={moveOpen} onOpenChange={setMoveOpen}>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Déplacer vers un autre quadrant"
          >
            <ArrowRight size={15} aria-hidden /> Quadrant
          </Button>
          <Popover.Content className="w-56 p-2">
            <Popover.Dialog className="outline-none">
              <p
                className="mb-1.5 px-1 text-[11px] font-medium"
                style={{ color: "var(--text-muted)" }}
              >
                Déplacer vers
              </p>
              <div className="flex flex-col gap-1">
                {targets.map((q) => (
                  <Button
                    key={q.id}
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onPress={() => {
                      setMoveOpen(false);
                      onMoveQuadrant(binding, q.id);
                    }}
                    aria-label={`Déplacer vers ${q.label} (${QUADRANT_HINT[q.id]})`}
                  >
                    <span
                      className="text-sm font-semibold"
                      style={{ color: QUADRANT_ACCENT[q.id] }}
                    >
                      {q.label}
                    </span>
                    <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      {QUADRANT_HINT[q.id]}
                    </span>
                  </Button>
                ))}
              </div>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>
      </div>
    </div>
  );
}

export function MailEisenhowerBoard({
  bindings,
  onOpen,
  onDone,
  onMoveQuadrant,
}: MailEisenhowerBoardProps) {
  // Regroupe les liaisons par quadrant pour un rendu O(n) sans recalcul par case.
  const byQuadrant = new Map<EisenhowerQuadrant, MailTodoBinding[]>();
  for (const q of QUADRANTS) byQuadrant.set(q.id, []);
  for (const b of bindings) byQuadrant.get(b.quadrant)?.push(b);

  if (bindings.length === 0) {
    return (
      <p className="px-3 py-6 text-sm" style={{ color: "var(--text-muted)" }}>
        Aucune tâche email. Convertis un email en tâche depuis sa fiche (bouton « Todo »).
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-2 md:grid-cols-2">
      {QUADRANTS.map((q) => {
        const cards = byQuadrant.get(q.id) ?? [];
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
                {QUADRANT_HINT[q.id]} · {cards.length}
              </span>
            </div>
            {cards.length === 0 ? (
              <p className="px-1 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                Vide
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {cards.map((b) => (
                  <TodoCard
                    key={b.threadId}
                    binding={b}
                    onOpen={onOpen}
                    onDone={onDone}
                    onMoveQuadrant={onMoveQuadrant}
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

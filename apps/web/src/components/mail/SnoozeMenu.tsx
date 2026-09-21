"use client";

/**
 * SnoozeMenu — « Reporter à… » : barre de saisie façon palette (Shortwave).
 *
 * Une seule surface pour toutes les entrées du report : le raccourci `h`, le
 * bouton de la TriageBar, le menu contextuel, le bottom sheet mobile et
 * « Envoyer plus tard ». Le composant ne connaît pas le thread : il renvoie une
 * échéance (epoch ms) via `onPick`.
 */

import { useState } from "react";
import { Command } from "cmdk";
import { Button, Input } from "@heroui/react";
import { ModalRoot, ModalBackdrop, ModalContainer, ModalDialog } from "@supernote/ui";
import { Clock, Lightning } from "@phosphor-icons/react";
import { SNOOZE_PRESETS_FULL, parseSnoozeInput, type SnoozePreset } from "@/lib/mail-triage";

/** Formate une date locale pour un `<input type="datetime-local">`. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const WHEN = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const ITEM_CLASS =
  "sn-motion-colors flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-[var(--text-primary)] data-[selected=true]:bg-[var(--accent-subtle)] data-[selected=true]:text-[var(--accent)]";

export function SnoozeMenu({
  isOpen,
  onClose,
  onPick,
  /** Libellé du fil reporté (affiché à droite du champ). */
  subject,
  /** Titre de la fenêtre (réemployé par « Envoyer plus tard »). */
  title = "Reporter à…",
  /** Échéances proposées (défaut : les échéances de report). */
  presets = SNOOZE_PRESETS_FULL,
  /** Libellé du bouton de validation de la date libre. */
  confirmLabel = "Reporter",
}: {
  isOpen: boolean;
  onClose: () => void;
  onPick: (until: number) => void;
  subject?: string;
  title?: string;
  presets?: readonly SnoozePreset[];
  confirmLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 24, 0, 0, 0);
    return toLocalInputValue(d);
  });

  const close = () => {
    setQuery("");
    onClose();
  };
  const pick = (until: number) => {
    onPick(until);
    close();
  };

  const now = new Date();
  const parsed = parseSnoozeInput(query, now);
  const q = query.trim().toLowerCase();
  const shown = presets
    .map((p) => ({ ...p, until: p.computeUntil(now) }))
    .filter((p) => p.label.toLowerCase().includes(q) && p.until !== parsed);

  const customTs = Date.parse(custom);
  const customValid = Number.isFinite(customTs) && customTs > Date.now();

  return (
    <ModalRoot
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {/* Container imbriqué dans le Backdrop : cf. le piège documenté dans Modal.tsx. */}
      <ModalBackdrop
        isDismissable
        className="fixed inset-0 z-[var(--z-overlay)] bg-[var(--surface-0)]/60 backdrop-blur-sm"
      >
        {/* HeroUI met le container en flex-col centré : ne pas y ajouter items-/justify-, ça décentre. */}
        <ModalContainer
          placement="top"
          className="fixed inset-0 z-[var(--z-modal)] h-full w-full px-4 pt-[12vh]"
        >
          <ModalDialog
            aria-label={title}
            className="w-full max-w-[640px] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-subtle)] bg-[var(--surface-1)] p-0 outline-none [box-shadow:var(--shadow-xl)]"
          >
            <Command label={title} loop shouldFilter={false}>
              <div className="flex h-14 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
                <Clock size={18} aria-hidden className="shrink-0 text-[var(--text-muted)]" />
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder={`${title.replace(/…$/, "")} : 10d, 32h, ven 14h, à 9h…`}
                  className="min-w-0 flex-1 bg-transparent text-base text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                  autoFocus
                />
                {subject && (
                  <span className="hidden max-w-[40%] truncate text-xs text-[var(--text-muted)] sm:block">
                    {subject}
                  </span>
                )}
              </div>

              <Command.List className="max-h-[360px] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-6 text-center text-sm text-[var(--text-muted)]">
                  Pas compris « {query} ». Essaie 10d, 32h, 2w, ven 14h, à 9h30.
                </Command.Empty>
                {parsed !== null && (
                  <Command.Item
                    value="parsed"
                    onSelect={() => pick(parsed)}
                    // cmdk ne déclenche pas onSelect au tap mobile sans focus clavier préalable.
                    onClick={(e) => {
                      e.preventDefault();
                      pick(parsed);
                    }}
                    className={ITEM_CLASS}
                  >
                    <Lightning size={16} aria-hidden className="shrink-0" />
                    <span className="flex-1 font-medium first-letter:uppercase">
                      {WHEN.format(parsed)}
                    </span>
                    <kbd className="font-mono text-[11px] text-[var(--text-muted)]">↵</kbd>
                  </Command.Item>
                )}
                {shown.map((p) => (
                  <Command.Item
                    key={p.id}
                    value={p.id}
                    onSelect={() => pick(p.until)}
                    onClick={(e) => {
                      e.preventDefault();
                      pick(p.until);
                    }}
                    className={ITEM_CLASS}
                  >
                    <Clock size={16} aria-hidden className="shrink-0" />
                    <span className="flex-1">{p.label}</span>
                    <span className="text-xs text-[var(--text-muted)]">{WHEN.format(p.until)}</span>
                  </Command.Item>
                ))}
              </Command.List>
            </Command>

            {/* Hors de <Command> : sinon Entrée dans le champ date sélectionnerait l'item actif. */}
            <div className="flex items-center gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
              <Input
                type="datetime-local"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="flex-1"
                aria-label="Date et heure précises"
              />
              <Button
                variant="primary"
                size="sm"
                isDisabled={!customValid}
                onPress={() => pick(customTs)}
              >
                {confirmLabel}
              </Button>
            </div>
          </ModalDialog>
        </ModalContainer>
      </ModalBackdrop>
    </ModalRoot>
  );
}

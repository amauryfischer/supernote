"use client";

/**
 * SnoozeMenu — « Reporter à… » : les échéances rapides + une date libre.
 *
 * Une seule surface pour les trois entrées du report fin : le raccourci `h`, le
 * menu contextuel de la liste et le bottom sheet mobile. Le composant ne connaît
 * pas le thread : il renvoie une échéance (epoch ms) via `onPick`.
 */

import { useState } from "react";
import { Button, Input } from "@heroui/react";
import { Modal } from "@supernote/ui";
import { Clock } from "@phosphor-icons/react";
import { SNOOZE_PRESETS_FULL } from "@/lib/mail-triage";

/** Formate une date locale pour un `<input type="datetime-local">`. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SnoozeMenu({
  isOpen,
  onClose,
  onPick,
  /** Libellé du fil reporté (affiché en sous-titre). */
  subject,
}: {
  isOpen: boolean;
  onClose: () => void;
  onPick: (until: number) => void;
  subject?: string;
}) {
  const [custom, setCustom] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 24, 0, 0, 0);
    return toLocalInputValue(d);
  });

  const pick = (until: number) => {
    onPick(until);
    onClose();
  };

  const customTs = Date.parse(custom);
  const customValid = Number.isFinite(customTs) && customTs > Date.now();

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Reporter à…"
      size="sm"
    >
      {subject && (
        <p className="mb-3 truncate text-xs" style={{ color: "var(--text-muted)" }}>
          {subject}
        </p>
      )}
      <div className="flex flex-col gap-1">
        {SNOOZE_PRESETS_FULL.map((p) => (
          <Button
            key={p.id}
            variant="ghost"
            className="h-10 w-full justify-start gap-2"
            onPress={() => pick(p.computeUntil(new Date()))}
          >
            <Clock size={16} aria-hidden />
            {p.label}
          </Button>
        ))}
      </div>
      <div
        className="mt-3 flex flex-col gap-2 border-t pt-3"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
          Date précise
        </span>
        <div className="flex items-center gap-2">
          <Input
            type="datetime-local"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="flex-1"
            aria-label="Date et heure du report"
          />
          <Button
            variant="primary"
            size="sm"
            isDisabled={!customValid}
            onPress={() => pick(customTs)}
          >
            Reporter
          </Button>
        </div>
        {!customValid && (
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            Choisis une date future.
          </span>
        )}
      </div>
    </Modal>
  );
}

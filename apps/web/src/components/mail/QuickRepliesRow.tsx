"use client";

import { X } from "@phosphor-icons/react";
import { Button, Spinner } from "@heroui/react";
import { Tooltip } from "@supernote/ui";
import type { MailQuickRepliesChrome } from "@/components/shell/shell-chrome-context";

/**
 * Réponses éclair : un clic charge le texte dans le composeur (jamais d'envoi
 * direct — on relit avant d'envoyer). Rendue sous le fil sur mobile, dans le
 * panneau droit sur desktop.
 */
export function QuickRepliesRow({
  items,
  busy,
  onPick,
  onDismiss,
  className = "",
}: MailQuickRepliesChrome & { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
        Réponses éclair
      </span>
      {busy && <Spinner size="sm" aria-label="Génération des réponses éclair" />}
      {items.map((text) => (
        <Button
          key={text}
          variant="ghost"
          size="sm"
          className="h-7 max-w-full rounded-full px-2.5 text-xs"
          style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
          onPress={() => onPick(text)}
        >
          <span className="truncate">{text}</span>
        </Button>
      ))}
      {items.length > 0 && (
        <Tooltip content="Masquer les réponses éclair">
          <Button
            isIconOnly
            variant="ghost"
            size="sm"
            aria-label="Masquer les réponses éclair"
            className="h-7 min-h-7 w-7 min-w-7"
            onPress={onDismiss}
          >
            <X size={12} />
          </Button>
        </Tooltip>
      )}
    </div>
  );
}

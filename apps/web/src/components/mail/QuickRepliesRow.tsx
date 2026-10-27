"use client";

import { X } from "@phosphor-icons/react";
import { Tooltip, Button } from "@supernote/ui";
import type { MailQuickRepliesChrome } from "@/components/shell/shell-chrome-context";

/**
 * Réponses éclair : un clic charge le texte dans le composeur (jamais d'envoi
 * direct — on relit avant d'envoyer). Rendue sous le fil sur mobile, dans le
 * panneau droit sur desktop.
 */
const ALT_LABEL = typeof navigator !== "undefined" && /Mac|iP/.test(navigator.userAgent) ? "⌥" : "Alt+";

export function QuickRepliesRow({
  items,
  busy,
  onPick,
  onDismiss,
  altShortcuts = false,
  className = "",
}: MailQuickRepliesChrome & { altShortcuts?: boolean; className?: string }) {
  return (
    // Une seule ligne : les pastilles se partagent la largeur, le texte complet passe en infobulle native.
    <div className={`flex min-w-0 items-center gap-1.5 overflow-hidden ${className}`}>
      <span className="shrink-0 whitespace-nowrap text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
        Réponses éclair
      </span>
      {busy && items.length === 0 && (
        <span className="contents" role="status" aria-label="Génération des réponses éclair">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              aria-hidden
              className="sn-shimmer h-7 w-24 rounded-full"
              style={{ background: "var(--accent-subtle)" }}
            />
          ))}
        </span>
      )}
      {items.map((text, i) => (
        <Button
          key={text}
          variant="ghost"
          size="sm"
          className="h-7 min-w-0 max-w-full shrink rounded-full px-2.5 text-xs"
          style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
          onPress={() => onPick(text)}
          aria-keyshortcuts={altShortcuts ? `Alt+${i + 1}` : undefined}
        >
          {altShortcuts && (
            <span className="font-mono text-[10px] opacity-60" aria-hidden>
              {ALT_LABEL}{i + 1}
            </span>
          )}
          <span className="truncate" title={text}>{text}</span>
        </Button>
      ))}
      {items.length > 0 && (
        <Tooltip content="Masquer les réponses éclair">
          <Button
            variant="ghost"
            size="icon"
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

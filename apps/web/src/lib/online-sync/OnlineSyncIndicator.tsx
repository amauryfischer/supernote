"use client";

/**
 * Compact status indicator for the realtime online sync — the SSE op-log
 * twin of {@link GitSyncIndicator}, sharing its visual language:
 *
 *   • connected   → green dot
 *   • connecting  → violet (pulsing)
 *   • offline     → grey (pulsing — it is actively retrying)
 *   • error       → red
 *   • disabled    → hollow dot, "non configuré"
 *
 * Tapping the dot opens a popover with the room key, the last error if any,
 * and a shortcut to the sync settings tab. Same markup fits the desktop and
 * mobile top bars.
 *
 * ⚠️ Comme GitSyncIndicator, la pastille ne disparaît jamais : « pas de salon »
 * doit se lire à l'écran, sinon rien ne le distingue de « tout est à jour ».
 */

import { useState } from "react";
import { Button, Tooltip } from "@supernote/ui";
import Link from "next/link";
import { useOnlineSync } from "./OnlineSyncProvider";

/** Libellé d'état, partagé avec la carte « État » du drawer mobile. */
export function onlineSyncLabel(sync: {
  status: string;
  lastError?: string | null;
}): string {
  switch (sync.status) {
    case "connecting":
      return "Connexion au serveur de synchronisation…";
    case "connected":
      return "Synchronisation temps réel active";
    case "error":
      return `Erreur · ${sync.lastError ?? "voir détails"}`;
    case "disabled":
      return "Coffre en ligne non configuré";
    case "offline":
    default:
      return "Hors-ligne · reconnexion automatique";
  }
}

export function OnlineSyncIndicator({ size = "sm" }: { size?: "sm" | "md" }) {
  const sync = useOnlineSync();
  const [open, setOpen] = useState(false);

  if (!sync) return null;

  const unconfigured = sync.status === "disabled";
  const dotSize = size === "sm" ? 8 : 10;
  const color = (() => {
    switch (sync.status) {
      case "connecting":
        return "var(--accent)";
      case "connected":
        return "oklch(0.65 0.16 150)"; // var(--success)
      case "error":
        return "var(--danger)";
      case "offline":
      default:
        return "var(--text-muted)";
    }
  })();

  const label = onlineSyncLabel(sync);

  const pulsing = sync.status === "connecting" || sync.status === "offline";

  return (
    <div className="relative">
      <Tooltip content={label}>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={`État de la synchronisation en ligne : ${label}`}
          className="flex h-8 w-8 items-center justify-center rounded-full"
        >
          <span
            className={pulsing ? "animate-pulse" : undefined}
            style={{
              display: "inline-block",
              width: dotSize,
              height: dotSize,
              borderRadius: "50%",
              backgroundColor: unconfigured ? "transparent" : color,
              border: unconfigured ? "1px solid var(--text-muted)" : undefined,
              boxShadow:
                sync.status === "connected"
                  ? "0 0 6px -1px oklch(0.65 0.16 150 / 0.5)"
                  : sync.status === "error"
                    ? "0 0 6px -1px var(--danger)"
                    : undefined,
            }}
          />
        </Button>
      </Tooltip>

      {open && (
        <>
          {/* Backdrop to dismiss on outside tap */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="absolute right-0 top-10 z-50 w-72 rounded-xl border p-3 shadow-xl"
            style={{
              backgroundColor: "var(--surface-1)",
              borderColor: "var(--border-subtle)",
              boxShadow:
                "0 12px 24px -8px rgba(0,0,0,0.25), 0 4px 6px -2px rgba(0,0,0,0.1)",
            }}
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: unconfigured ? "transparent" : color,
                  border: unconfigured ? "1px solid var(--text-muted)" : undefined,
                }}
              />
              <span
                className="text-[13px] font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                {label}
              </span>
            </div>

            {unconfigured ? (
              <p
                className="mb-2 text-[11px] leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                Aucun salon : ce coffre reste sur cet appareil, rien n'est
                partagé avec le mobile.
              </p>
            ) : (
              <div
                className="mb-2 truncate text-[11px]"
                style={{ color: "var(--text-muted)" }}
                title={sync.config.serverUrl || "même origine"}
              >
                {(sync.config.serverUrl || "même origine").replace(/^https?:\/\/(www\.)?/, "")}
                {" · salon "}
                {sync.config.vaultKey}
              </div>
            )}

            {sync.lastError && (
              <p
                className="mb-2 text-[11px]"
                style={{ color: "var(--danger)" }}
              >
                {sync.lastError}
              </p>
            )}

            <Link
              href="/parametres"
              onClick={() => setOpen(false)}
              className="block w-full rounded-lg px-3 py-2 text-center text-[13px] font-medium"
              style={{
                backgroundColor: "var(--surface-2)",
                color: "var(--text-primary)",
              }}
            >
              {unconfigured ? "Configurer la synchronisation" : "Paramètres de synchronisation"}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

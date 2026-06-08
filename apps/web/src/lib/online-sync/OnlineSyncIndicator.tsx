"use client";

/**
 * Compact status indicator for the realtime online sync — the SSE op-log
 * twin of {@link GitSyncIndicator}, sharing its visual language:
 *
 *   • connected   → green dot
 *   • connecting  → violet (pulsing)
 *   • offline     → grey (pulsing — it is actively retrying)
 *   • error       → red
 *   • disabled    → hidden
 *
 * Tapping the dot opens a popover with the room key, the last error if any,
 * and a shortcut to the sync settings tab. Same markup fits the desktop and
 * mobile top bars.
 */

import { useState } from "react";
import { Button } from "@heroui/react";
import Link from "next/link";
import { useOnlineSync } from "./OnlineSyncProvider";

export function OnlineSyncIndicator({ size = "sm" }: { size?: "sm" | "md" }) {
  const sync = useOnlineSync();
  const [open, setOpen] = useState(false);

  if (!sync || sync.status === "disabled") return null;

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

  const label = (() => {
    switch (sync.status) {
      case "connecting":
        return "Connexion au serveur de synchronisation…";
      case "connected":
        return "Synchronisation temps réel active";
      case "error":
        return `Erreur · ${sync.lastError ?? "voir détails"}`;
      case "offline":
      default:
        return "Hors-ligne · reconnexion automatique";
    }
  })();

  const pulsing = sync.status === "connecting" || sync.status === "offline";

  return (
    <div className="relative">
      <Button
        isIconOnly
        variant="ghost"
        size="sm"
        type="button"
        onPress={() => setOpen((v) => !v)}
        aria-label={`État de la synchronisation en ligne : ${label}`}
        className="flex h-8 w-8 min-w-0 items-center justify-center rounded-full active:bg-[var(--surface-2)]"
      >
        <span
          className={pulsing ? "animate-pulse" : undefined}
          style={{
            display: "inline-block",
            width: dotSize,
            height: dotSize,
            borderRadius: "50%",
            backgroundColor: color,
            boxShadow:
              sync.status === "connected"
                ? "0 0 6px -1px oklch(0.65 0.16 150 / 0.5)"
                : sync.status === "error"
                  ? "0 0 6px -1px var(--danger)"
                  : undefined,
          }}
        />
      </Button>

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
                  backgroundColor: color,
                }}
              />
              <span
                className="text-[13px] font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                {label}
              </span>
            </div>

            <div
              className="mb-2 truncate text-[11px]"
              style={{ color: "var(--text-muted)" }}
              title={sync.config.serverUrl || "même origine"}
            >
              {(sync.config.serverUrl || "même origine").replace(/^https?:\/\/(www\.)?/, "")}
              {" · salon "}
              {sync.config.vaultKey}
            </div>

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
              Paramètres de synchronisation
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

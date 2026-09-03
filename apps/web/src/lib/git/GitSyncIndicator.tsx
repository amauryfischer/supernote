"use client";

/**
 * Compact status indicator for the Git sync. Shows a colored dot:
 *
 *   • idle / ok         → green
 *   • syncing            → violet (pulsing)
 *   • error              → red
 *   • offline            → grey
 *   • disabled (no git)  → hidden
 *
 * Tapping the dot opens a small popover with the timestamp of the last
 * successful sync, a "Sync now" button, and the latest summary
 * (commits pulled / pushed, conflict count). Designed to fit in the
 * mobile top bar AND the desktop top bar with the same markup.
 */

import { useState } from "react";
import { Button } from "@heroui/react";
import { useGitSync } from "./GitSyncProvider";

export function GitSyncIndicator({ size = "sm" }: { size?: "sm" | "md" }) {
  const sync = useGitSync();
  const [open, setOpen] = useState(false);

  if (!sync || sync.status === "disabled") return null;

  const dotSize = size === "sm" ? 8 : 10;
  const color = (() => {
    switch (sync.status) {
      case "syncing":
        return "var(--accent)";
      case "ok":
      case "idle":
        return "oklch(0.65 0.16 150)"; // var(--success)
      case "error":
        return "var(--danger)";
      case "offline":
        return "var(--text-muted)";
      default:
        return "var(--text-muted)";
    }
  })();

  const label = (() => {
    switch (sync.status) {
      case "syncing":
        return "Synchronisation en cours…";
      case "ok":
        return sync.lastSyncAt
          ? `Synchronisé · ${formatRelative(sync.lastSyncAt)}`
          : "Synchronisé";
      case "idle":
        return "En attente";
      case "error":
        return `Erreur · ${sync.errorMsg ?? "voir détails"}`;
      case "offline":
        return "Hors-ligne";
      default:
        return "";
    }
  })();

  return (
    <div className="relative">
      <Button
        isIconOnly
        variant="ghost"
        size="sm"
        type="button"
        onPress={() => setOpen((v) => !v)}
        aria-label={`État de la synchronisation : ${label}`}
        className="flex h-8 w-8 min-w-0 items-center justify-center rounded-full active:bg-[var(--surface-2)]"
      >
        <span
          className={sync.status === "syncing" ? "animate-pulse" : undefined}
          style={{
            display: "inline-block",
            width: dotSize,
            height: dotSize,
            borderRadius: "50%",
            backgroundColor: color,
            boxShadow:
              sync.status === "ok"
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

            {sync.config && (
              <div
                className="mb-2 truncate text-[11px]"
                style={{ color: "var(--text-muted)" }}
                title={sync.config.url}
              >
                {sync.config.url.replace(/^https?:\/\/(www\.)?/, "")} · {sync.config.ref}
              </div>
            )}

            {sync.lastSummary && (
              <ul
                className="mb-3 space-y-0.5 text-[11px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {sync.lastSummary.pulled > 0 && (
                  <li>↓ {sync.lastSummary.pulled} fichier(s) reçu(s)</li>
                )}
                {sync.lastSummary.pushed && <li>↑ Commit poussé</li>}
                {sync.lastSummary.conflicts.length > 0 && (
                  <li style={{ color: "var(--warning)" }}>
                    ⚠ {sync.lastSummary.conflicts.length} conflit(s) — versions
                    distantes écrites en sidecars
                  </li>
                )}
                {sync.lastSummary.pulled === 0 &&
                  !sync.lastSummary.pushed &&
                  sync.lastSummary.conflicts.length === 0 && (
                    <li>Rien à synchroniser</li>
                  )}
              </ul>
            )}

            <Button
              type="button"
              variant="primary"
              onPress={() => {
                setOpen(false);
                void sync.syncNow();
              }}
              isDisabled={sync.status === "syncing" || sync.status === "offline"}
              className="w-full text-[13px] font-medium"
              style={{
                backgroundColor: "var(--btn-primary-bg)",
                color: "var(--btn-primary-fg)",
              }}
            >
              {sync.status === "syncing" ? "Synchronisation…" : "Synchroniser maintenant"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return iso;
  const delta = Date.now() - t;
  const s = Math.round(delta / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} j`;
}

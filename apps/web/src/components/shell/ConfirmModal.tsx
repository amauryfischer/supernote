"use client";

/**
 * ConfirmModal — accessible replacement for the native `window.confirm()`.
 * Same rationale as PromptModal: native dialogs break theming and freeze
 * the Chrome MCP DevTools driver.
 *
 * Uses the same visual language as PromptModal so a paired prompt → confirm
 * flow looks consistent.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@supernote/ui";
import { useFocusTrap } from "@/hooks/useFocusTrap";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When `destructive`, the confirm button paints in the danger color. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Drives the backdrop opacity fade: starts at 0 on mount, flips to the
  // resting dim on the next frame so the CSS opacity transition can run.
  // (A transition can't fire on the very first paint, hence the flag.)
  const [shown, setShown] = useState(false);

  // Fade the dim backdrop in. Reset to 0 when closed so a re-open replays it.
  useEffect(() => {
    if (!open) {
      setShown(false);
      return undefined;
    }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Focus trap: focus the confirm button on open, keep Tab / Shift+Tab cycling
  // inside the dialog, and restore focus to the trigger on close. Replaces a
  // bare `autoFocus` that didn't prevent focus from leaking behind the overlay.
  useFocusTrap(dialogRef, open, { initialFocusRef: confirmRef });

  // Global Escape handler — closes the modal even if focus drifted.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onCancel}
      role="presentation"
    >
      {/* Dim backdrop as its own layer so its opacity fade stays decoupled
          from the dialog's rise-in entrance (no cascading opacity). */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: "rgba(0,0,0,0.4)",
          opacity: shown ? 1 : 0,
          transition: "var(--sn-transition-opacity)",
        }}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        className="sn-overlay-in relative w-full max-w-sm rounded-xl p-5 shadow-xl"
        style={{
          backgroundColor: "var(--surface-1)",
          border: "1px solid var(--border-subtle)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <h2
          id="confirm-modal-title"
          className="text-base font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </h2>
        {description && (
          <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
            {description}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant={destructive ? "danger" : "primary"}
            size="sm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";

/**
 * PromptModal — accessible replacement for the native `window.prompt()`.
 *
 * Why we need this:
 *   1. The native browser dialog is themed by the OS, not the app — it
 *      breaks the dark/light visual identity.
 *   2. `window.prompt()` is *modal at the page level*: it freezes the
 *      Chrome MCP DevTools driver and renders the PWA un-debuggable.
 *
 * Behaviour:
 *   - Opens centered with a dim backdrop (clicking backdrop = cancel).
 *   - Auto-focuses the input on mount.
 *   - Enter confirms, Escape cancels.
 *   - Uses the global CSS variables (--surface-1, --accent, etc.) so it
 *     follows the active theme without extra wiring.
 */

import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@supernote/ui";

interface PromptModalProps {
  open: boolean;
  title: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function PromptModal({
  open,
  title,
  placeholder,
  defaultValue = "",
  confirmLabel = "Valider",
  cancelLabel = "Annuler",
  onConfirm,
  onCancel,
}: PromptModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue);

  // Reset value whenever the modal is re-opened so a previous, abandoned
  // input doesn't bleed into the next prompt.
  useEffect(() => {
    if (open) setValue(defaultValue);
  }, [open, defaultValue]);

  // Auto-focus the input as soon as the dialog appears so the user can
  // start typing immediately (they invoked an action that requires text).
  useEffect(() => {
    if (open) {
      // requestAnimationFrame: wait for the DOM to mount + paint before
      // focusing, otherwise the focus call lands before the element exists.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  // Global Escape handler — closes the modal even if focus drifted.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const submit = () => {
    onConfirm(value);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-xl p-5 shadow-xl"
        style={{
          backgroundColor: "var(--surface-1)",
          border: "1px solid var(--border-subtle)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
      >
        <h2
          id="prompt-modal-title"
          className="mb-3 text-base font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {title}
        </h2>

        <Input
          ref={inputRef}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />

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
            type="button"
            variant="primary"
            size="sm"
            onClick={submit}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

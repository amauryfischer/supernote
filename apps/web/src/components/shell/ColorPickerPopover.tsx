"use client";

/**
 * ColorPickerPopover — anchored popover to pick / reset a color.
 *
 * Why this exists:
 *   The tags page (and a couple of other surfaces — note pin marker,
 *   schema field accents) used to cycle through a fixed palette on each
 *   click of the swatch. That made it impossible to land on a specific
 *   color without spamming the button, and the palette had only ~7 hues.
 *
 * Behaviour:
 *   - Renders nothing of its own — caller wraps any trigger element via
 *     the `anchorRef` they manage. We position ourselves with `position:
 *     fixed` next to the rect of the anchor, flipping if too close to
 *     the viewport edges.
 *   - 18-color preset grid sourced from the Tailwind 500-tier palette so
 *     it harmonises with the rest of the UI.
 *   - Native `<input type="color">` for arbitrary hex (covers anything
 *     the presets miss; no extra deps).
 *   - "Reset" sends `null` to revert to the default appearance.
 *   - Click-outside / Escape closes without persisting.
 */

import { useEffect, useRef, useState } from "react";

/**
 * 18 distinct hues drawn from the Tailwind 500 row. Picked for visual
 * separation rather than an alphabetical sweep — adjacent swatches in
 * the grid stay perceptually distinct.
 */
export const COLOR_PRESETS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "slate", hex: "#64748b" },
  { name: "gray", hex: "#6b7280" },
  { name: "red", hex: "#ef4444" },
  { name: "orange", hex: "#f97316" },
  { name: "amber", hex: "#f59e0b" },
  { name: "yellow", hex: "#eab308" },
  { name: "lime", hex: "#84cc16" },
  { name: "green", hex: "#22c55e" },
  { name: "emerald", hex: "#10b981" },
  { name: "teal", hex: "#14b8a6" },
  { name: "cyan", hex: "#06b6d4" },
  { name: "sky", hex: "#0ea5e9" },
  { name: "blue", hex: "#3b82f6" },
  { name: "indigo", hex: "#6366f1" },
  { name: "violet", hex: "#8b5cf6" },
  { name: "purple", hex: "#a855f7" },
  { name: "fuchsia", hex: "#d946ef" },
  { name: "pink", hex: "#ec4899" },
];

interface ColorPickerPopoverProps {
  /** When false, nothing renders. Caller controls visibility. */
  open: boolean;
  /** DOMRect of the trigger element — popover anchors to its bottom-left. */
  anchorRect: DOMRect | null;
  /** Currently selected color (used to highlight the matching preset). */
  value: string | null;
  /** Called with a hex string when a preset / custom color is picked. */
  onSelect: (color: string) => void;
  /** Called when the user clears the color (Reset button). */
  onReset: () => void;
  /** Close request (click-outside, Escape, after a selection). */
  onClose: () => void;
}

export function ColorPickerPopover({
  open,
  anchorRect,
  value,
  onSelect,
  onReset,
  onClose,
}: ColorPickerPopoverProps) {
  const popRef = useRef<HTMLDivElement>(null);

  // Click-outside + Escape close the popover. We attach to the document
  // so the listener catches clicks anywhere in the page, including
  // outside any React tree.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    // Defer attaching mousedown by a tick so the very click that opened
    // the popover doesn't immediately close it.
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", onDown);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || !anchorRect) return null;

  // Naive flip: if the popover would overflow the right edge, anchor it
  // to the right of the trigger instead. Same for vertical overflow.
  const POP_W = 196;
  const POP_H = 168;
  const margin = 6;
  let left = anchorRect.left;
  let top = anchorRect.bottom + margin;
  if (left + POP_W > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - POP_W - 8);
  }
  if (top + POP_H > window.innerHeight - 8) {
    top = Math.max(8, anchorRect.top - POP_H - margin);
  }

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label="Choisir une couleur"
      className="fixed z-50 rounded-lg p-2 shadow-xl"
      style={{
        left,
        top,
        width: POP_W,
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border-subtle)",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="grid grid-cols-6 gap-1.5">
        {COLOR_PRESETS.map((c) => {
          const active = value?.toLowerCase() === c.hex.toLowerCase();
          return (
            <button
              key={c.hex}
              type="button"
              title={c.name}
              onClick={() => {
                onSelect(c.hex);
                onClose();
              }}
              className="h-6 w-6 rounded-full transition-transform hover:scale-110"
              style={{
                backgroundColor: c.hex,
                outline: active ? "2px solid var(--accent)" : "none",
                outlineOffset: 2,
              }}
            />
          );
        })}
      </div>

      <div
        className="mt-2 flex items-center justify-between gap-2 border-t pt-2"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <CustomColorInput value={value} onPick={(hex) => { onSelect(hex); onClose(); }} />
        <button
          type="button"
          onClick={() => {
            onReset();
            onClose();
          }}
          className="rounded px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]"
          style={{ color: "var(--text-secondary)" }}
        >
          Réinitialiser
        </button>
      </div>
    </div>
  );
}

/**
 * Small wrapper around the native color input. We render a styled label
 * so it visually matches the "Reset" button instead of leaking the
 * browser's default color-input chrome into the popover.
 */
function CustomColorInput({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (hex: string) => void;
}) {
  // The native input emits `change` once the user closes the OS picker.
  // We mirror it locally to react instantly to `input` events too — some
  // browsers fire `input` continuously while the user drags the eyedropper.
  const [draft, setDraft] = useState(value ?? "#3b82f6");
  return (
    <label
      className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]"
      style={{ color: "var(--text-secondary)" }}
      title="Couleur personnalisée"
    >
      <span
        className="h-3 w-3 rounded-sm"
        style={{ backgroundColor: draft, border: "1px solid var(--border-subtle)" }}
      />
      Custom
      <input
        type="color"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => onPick(e.target.value)}
        className="sr-only"
      />
    </label>
  );
}

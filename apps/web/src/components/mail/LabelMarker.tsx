"use client";

import type { CSSProperties } from "react";
import { Tag } from "@phosphor-icons/react";
import type { GmailLabelColor } from "@/lib/gmail";
import type { LabelStyle } from "@/components/settings/types";

export const LABEL_STYLES: readonly { id: LabelStyle; name: string }[] = [
  { id: "solid", name: "Plein" },
  { id: "soft", name: "Doux" },
  { id: "outline", name: "Contour" },
  { id: "dot", name: "Point" },
];

// Les paires Gmail « pâles » portent la teinte dans le texte, les paires vives dans le fond.
function labelTint(color: GmailLabelColor | undefined): string {
  if (!color) return "var(--accent)";
  const neutralText = /^#(?:fff(?:fff)?|000(?:000)?)$/i.test(color.textColor);
  return neutralText ? color.backgroundColor : color.textColor;
}

// Mélange avec --text-primary : fonce les teintes claires en thème clair, les éclaircit en sombre.
const ink = (tint: string) => `color-mix(in oklab, ${tint} 72%, var(--text-primary))`;

export function labelChipStyle(color: GmailLabelColor | undefined, style: LabelStyle): CSSProperties {
  const tint = labelTint(color);
  switch (style) {
    case "soft":
      return { backgroundColor: `color-mix(in srgb, ${tint} 16%, transparent)`, color: ink(tint) };
    case "outline":
      return { boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tint} 60%, transparent)`, color: ink(tint) };
    case "dot":
      return { boxShadow: "inset 0 0 0 1px var(--border-subtle)", color: "var(--text-secondary)" };
    default:
      return color
        ? { backgroundColor: color.backgroundColor, color: color.textColor }
        : { backgroundColor: "var(--accent-subtle)", color: "var(--accent)" };
  }
}

export function LabelMarker({
  color,
  style,
  size,
}: {
  color: GmailLabelColor | undefined;
  style: LabelStyle;
  size: number;
}) {
  if (style === "dot") {
    return (
      <span
        aria-hidden
        className="shrink-0 rounded-full"
        style={{ width: 8, height: 8, backgroundColor: labelTint(color) }}
      />
    );
  }
  return <Tag size={size} className="shrink-0" aria-hidden />;
}

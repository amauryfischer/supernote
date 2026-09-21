"use client";

import type { CSSProperties } from "react";
import { Button } from "@heroui/react";
import { Tag } from "@phosphor-icons/react";
import type { GmailLabelColor } from "@/lib/gmail";
import type { LabelStyle } from "@/components/settings/types";

export const LABEL_STYLES: readonly { id: LabelStyle; name: string }[] = [
  { id: "solid", name: "Plein" },
  { id: "soft", name: "Doux" },
  { id: "outline", name: "Contour" },
  { id: "dot", name: "Point" },
];

export interface LabelHue {
  name: string;
  vivid: string;
  pale: string;
  ink: string;
  onVivid: string;
}

// Colonnes de la grille couleur Gmail : l'API refuse toute valeur hors de cette grille.
export const LABEL_HUES: readonly LabelHue[] = [
  { name: "Rouge", vivid: "#fb4c2f", pale: "#f6c5be", ink: "#822111", onVivid: "#ffffff" },
  { name: "Orange", vivid: "#ffad47", pale: "#ffe6c7", ink: "#a46a21", onVivid: "#000000" },
  { name: "Jaune", vivid: "#fad165", pale: "#fef1d1", ink: "#aa8831", onVivid: "#000000" },
  { name: "Vert", vivid: "#16a766", pale: "#b9e4d0", ink: "#076239", onVivid: "#ffffff" },
  { name: "Menthe", vivid: "#43d692", pale: "#c6f3de", ink: "#1a764d", onVivid: "#000000" },
  { name: "Bleu", vivid: "#4a86e8", pale: "#c9daf8", ink: "#1c4587", onVivid: "#ffffff" },
  { name: "Violet", vivid: "#a479e2", pale: "#e4d7f5", ink: "#41236d", onVivid: "#ffffff" },
  { name: "Rose", vivid: "#f691b3", pale: "#fcdee8", ink: "#83334c", onVivid: "#000000" },
  { name: "Gris", vivid: "#999999", pale: "#efefef", ink: "#434343", onVivid: "#ffffff" },
];

// Gmail ne stocke qu'une paire fond/texte par label : le style y est encodé par le fond.
const OUTLINE_BG = "#ffffff";
const DOT_BG = "#f3f3f3";
const isNeutral = (hex: string) => /^#(?:fff(?:fff)?|000(?:000)?)$/i.test(hex);

export function labelColorFor(hue: LabelHue, style: LabelStyle): GmailLabelColor {
  switch (style) {
    case "soft":
      return { backgroundColor: hue.pale, textColor: hue.ink };
    case "outline":
      return { backgroundColor: OUTLINE_BG, textColor: hue.ink };
    case "dot":
      return { backgroundColor: DOT_BG, textColor: hue.ink };
    default:
      return { backgroundColor: hue.vivid, textColor: hue.onVivid };
  }
}

export function labelStyleOf(color: GmailLabelColor | undefined): LabelStyle {
  if (!color || isNeutral(color.textColor)) return "solid";
  const bg = color.backgroundColor.toLowerCase();
  if (bg === OUTLINE_BG) return "outline";
  if (bg === DOT_BG) return "dot";
  return "soft";
}

export function labelHueOf(color: GmailLabelColor | undefined): LabelHue | undefined {
  if (!color) return undefined;
  const bg = color.backgroundColor.toLowerCase();
  const text = color.textColor.toLowerCase();
  return (
    LABEL_HUES.find((h) => h.vivid === bg || h.pale === bg) ??
    LABEL_HUES.find((h) => h.ink === text)
  );
}

// Couleur choisie hors de la grille (ex. dans Gmail web) : la teinte est dans le texte pour
// les paires pâles, dans le fond pour les paires vives.
function labelTint(color: GmailLabelColor | undefined): string {
  if (!color) return "var(--accent)";
  const hue = labelHueOf(color);
  if (hue) return hue.vivid;
  return isNeutral(color.textColor) ? color.backgroundColor : color.textColor;
}

// Mélange avec --text-primary : fonce les teintes claires en thème clair, les éclaircit en sombre.
const ink = (tint: string) => `color-mix(in oklab, ${tint} 72%, var(--text-primary))`;

export function labelChipStyle(color: GmailLabelColor | undefined): CSSProperties {
  const tint = labelTint(color);
  switch (labelStyleOf(color)) {
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

const ROW_LABELS_MAX = 3;

/** Pastilles minuscules des labels utilisateur d'un email, pour les lignes de liste ; au-delà de 3, un « +n ». */
export function RowLabelChips({
  labelIds,
  names,
  colors,
}: {
  labelIds: string[];
  names?: ReadonlyMap<string, string>;
  colors?: ReadonlyMap<string, GmailLabelColor>;
}) {
  const ids = names ? labelIds.filter((id) => names.has(id)) : [];
  return (
    <>
      {ids.slice(0, ROW_LABELS_MAX).map((id) => (
        <span
          key={id}
          title={names?.get(id)}
          className="max-w-[5rem] shrink-0 truncate rounded-full px-1.5 text-[10px] font-medium leading-4 md:max-w-[8rem]"
          style={labelChipStyle(colors?.get(id))}
        >
          {names?.get(id)}
        </span>
      ))}
      {ids.length > ROW_LABELS_MAX && (
        <span className="shrink-0 text-[10px]" style={{ color: "var(--text-muted)" }}>
          +{ids.length - ROW_LABELS_MAX}
        </span>
      )}
    </>
  );
}

export function LabelMarker({ color, size }: { color: GmailLabelColor | undefined; size: number }) {
  if (labelStyleOf(color) === "dot") {
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

/** Une ligne par style, une colonne par teinte : un clic fixe les deux. */
export function LabelStyleGrid({
  current,
  onPick,
}: {
  current: GmailLabelColor | undefined;
  onPick: (color: GmailLabelColor) => void;
}) {
  const currentHue = labelHueOf(current);
  const currentStyle = labelStyleOf(current);
  return (
    <div className="grid w-fit grid-cols-9 gap-1">
      {LABEL_STYLES.map((s) =>
        LABEL_HUES.map((h) => {
          const color = labelColorFor(h, s.id);
          const selected = h === currentHue && s.id === currentStyle;
          return (
            <Button
              key={`${s.id}-${h.name}`}
              isIconOnly
              variant="ghost"
              onPress={() => onPick(color)}
              aria-label={`${h.name}, ${s.name}${selected ? " (actuel)" : ""}`}
              className="h-8 min-h-8 w-8 min-w-8 items-center justify-center rounded-full p-0 sn-motion-glide hover:scale-110"
              style={{
                ...labelChipStyle(color),
                outline: selected ? "2px solid var(--accent)" : undefined,
                outlineOffset: 1,
              }}
            >
              <LabelMarker color={color} size={11} />
            </Button>
          );
        }),
      )}
    </div>
  );
}

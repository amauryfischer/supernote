"use client";

/**
 * AmbianceSelector — préset d'ambiance visuelle par note.
 *
 * Une ambiance = palette + typographie + texture appliquées d'un bloc à la
 * note entière (classe CSS sur la racine du NoteEditor, voir globals.css
 * section "Ambiances de note"). Persistée dans fields.ambiance de la note.
 */

import { useState } from "react";
import { Button, Popover } from "@heroui/react";
import { Check, Palette } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc/client";

export type NoteAmbiance =
  | "none"
  | "paper"
  | "terminal"
  | "zen"
  | "midnight"
  | "ocean"
  | "forest"
  | "blush"
  | "solarized"
  | "lavender"
  | "ink"
  | "slate"
  | "synthwave";
export type NoteTypo = "default" | "serif" | "sans" | "mono";

/** Ids d'ambiance valides (hors « none »). Source de vérité pour le narrowing. */
const AMBIANCE_IDS = new Set<NoteAmbiance>([
  "paper",
  "terminal",
  "zen",
  "midnight",
  "ocean",
  "forest",
  "blush",
  "solarized",
  "lavender",
  "ink",
  "slate",
  "synthwave",
]);

export function asAmbiance(v: unknown): NoteAmbiance {
  return typeof v === "string" && AMBIANCE_IDS.has(v as NoteAmbiance)
    ? (v as NoteAmbiance)
    : "none";
}

export function asTypo(v: unknown): NoteTypo {
  return v === "serif" || v === "sans" || v === "mono" ? v : "default";
}

/** Classes à poser sur la racine du NoteEditor. */
export function ambianceClass(a: NoteAmbiance, typo: NoteTypo = "default"): string {
  const parts: string[] = [];
  if (a !== "none") parts.push("sn-ambiance", `sn-ambiance-${a}`);
  if (typo !== "default") parts.push(`sn-typo-${typo}`);
  return parts.join(" ");
}

const TYPOS: { id: NoteTypo; label: string; family: string }[] = [
  { id: "default", label: "Défaut", family: "inherit" },
  { id: "serif", label: "Serif", family: "Georgia, serif" },
  { id: "sans", label: "Sans", family: "Inter, system-ui, sans-serif" },
  { id: "mono", label: "Mono", family: "ui-monospace, monospace" },
];

interface PresetDef {
  id: NoteAmbiance;
  label: string;
  hint: string;
  swatch: React.CSSProperties;
}

const PRESETS: PresetDef[] = [
  {
    id: "none",
    label: "Aucune",
    hint: "Thème par défaut",
    swatch: {
      background: "var(--surface-2)",
      color: "var(--text-secondary)",
      border: "1px solid var(--border-subtle)",
    },
  },
  {
    id: "paper",
    label: "Papier ancien",
    hint: "Serif, sépia, texture",
    swatch: {
      background: "#f7f1e3",
      color: "#3d3426",
      fontFamily: "Georgia, 'Times New Roman', serif",
      border: "1px solid #e0d5bb",
    },
  },
  {
    id: "terminal",
    label: "Terminal",
    hint: "Mono, sombre, scanlines",
    swatch: {
      background: "#0b0f0c",
      color: "#34d399",
      fontFamily: "ui-monospace, monospace",
      border: "1px solid #1d2a20",
    },
  },
  {
    id: "zen",
    label: "Zen",
    hint: "Aéré, lent, focalisé",
    swatch: {
      background: "#f6f7f4",
      color: "#5a6b5d",
      letterSpacing: 2,
      border: "1px solid #e3e7e0",
    },
  },
  {
    id: "midnight",
    label: "Nuit",
    hint: "Indigo profond, feutré",
    swatch: {
      background: "#0f1226",
      color: "#c7d2fe",
      border: "1px solid #262c54",
    },
  },
  {
    id: "ocean",
    label: "Océan",
    hint: "Bleu calme, aéré",
    swatch: {
      background: "#eef6fb",
      color: "#234e6b",
      border: "1px solid #cfe2ee",
    },
  },
  {
    id: "forest",
    label: "Forêt",
    hint: "Vert sauge, serif",
    swatch: {
      background: "#eef3ec",
      color: "#2f4632",
      fontFamily: "Georgia, 'Times New Roman', serif",
      border: "1px solid #d6e2d1",
    },
  },
  {
    id: "blush",
    label: "Rose poudré",
    hint: "Rose tendre, doux",
    swatch: {
      background: "#fbf0f2",
      color: "#7a3b4e",
      border: "1px solid #f0d6dd",
    },
  },
  {
    id: "solarized",
    label: "Solarisé",
    hint: "Tons chauds, mono",
    swatch: {
      background: "#fdf6e3",
      color: "#586e75",
      fontFamily: "ui-monospace, monospace",
      border: "1px solid #eee8d5",
    },
  },
  {
    id: "lavender",
    label: "Lavande",
    hint: "Violet posé, calme",
    swatch: {
      background: "#f3f0fb",
      color: "#4c3f6b",
      border: "1px solid #e2dcf2",
    },
  },
  {
    id: "ink",
    label: "Encre",
    hint: "Noir & blanc, éditorial",
    swatch: {
      background: "#fbfbf9",
      color: "#16160f",
      fontFamily: "Georgia, 'Times New Roman', serif",
      border: "1px solid #e3e3dc",
    },
  },
  {
    id: "slate",
    label: "Ardoise",
    hint: "Graphite froid, net",
    swatch: {
      background: "#1b1f24",
      color: "#cdd6e0",
      border: "1px solid #2e353f",
    },
  },
  {
    id: "synthwave",
    label: "Synthwave",
    hint: "Néon rétro, sombre",
    swatch: {
      background: "#1a1030",
      color: "#ff7ce5",
      fontFamily: "ui-monospace, monospace",
      border: "1px solid #34225a",
    },
  },
];

export function AmbianceSelector({
  noteId,
  value,
  typo,
  onChange,
  onTypoChange,
}: {
  noteId: string;
  value: NoteAmbiance;
  typo: NoteTypo;
  onChange: (a: NoteAmbiance) => void;
  onTypoChange: (t: NoteTypo) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const update = trpc.entities.update.useMutation();

  const pick = (id: NoteAmbiance): void => {
    onChange(id); // optimiste — la classe s'applique immédiatement
    void update.mutateAsync({ id: noteId, fields: { ambiance: id } });
    setOpen(false);
  };

  const pickTypo = (id: NoteTypo): void => {
    onTypoChange(id);
    void update.mutateAsync({ id: noteId, fields: { typo: id } });
  };

  const active = PRESETS.find((p) => p.id === value) ?? PRESETS[0]!;

  // Popover portalé (pas un <div> positionné en absolu) : ce bouton vit dans
  // la rangée métadonnées repliable, dont `overflow: hidden` anime le
  // collapse et rognerait sinon le menu (cf. .sn-meta-collapse__inner).
  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Ambiance de la note"
        // Puce sans libellé tant qu'aucune ambiance n'est choisie : 30px de
        // large (icône 14 + 2×8 de gouttière). `sn-hit` porte le plancher
        // tactile sur les deux axes.
        className="sn-hit h-7 min-w-0 gap-1 px-2 text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        <Palette size={14} />
        {value !== "none" && <span>{active.label}</span>}
      </Button>

      <Popover.Content className="w-60 max-h-[min(70vh,460px)] overflow-y-auto p-1.5">
        <Popover.Dialog className="outline-none" aria-label="Choisir une ambiance">
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              variant="ghost"
              size="sm"
              onPress={() => pick(p.id)}
              className="h-auto w-full justify-start gap-2.5 px-2 py-1.5"
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold"
                style={p.swatch}
              >
                Aa
              </span>
              <span className="flex min-w-0 flex-col items-start">
                <span className="text-[12.5px] font-medium" style={{ color: "var(--text-primary)" }}>
                  {p.label}
                </span>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {p.hint}
                </span>
              </span>
              {p.id === value && (
                <Check size={14} style={{ marginLeft: "auto", color: "var(--accent)" }} />
              )}
            </Button>
          ))}

          {/* Typographie — segmenté, override fin par-dessus l'ambiance. */}
          <div
            className="mt-1.5 px-1 pt-2"
            style={{ borderTop: "1px solid var(--border-subtle)" }}
          >
            <div
              className="sn-eyebrow sn-eyebrow--compact mb-1.5"
            >
              Typographie
            </div>
            <div className="flex gap-1">
              {TYPOS.map((tp) => {
                const selected = tp.id === typo;
                return (
                  <Button
                    key={tp.id}
                    variant={selected ? "primary" : "ghost"}
                    size="sm"
                    onPress={() => pickTypo(tp.id)}
                    className="h-auto flex-1 px-1 py-1"
                    aria-label={`Typographie ${tp.label}`}
                  >
                    <span
                      className="text-[12px]"
                      style={{ fontFamily: tp.family, color: selected ? undefined : "var(--text-secondary)" }}
                    >
                      {tp.label}
                    </span>
                  </Button>
                );
              })}
            </div>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

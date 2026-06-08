"use client";

/**
 * AmbianceSelector — préset d'ambiance visuelle par note.
 *
 * Une ambiance = palette + typographie + texture appliquées d'un bloc à la
 * note entière (classe CSS sur la racine du NoteEditor, voir globals.css
 * section "Ambiances de note"). Persistée dans fields.ambiance de la note.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Check, Palette } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc/client";

export type NoteAmbiance = "none" | "paper" | "terminal" | "zen";
export type NoteTypo = "default" | "serif" | "sans" | "mono";

export function asAmbiance(v: unknown): NoteAmbiance {
  return v === "paper" || v === "terminal" || v === "zen" ? v : "none";
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
  const rootRef = useRef<HTMLDivElement>(null);
  const update = trpc.entities.update.useMutation();

  // Click-outside + Escape ferment le popover.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

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

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <Button
        variant="ghost"
        size="sm"
        onPress={() => setOpen((o) => !o)}
        aria-label="Ambiance de la note"
        className="h-7 min-w-0 gap-1 px-2 text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        <Palette size={14} />
        {value !== "none" && <span>{active.label}</span>}
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="Choisir une ambiance"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 50,
            width: 240,
            padding: 6,
            borderRadius: 10,
            backgroundColor: "var(--surface-1)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
          }}
        >
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
              className="mb-1.5 text-[10px] font-medium uppercase tracking-wider"
              style={{ color: "var(--text-muted)" }}
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
        </div>
      )}
    </div>
  );
}

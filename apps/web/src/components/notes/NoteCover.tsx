"use client";

/**
 * NoteCover — bannière de couverture par note (façon Notion/Coda).
 *
 * Une couverture = un fond (gradient ou couleur unie) appliqué en bandeau
 * pleine largeur au-dessus de l'en-tête de la note. Persistée dans
 * `fields.cover` de la note (id de preset). Voir aussi NoteIcon (icône) et
 * AmbianceSelector (ambiance) qui partagent le même bag `fields`.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Check, Image as ImageIcon, Trash } from "@phosphor-icons/react";

interface CoverPreset {
  id: string;
  label: string;
  bg: string;
}

/** Galerie de couvertures — gradients puis couleurs unies. */
export const COVER_PRESETS: CoverPreset[] = [
  { id: "peach", label: "Pêche", bg: "linear-gradient(135deg,#ffd1a4 0%,#ff8c69 100%)" },
  { id: "sunset", label: "Coucher de soleil", bg: "linear-gradient(135deg,#ff9a9e 0%,#fad0c4 100%)" },
  { id: "lagoon", label: "Lagon", bg: "linear-gradient(135deg,#43cea2 0%,#185a9d 100%)" },
  { id: "violet", label: "Violet", bg: "linear-gradient(135deg,#a18cd1 0%,#fbc2eb 100%)" },
  { id: "ocean", label: "Océan", bg: "linear-gradient(135deg,#2193b0 0%,#6dd5ed 100%)" },
  { id: "ember", label: "Braise", bg: "linear-gradient(135deg,#f12711 0%,#f5af19 100%)" },
  { id: "forest", label: "Forêt", bg: "linear-gradient(135deg,#134e5e 0%,#71b280 100%)" },
  { id: "grape", label: "Raisin", bg: "linear-gradient(135deg,#6a3093 0%,#a044ff 100%)" },
  { id: "slate", label: "Ardoise", bg: "linear-gradient(135deg,#3a3f44 0%,#1f2326 100%)" },
  { id: "sand", label: "Sable", bg: "linear-gradient(135deg,#e6cfa4 0%,#cbb085 100%)" },
  { id: "rose", label: "Rose", bg: "#e8a0bf" },
  { id: "sky", label: "Ciel", bg: "#8ecae6" },
  { id: "mint", label: "Menthe", bg: "#a7d7c5" },
  { id: "graphite", label: "Graphite", bg: "#4b4f55" },
];

/** Normalise une valeur brute issue de `fields.cover`. */
export function asCover(v: unknown): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return COVER_PRESETS.some((p) => p.id === v) ? v : null;
}

/** CSS `background` d'un id de couverture, ou undefined si inconnu. */
export function coverBackground(id: string | null): string | undefined {
  if (!id) return undefined;
  return COVER_PRESETS.find((p) => p.id === id)?.bg;
}

/** Galerie en popover — partagée par la bannière et le bouton « Couverture ». */
function CoverGallery({
  value,
  onPick,
  onClose,
  anchor,
}: {
  value: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  anchor: "left" | "right";
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="Choisir une couverture"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        [anchor]: 0,
        zIndex: 50,
        width: "min(300px, calc(100vw - 32px))",
        padding: 8,
        borderRadius: 10,
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
      }}
    >
      <div className="grid grid-cols-3 gap-2">
        {COVER_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            aria-label={p.label}
            className="relative h-12 overflow-hidden rounded-md outline-none ring-offset-1 transition hover:opacity-90 focus-visible:ring-2"
            style={{ background: p.bg, border: "1px solid var(--border-subtle)" }}
          >
            {p.id === value && (
              <span
                className="absolute inset-0 flex items-center justify-center"
                style={{ backgroundColor: "rgba(0,0,0,0.25)" }}
              >
                <Check size={16} color="#fff" weight="bold" />
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Bannière de couverture. Rend `null` si aucune couverture. Contrôles
 * (changer / supprimer) en survol sur desktop, toujours visibles sur mobile
 * (pas de hover tactile).
 */
export function NoteCover({
  coverId,
  onChange,
}: {
  coverId: string | null;
  onChange: (id: string | null) => void;
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  if (!coverId) return null;
  const bg = coverBackground(coverId) ?? COVER_PRESETS[0]!.bg;

  return (
    <div className="sn-no-print group relative w-full shrink-0" style={{ background: bg }}>
      <div className="h-28 w-full md:h-44" />
      <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
        <div style={{ position: "relative" }}>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setOpen((o) => !o)}
            className="h-7 min-w-0 gap-1 px-2 text-xs"
            style={{ backgroundColor: "rgba(255,255,255,0.88)", color: "#1f2326" }}
          >
            <ImageIcon size={13} />
            Changer
          </Button>
          {open && (
            <CoverGallery
              value={coverId}
              anchor="right"
              onPick={(id) => {
                onChange(id);
                setOpen(false);
              }}
              onClose={() => setOpen(false)}
            />
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onPress={() => onChange(null)}
          aria-label="Supprimer la couverture"
          className="h-7 min-w-0 gap-1 px-2 text-xs"
          style={{ backgroundColor: "rgba(255,255,255,0.88)", color: "#1f2326" }}
        >
          <Trash size={13} />
        </Button>
      </div>
    </div>
  );
}

/** Bouton de la barre d'en-tête pour ajouter une couverture (aucune posée). */
export function CoverButton({
  onChange,
}: {
  onChange: (id: string | null) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <Button
        variant="ghost"
        size="sm"
        onPress={() => setOpen((o) => !o)}
        aria-label="Ajouter une couverture"
        className="h-7 min-w-0 gap-1 px-2 text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        <ImageIcon size={14} />
        Couverture
      </Button>
      {open && (
        <CoverGallery
          value={null}
          anchor="left"
          onPick={(id) => {
            onChange(id);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

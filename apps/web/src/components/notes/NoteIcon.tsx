"use client";

/**
 * NoteIcon — icône (emoji) par note, façon Notion/Coda.
 *
 * L'icône s'affiche inline à gauche du titre. Persistée dans `fields.icon`
 * (le caractère emoji lui-même). Picker d'emojis curé, sans dépendance externe.
 * Partage le bag `fields` avec NoteCover et AmbianceSelector.
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { Smiley, Shuffle, Trash } from "@phosphor-icons/react";

/** Palette curée d'emojis pour icônes de note. */
const EMOJIS: string[] = [
  "📝", "📄", "📚", "📒", "📕", "📗", "📘", "📙",
  "✏️", "🖊️", "🖋️", "✒️", "🔖", "📌", "📎", "🗂️",
  "💡", "🎯", "🚀", "⭐", "🔥", "✨", "⚡", "🌟",
  "✅", "☑️", "🟢", "🔴", "🟡", "🔵", "⚪", "⚫",
  "📅", "📆", "🗓️", "⏰", "⏳", "🕐", "📈", "📉",
  "💼", "🏠", "🏢", "🏝️", "🌍", "🗺️", "🧭", "🚩",
  "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍",
  "🙂", "😀", "😎", "🤔", "😴", "🤯", "🥳", "👀",
  "👍", "👏", "🙌", "🤝", "💪", "🫶", "🙏", "✋",
  "🎨", "🎵", "🎬", "📷", "🎮", "🧩", "🎲", "🏆",
  "🍎", "🍊", "☕", "🍵", "🌱", "🌿", "🌸", "🍂",
  "🐱", "🐶", "🦊", "🐢", "🦉", "🐝", "🦋", "🐙",
];

/** Normalise une valeur brute issue de `fields.icon`. */
export function asIcon(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Picker en popover — partagé par l'icône affichée et le bouton « Icône ». */
function EmojiPicker({
  onPick,
  onRemove,
  onClose,
}: {
  onPick: (emoji: string) => void;
  onRemove: (() => void) | null;
  onClose: () => void;
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

  const pickRandom = (): void => {
    const idx = Math.floor(Math.random() * EMOJIS.length);
    onPick(EMOJIS[idx]!);
  };

  return (
    <div
      ref={rootRef}
      role="menu"
      aria-label="Choisir une icône"
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        left: 0,
        zIndex: 50,
        width: "min(320px, calc(100vw - 32px))",
        padding: 8,
        borderRadius: 10,
        backgroundColor: "var(--surface-1)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
      }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onPress={pickRandom}
          className="h-7 min-w-0 gap-1 px-2 text-xs"
          style={{ color: "var(--text-secondary)" }}
        >
          <Shuffle size={13} />
          Aléatoire
        </Button>
        {onRemove && (
          <Button
            variant="ghost"
            size="sm"
            onPress={onRemove}
            className="h-7 min-w-0 gap-1 px-2 text-xs"
            style={{ color: "var(--text-muted)" }}
          >
            <Trash size={13} />
            Retirer
          </Button>
        )}
      </div>
      <div className="grid grid-cols-8 gap-0.5">
        {EMOJIS.map((e, i) => (
          // Grille dense d'emojis — bouton natif justifié (perf/densité, cf.
          // exceptions HeroUI). Idem cellule de couverture dans NoteCover.
          <button
            key={`${e}-${i}`}
            type="button"
            onClick={() => onPick(e)}
            aria-label={`Icône ${e}`}
            className="flex h-8 w-8 items-center justify-center rounded text-lg outline-none transition hover:bg-[var(--surface-2)] focus-visible:ring-2"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Icône affichée inline à gauche du titre. Cliquer rouvre le picker (changer
 * ou retirer). Ne rend rien si aucune icône.
 */
export function NoteIcon({
  icon,
  onChange,
}: {
  icon: string;
  onChange: (emoji: string | null) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }} className="shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Changer l'icône de la note"
        className="flex h-10 w-10 items-center justify-center rounded-md text-3xl leading-none outline-none transition hover:bg-[var(--surface-2)] focus-visible:ring-2"
      >
        {icon}
      </button>
      {open && (
        <EmojiPicker
          onPick={(e) => {
            onChange(e);
            setOpen(false);
          }}
          onRemove={() => {
            onChange(null);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** Bouton de la barre d'en-tête pour ajouter une icône (aucune posée). */
export function IconButton({
  onChange,
}: {
  onChange: (emoji: string | null) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <Button
        variant="ghost"
        size="sm"
        onPress={() => setOpen((o) => !o)}
        aria-label="Ajouter une icône"
        className="h-7 min-w-0 gap-1 px-2 text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        <Smiley size={14} />
        Icône
      </Button>
      {open && (
        <EmojiPicker
          onPick={(e) => {
            onChange(e);
            setOpen(false);
          }}
          onRemove={null}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

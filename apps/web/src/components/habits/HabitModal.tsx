"use client";

/**
 * HabitModal — formulaire création/édition d'une habitude.
 *
 * Même pattern que EditTodoModal : overlay maison + inputs HeroUI, le caller
 * possède l'état open/close. En édition, expose Archiver / Désarchiver et
 * Supprimer en plus d'Enregistrer.
 */

import { useEffect, useRef, useState } from "react";
import { Button, Input } from "@heroui/react";
import { COLOR_PRESETS } from "@/components/shell";
import {
  DEFAULT_HABIT_COLOR,
  DEFAULT_HABIT_ICON,
  type Habit,
} from "@/lib/habits/habitData";

export interface HabitFormValues {
  name: string;
  icon: string;
  color: string;
  target: number;
  unit: string;
}

interface HabitModalProps {
  open: boolean;
  /** null = création. */
  initial: Habit | null;
  onSave: (values: HabitFormValues) => void;
  onCancel: () => void;
  onArchiveToggle?: () => void;
  onDelete?: () => void;
}

const EMOJI_PRESETS = ["✅", "💧", "📖", "🏃", "🧘", "💪", "✍️", "🌱", "😴", "🎸", "🚭", "🥗"];

export function HabitModal({
  open,
  initial,
  onSave,
  onCancel,
  onArchiveToggle,
  onDelete,
}: HabitModalProps) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(DEFAULT_HABIT_ICON);
  const [color, setColor] = useState(DEFAULT_HABIT_COLOR);
  const [target, setTarget] = useState(1);
  const [unit, setUnit] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  // Réinitialise le formulaire à chaque ouverture (création ou édition).
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setIcon(initial?.icon ?? DEFAULT_HABIT_ICON);
    setColor(initial?.color ?? DEFAULT_HABIT_COLOR);
    setTarget(initial?.target ?? 1);
    setUnit(initial?.unit ?? "");
    const id = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, initial]);

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
    const trimmed = name.trim();
    if (!trimmed) {
      nameRef.current?.focus();
      return;
    }
    onSave({
      name: trimmed,
      icon: icon.trim() || DEFAULT_HABIT_ICON,
      color,
      target: clampTarget(target),
      unit: unit.trim(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={onCancel}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-xl p-5 shadow-xl"
        style={{
          backgroundColor: "var(--surface-1)",
          border: "1px solid var(--border-subtle)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="habit-modal-title"
      >
        <h2
          id="habit-modal-title"
          className="mb-4 text-base font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {initial ? "Modifier l'habitude" : "Nouvelle habitude"}
        </h2>

        <div className="mb-3">
          <span className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            Nom
          </span>
          <Input
            ref={nameRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Lire 20 minutes, boire de l'eau…"
            className="w-full text-sm"
            aria-label="Nom de l'habitude"
          />
        </div>

        <div className="mb-3">
          <span className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            Emoji
          </span>
          <div className="flex flex-wrap items-center gap-1">
            {EMOJI_PRESETS.map((e) => (
              <Button
                key={e}
                variant={icon === e ? "secondary" : "ghost"}
                size="sm"
                onPress={() => setIcon(e)}
                aria-label={`Emoji ${e}`}
                className="h-8 w-8 min-w-0 rounded-md p-0 text-base"
                style={
                  icon === e
                    ? { backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` }
                    : undefined
                }
              >
                {e}
              </Button>
            ))}
            <Input
              type="text"
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className="w-14 text-center text-sm"
              aria-label="Emoji personnalisé"
            />
          </div>
        </div>

        <div className="mb-3">
          <span className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
            Couleur
          </span>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_PRESETS.map((c) => (
              <Button
                key={c.name}
                variant="ghost"
                size="sm"
                onPress={() => setColor(c.hex)}
                aria-label={`Couleur ${c.name}`}
                className="h-6 w-6 min-w-0 rounded-full p-0"
                style={{
                  backgroundColor: c.hex,
                  outline: color === c.hex ? `2px solid var(--text-primary)` : undefined,
                  outlineOffset: 2,
                }}
              />
            ))}
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3">
          <div>
            <span className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              Objectif / jour
            </span>
            <Input
              type="number"
              min={1}
              max={50}
              value={String(target)}
              onChange={(e) => setTarget(Number(e.target.value) || 1)}
              className="w-full text-sm"
              aria-label="Objectif quotidien"
            />
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium" style={{ color: "var(--text-muted)" }}>
              Unité (optionnel)
            </span>
            <Input
              type="text"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="verres, pages, min…"
              className="w-full text-sm"
              aria-label="Unité"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {initial && onDelete && (
              <Button
                variant="ghost"
                onPress={onDelete}
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{ color: "var(--color-danger)" }}
              >
                Supprimer
              </Button>
            )}
            {initial && onArchiveToggle && (
              <Button
                variant="ghost"
                onPress={onArchiveToggle}
                className="rounded-md px-3 py-1.5 text-sm font-medium"
                style={{ color: "var(--text-muted)" }}
              >
                {initial.archived ? "Désarchiver" : "Archiver"}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onPress={onCancel}
              className="rounded-md px-3 py-1.5 text-sm font-medium"
              style={{ color: "var(--text-secondary)" }}
            >
              Annuler
            </Button>
            <Button
              variant="primary"
              onPress={submit}
              className="rounded-md px-3 py-1.5 text-sm font-medium"
            >
              {initial ? "Enregistrer" : "Créer"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function clampTarget(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(50, Math.max(1, Math.round(v)));
}

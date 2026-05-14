"use client";

/**
 * EditTodoModal — full-form editor for a single todo entity.
 *
 * Accessed by clicking the text on a TodoRow. Lets the user adjust every
 * mutable field (text, priority, importance, due date, done) in one shot
 * without the per-field round-trip the inline grid would imply.
 *
 * Save persists via `entities.update`; cancel discards the local diff. The
 * caller owns the open/close state; this component is a controlled dialog.
 */

import { useEffect, useRef, useState } from "react";
import { Button, Input, Checkbox } from "@heroui/react";
import type { TodoImportance } from "./TodoRow";
import { importanceColor } from "./TodoRow";

export interface EditTodoValues {
  text: string;
  done: boolean;
  priority: number;
  importance: TodoImportance;
  startDate: string; // YYYY-MM-DD or "" when unset
  dueDate: string; // YYYY-MM-DD or "" when unset
}

interface EditTodoModalProps {
  open: boolean;
  initial: EditTodoValues;
  /** True when the todo originated from a note — disables text editing
   *  (changes would have to round-trip through the markdown). */
  readonlyText?: boolean;
  onSave: (next: EditTodoValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

const IMPORTANCE_OPTIONS: Array<{ value: TodoImportance; label: string }> = [
  { value: "low", label: "Basse" },
  { value: "medium", label: "Moyenne" },
  { value: "high", label: "Haute" },
  { value: "critical", label: "Critique" },
];

export function EditTodoModal({
  open,
  initial,
  readonlyText,
  onSave,
  onCancel,
  onDelete,
}: EditTodoModalProps) {
  const [text, setText] = useState(initial.text);
  const [done, setDone] = useState(initial.done);
  const [priority, setPriority] = useState(initial.priority);
  const [importance, setImportance] = useState<TodoImportance>(initial.importance);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [dueDate, setDueDate] = useState(initial.dueDate);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset local state every time the dialog opens against a different todo.
  // We key on `open` so re-opening with the same `initial` doesn't carry
  // over an in-progress edit from a previous session.
  useEffect(() => {
    if (open) {
      setText(initial.text);
      setDone(initial.done);
      setPriority(initial.priority);
      setImportance(initial.importance);
      setStartDate(initial.startDate);
      setDueDate(initial.dueDate);
    }
  }, [open, initial]);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

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
    onSave({
      text: text.trim(),
      done,
      priority: clampPriority(priority),
      importance,
      startDate: startDate.trim(),
      dueDate: dueDate.trim(),
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
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-todo-title"
      >
        <h2
          id="edit-todo-title"
          className="mb-4 text-base font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          Modifier la tâche
        </h2>

        <div className="mb-3">
          <span
            className="mb-1 block text-xs font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            Texte
          </span>
          <Input
            ref={inputRef}
            type="text"
            value={text}
            disabled={readonlyText}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            className="w-full text-sm"
            aria-label="Texte de la tâche"
          />
          {readonlyText && (
            <span
              className="mt-1 block text-[10px]"
              style={{ color: "var(--text-muted)" }}
            >
              Texte verrouillé : modifie la note source pour le changer.
            </span>
          )}
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <span
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Priorité (1-9)
            </span>
            <Input
              type="number"
              min={1}
              max={9}
              value={String(priority)}
              onChange={(e) => setPriority(Number(e.target.value) || 5)}
              className="w-full text-sm"
              aria-label="Priorité"
            />
          </div>

          {/* spacer — keeps importance row below on a full width */}
          <div />
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <span
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Début
            </span>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full text-sm"
              aria-label="Date de début"
            />
          </div>

          <div>
            <span
              className="mb-1 block text-xs font-medium"
              style={{ color: "var(--text-muted)" }}
            >
              Échéance
            </span>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full text-sm"
              aria-label="Date d'échéance"
            />
          </div>
        </div>

        <div className="mb-4">
          <span
            className="mb-1 block text-xs font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            Importance
          </span>
          <div className="flex gap-1.5">
            {IMPORTANCE_OPTIONS.map((opt) => {
              const active = importance === opt.value;
              return (
                <Button
                  key={opt.value}
                  variant={active ? "secondary" : "ghost"}
                  onPress={() => setImportance(opt.value)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: importanceColor(opt.value) }}
                  />
                  {opt.label}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <Checkbox
            isSelected={done}
            onChange={(checked) => setDone(checked)}
            aria-label="Marquée comme faite"
          >
            <span className="text-sm" style={{ color: "var(--text-primary)" }}>
              Marquée comme faite
            </span>
          </Checkbox>
        </div>

        <div className="flex items-center justify-between">
          {onDelete ? (
            <Button
              variant="ghost"
              onPress={onDelete}
              className="rounded-md px-3 py-1.5 text-sm font-medium"
              style={{ color: "#EF4444" }}
            >
              Supprimer
            </Button>
          ) : (
            <span />
          )}
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
              Enregistrer
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function clampPriority(v: number): number {
  if (!Number.isFinite(v)) return 5;
  return Math.min(9, Math.max(1, Math.round(v)));
}

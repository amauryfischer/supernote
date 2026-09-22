"use client";

import { useState } from "react";
import { CaretRight, CheckSquare, ListChecks } from "@phosphor-icons/react";
import { Button, Tooltip } from "@supernote/ui";
import { QUADRANTS } from "@/components/todos/TodoMatrix";
import { TASK_DRAG_MIME } from "@/lib/agenda/task-ref";
import type { SchedulableTask } from "./useSchedulableTasks";

const OPEN_KEY = "supernote.agenda.taskDrawer";

function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
}

interface TaskListProps {
  tasks: readonly SchedulableTask[];
  onPick: (task: SchedulableTask) => void;
  draggable?: boolean;
}

export function TaskList({ tasks, onPick, draggable = false }: TaskListProps) {
  return (
    <div className="flex flex-col gap-3">
      {QUADRANTS.map((q) => {
        const items = tasks.filter((t) => t.quadrant === q.key);
        if (items.length === 0) return null;
        return (
          <section key={q.key} className="flex flex-col gap-0.5">
            <h3 className="sn-eyebrow sn-eyebrow--compact flex items-center gap-1.5 px-2">
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: q.accent }} />
              {q.title}
            </h3>
            <ul className="flex flex-col">
              {items.map((t) => (
                <li key={t.ref}>
                  {/* Bouton natif : il porte le glisser HTML5, que react-aria intercepterait. */}
                  <button
                    type="button"
                    draggable={draggable}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TASK_DRAG_MIME, t.ref);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onClick={() => onPick(t)}
                    className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-[var(--nav-hover-bg)] focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
                    style={{ color: "var(--text-primary)", cursor: draggable ? "grab" : undefined }}
                  >
                    <CheckSquare size={14} aria-hidden className="shrink-0" style={{ color: "var(--text-muted)" }} />
                    <span className="min-w-0 truncate">{t.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function TaskDrawer({ tasks, onPick }: { tasks: readonly SchedulableTask[]; onPick: (task: SchedulableTask) => void }) {
  const [open, setOpen] = useState(readOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* état valable pour la session */
    }
  };

  if (!open) {
    return (
      <div className="flex w-10 shrink-0 justify-center border-l pt-2" style={{ borderColor: "var(--border-subtle)" }}>
        <Tooltip content={`À planifier (${tasks.length})`}>
          <Button variant="ghost" size="icon" isIconOnly aria-label={`Afficher les tâches à planifier (${tasks.length})`} onPress={toggle}>
            <ListChecks size={16} aria-hidden />
          </Button>
        </Tooltip>
      </div>
    );
  }

  return (
    <aside
      aria-label="À planifier"
      className="flex w-64 shrink-0 flex-col border-l"
      style={{ borderColor: "var(--border-subtle)", background: "var(--surface-0)" }}
    >
      <div className="flex items-center gap-2 px-3 pt-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          À planifier
        </h2>
        <span
          className="rounded-full px-1.5 text-[10px] font-medium tabular-nums"
          style={{ background: "var(--surface-3)", color: "var(--text-muted)" }}
        >
          {tasks.length}
        </span>
        <Tooltip content="Replier">
          <Button variant="ghost" size="icon" isIconOnly aria-label="Replier les tâches à planifier" onPress={toggle} className="ml-auto">
            <CaretRight size={14} aria-hidden />
          </Button>
        </Tooltip>
      </div>
      <p className="px-3 pb-2 text-xs" style={{ color: "var(--text-muted)" }}>
        Glisse une tâche sur un créneau.
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-3">
        {tasks.length === 0 ? (
          <p className="px-2 py-4 text-sm" style={{ color: "var(--text-muted)" }}>
            Tout est planifié.
          </p>
        ) : (
          <TaskList tasks={tasks} onPick={onPick} draggable />
        )}
      </div>
    </aside>
  );
}

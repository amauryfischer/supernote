"use client";

/**
 * TodoCalendarView — monthly calendar grid with drag-and-drop scheduling.
 *
 * Layout: 7-column grid (Mon→Sun) showing the current month. A "Sans date"
 * drawer on the right lists todos without any date so they can be dragged
 * onto a day cell.
 *
 * DnD uses @dnd-kit/core (already a project dep). Drop targets are day cells
 * identified by their ISO date string. Drag sources are todo rows.
 *
 * Rules:
 *   - Drag from drawer → day: assigns dueDate = that day, startDate = null.
 *   - Drag within calendar → new day: shifts all non-null dates by delta.
 *   - Click on a todo anywhere → opens EditTodoModal (handled by caller via onEdit).
 */

import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Button } from "@heroui/react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { importanceColor } from "./TodoRow";
import type { TodoRowData } from "./TodoRow";
import { useDateFormat } from "@/lib/dateFormat";
import { InlineMarkdown } from "@/lib/inlineMarkdown";

interface CalendarTodo extends TodoRowData {
  startDate: string | null;
}

interface TodoCalendarViewProps {
  todos: CalendarTodo[];
  onEdit: (row: CalendarTodo) => void;
  onUpdateDates: (
    row: CalendarTodo,
    dates: { startDate: string | null; dueDate: string | null },
  ) => Promise<void>;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function todayIso(): string {
  return isoDate(new Date());
}

/** Days in the 7-column grid that covers the full month (padded to Mon start). */
function buildCalendarDays(year: number, month: number): Date[] {
  // First day of month
  const first = new Date(year, month, 1);
  // Last day of month
  const last = new Date(year, month + 1, 0);
  // Offset: weekday of first (0=Sun→6); we want Mon=0 basis
  const startOffset = (first.getDay() + 6) % 7;
  const endOffset = (7 - ((last.getDay() + 6) % 7 + 1)) % 7;

  const days: Date[] = [];
  // Pad start with days from previous month
  for (let i = startOffset; i > 0; i--) {
    const d = new Date(first);
    d.setDate(d.getDate() - i);
    days.push(d);
  }
  // Current month days
  for (let d = 1; d <= last.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  // Pad end to complete last row
  for (let i = 1; i <= endOffset; i++) {
    const d = new Date(last);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  return days;
}

/** Returns true if the todo touches the given ISO date day. */
function todoTouchesDay(todo: CalendarTodo, dayIso: string): boolean {
  const { startDate, dueDate } = todo;
  if (!startDate && !dueDate) return false;
  if (startDate && dueDate) {
    return dayIso >= startDate && dayIso <= dueDate;
  }
  if (dueDate) return dueDate === dayIso;
  if (startDate) return startDate === dayIso;
  return false;
}

/** True if startDate is on this exact day (for rounded left cap). */
function isRangeStart(todo: CalendarTodo, dayIso: string): boolean {
  if (!todo.startDate || !todo.dueDate) return false;
  return todo.startDate === dayIso;
}

/** True if dueDate is on this exact day (for rounded right cap). */
function isRangeEnd(todo: CalendarTodo, dayIso: string): boolean {
  if (!todo.startDate || !todo.dueDate) return false;
  return todo.dueDate === dayIso;
}

// ── Drag ID helpers ───────────────────────────────────────────────────────────

const DAY_DROPPABLE_PREFIX = "day:";
const DRAWER_DROPPABLE_ID = "drawer";
const DRAGGABLE_PREFIX = "todo:";

function dayDropId(iso: string): string {
  return `${DAY_DROPPABLE_PREFIX}${iso}`;
}

function draggableId(todoId: string): string {
  return `${DRAGGABLE_PREFIX}${todoId}`;
}

function dayFromDropId(dropId: string): string | null {
  if (dropId.startsWith(DAY_DROPPABLE_PREFIX)) {
    return dropId.slice(DAY_DROPPABLE_PREFIX.length);
  }
  return null;
}

function todoIdFromDraggableId(draggId: string): string | null {
  if (draggId.startsWith(DRAGGABLE_PREFIX)) {
    return draggId.slice(DRAGGABLE_PREFIX.length);
  }
  return null;
}

// ── DayCell ───────────────────────────────────────────────────────────────────

interface DayCellProps {
  day: Date;
  isCurrentMonth: boolean;
  todos: CalendarTodo[];
  onEdit: (t: CalendarTodo) => void;
}

function DayCell({ day, isCurrentMonth, todos, onEdit }: DayCellProps) {
  const iso = isoDate(day);
  const today = iso === todayIso();
  const { setNodeRef, isOver } = useDroppable({ id: dayDropId(iso) });
  const { compact: formatCompact } = useDateFormat();

  const MAX_VISIBLE = 3;
  const visible = todos.slice(0, MAX_VISIBLE);
  const overflow = todos.length - MAX_VISIBLE;

  return (
    <div
      ref={setNodeRef}
      className="min-h-[100px] flex flex-col p-1 border-r border-b relative"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: isOver
          ? "var(--accent-subtle, var(--surface-2))"
          : isCurrentMonth
            ? "var(--surface-0)"
            : "var(--surface-1)",
        transition: "background-color 0.1s",
      }}
    >
      {/* Day number */}
      <span
        className="self-end mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium"
        style={
          today
            ? { backgroundColor: "var(--btn-primary-bg)", color: "var(--btn-primary-fg)" }
            : {
                color: isCurrentMonth ? "var(--text-primary)" : "var(--text-muted)",
              }
        }
      >
        {day.getDate()}
      </span>

      {/* Todo items */}
      <div className="flex flex-col gap-0.5">
        {visible.map((todo) => (
          <DraggableTodoChip
            key={todo.id}
            todo={todo}
            dayIso={iso}
            formatCompact={formatCompact}
            onEdit={onEdit}
          />
        ))}
        {overflow > 0 && (
          <span
            className="text-[10px] px-1 cursor-default"
            style={{ color: "var(--text-muted)" }}
          >
            +{overflow} autre{overflow > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

// ── DraggableTodoChip ─────────────────────────────────────────────────────────

interface DraggableTodoChipProps {
  todo: CalendarTodo;
  dayIso: string;
  formatCompact: (iso: string) => string;
  onEdit: (t: CalendarTodo) => void;
}

function DraggableTodoChip({ todo, dayIso, onEdit }: DraggableTodoChipProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId(todo.id),
    data: { todo },
  });

  const hasRange = !!(todo.startDate && todo.dueDate && todo.startDate !== todo.dueDate);
  const rStart = hasRange && isRangeStart(todo, dayIso);
  const rEnd = hasRange && isRangeEnd(todo, dayIso);
  const rMid = hasRange && !rStart && !rEnd;

  const color = importanceColor(todo.importance);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.stopPropagation();
        onEdit(todo);
      }}
      className="truncate cursor-grab active:cursor-grabbing select-none px-1 text-[10px] font-medium leading-5"
      style={{
        opacity: isDragging ? 0.4 : 1,
        backgroundColor: `${color}22`,
        color,
        borderRadius: hasRange
          ? rStart
            ? "4px 0 0 4px"
            : rEnd
              ? "0 4px 4px 0"
              : rMid
                ? "0"
                : "4px"
          : "4px",
        borderLeft: rStart || !hasRange ? `2px solid ${color}` : "none",
        borderRight: rEnd || !hasRange ? `2px solid ${color}` : "none",
      }}
      title={todo.text}
    >
      <InlineMarkdown text={todo.text} />
    </div>
  );
}

// ── DrawerTodoItem ────────────────────────────────────────────────────────────

function DrawerTodoItem({
  todo,
  onEdit,
}: {
  todo: CalendarTodo;
  onEdit: (t: CalendarTodo) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: draggableId(todo.id),
    data: { todo },
  });

  const color = importanceColor(todo.importance);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.stopPropagation();
        onEdit(todo);
      }}
      // À py-1.5 la ligne fait 28px, sous le plancher tactile, et c'est la
      // seule façon d'ouvrir une tâche sans date.
      className="sn-hit flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs cursor-grab active:cursor-grabbing select-none hover:bg-[var(--surface-2)] transition-colors"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="flex-1 truncate" style={{ color: "var(--text-primary)" }}>
        <InlineMarkdown text={todo.text} />
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TodoCalendarView({ todos, onEdit, onUpdateDates }: TodoCalendarViewProps) {
  const isMobile = useIsMobile();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [activeTodo, setActiveTodo] = useState<CalendarTodo | null>(null);

  // Doigt = appui long, souris = seuil en distance (cf. TodoMatrix) : le
  // calendrier défile verticalement sur téléphone, un seuil en distance au
  // doigt confisquerait ce défilement dès qu'on part d'une pastille de tâche.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const days = useMemo(() => buildCalendarDays(year, month), [year, month]);

  // Partition: with-date (on calendar) vs. without-date (drawer)
  const { calendarTodos, drawerTodos } = useMemo(() => {
    const cal: CalendarTodo[] = [];
    const drawer: CalendarTodo[] = [];
    for (const t of todos) {
      if (t.startDate || t.dueDate) cal.push(t);
      else drawer.push(t);
    }
    return { calendarTodos: cal, drawerTodos: drawer };
  }, [todos]);

  const todosForDay = useCallback(
    (dayIso: string): CalendarTodo[] => {
      return calendarTodos.filter((t) => todoTouchesDay(t, dayIso));
    },
    [calendarTodos],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const todo = event.active.data.current?.todo as CalendarTodo | undefined;
    setActiveTodo(todo ?? null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTodo(null);
      const { active, over } = event;
      if (!over) return;

      const todoId = todoIdFromDraggableId(active.id as string);
      if (!todoId) return;
      const todo = todos.find((t) => t.id === todoId);
      if (!todo) return;

      const targetDay = dayFromDropId(over.id as string);
      if (!targetDay) return; // dropped on drawer — no-op

      if (targetDay === over.id) return; // safety

      // Compute date delta
      const prevAnchor = todo.dueDate ?? todo.startDate;
      if (prevAnchor) {
        // Shift all non-null dates by delta days
        const prevMs = new Date(prevAnchor).getTime();
        const nextMs = new Date(targetDay).getTime();
        const deltaDays = Math.round((nextMs - prevMs) / 86_400_000);

        const shiftDate = (iso: string | null): string | null => {
          if (!iso) return null;
          const d = new Date(iso);
          d.setDate(d.getDate() + deltaDays);
          return isoDate(d);
        };

        void onUpdateDates(todo, {
          startDate: shiftDate(todo.startDate),
          dueDate: shiftDate(todo.dueDate),
        });
      } else {
        // No prior dates (from drawer) — assign dueDate only
        void onUpdateDates(todo, { startDate: null, dueDate: targetDay });
      }
    },
    [todos, onUpdateDates],
  );

  const prevMonth = useCallback(() => {
    setMonth((m) => {
      if (m === 0) {
        setYear((y) => y - 1);
        return 11;
      }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setMonth((m) => {
      if (m === 11) {
        setYear((y) => y + 1);
        return 0;
      }
      return m + 1;
    });
  }, []);

  const monthLabel = new Date(year, month, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });

  const weekDays = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

  const { setNodeRef: drawerDropRef } = useDroppable({ id: DRAWER_DROPPABLE_ID });

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {/* Empilé sous 768px : le tiroir « sans date » est large de 260px fixes,
          ce qui ne laissait que ~130px au calendrier sur un écran de 390 —
          trois colonnes de semaine sur sept visibles, en-têtes de jours
          collées les unes aux autres, et le reste au défilement horizontal. */}
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row" style={{ minHeight: 0 }}>
        {/* Calendar grid */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Month nav */}
          <div
            className="flex items-center justify-between px-4 py-2 border-b shrink-0"
            style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-0)" }}
          >
            <Button
              variant="ghost"
              onPress={prevMonth}
              className="flex items-center justify-center rounded p-1 hover:bg-[var(--surface-2)] transition-colors"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Mois précédent"
            >
              <CaretLeft size={16} />
            </Button>
            <span
              className="text-sm font-semibold capitalize"
              style={{ color: "var(--text-primary)" }}
            >
              {monthLabel}
            </span>
            <Button
              variant="ghost"
              onPress={nextMonth}
              className="flex items-center justify-center rounded p-1 hover:bg-[var(--surface-2)] transition-colors"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Mois suivant"
            >
              <CaretRight size={16} />
            </Button>
          </div>

          {/* Weekday headers */}
          <div
            className="grid border-b shrink-0"
            style={{ gridTemplateColumns: "repeat(7, 1fr)", borderColor: "var(--border-subtle)" }}
          >
            {weekDays.map((d) => (
              <div
                key={d}
                className="py-1 text-center text-[11px] font-medium uppercase tracking-wide"
                style={{ color: "var(--text-muted)" }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div
            className="grid flex-1 overflow-y-auto"
            style={{
              gridTemplateColumns: "repeat(7, 1fr)",
              // Six rangées de 100px = 600px : sur téléphone le mois entier
              // passait sous la ligne de flottaison alors que la colonne ne
              // fait que 55px de large. 64px suffisent à porter le numéro du
              // jour et deux pastilles.
              gridAutoRows: `minmax(${isMobile ? 64 : 100}px, auto)`,
              borderTop: "1px solid var(--border-subtle)",
              borderLeft: "1px solid var(--border-subtle)",
            }}
          >
            {days.map((day) => {
              const iso = isoDate(day);
              const isCurrentMonth = day.getMonth() === month;
              return (
                <DayCell
                  key={iso}
                  day={day}
                  isCurrentMonth={isCurrentMonth}
                  todos={todosForDay(iso)}
                  onEdit={onEdit}
                />
              );
            })}
          </div>
        </div>

        {/* "Sans date" drawer */}
        <div
          ref={drawerDropRef}
          className="flex shrink-0 flex-col overflow-hidden border-t md:border-l md:border-t-0"
          style={{
            width: isMobile ? "100%" : 260,
            // Plafonné pour que le calendrier garde la majorité de l'écran :
            // le tiroir est une destination de dépôt, pas la vue principale.
            maxHeight: isMobile ? "34%" : undefined,
            borderColor: "var(--border-subtle)",
            backgroundColor: "var(--surface-1)",
          }}
        >
          <div
            className="px-3 py-2 border-b shrink-0"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <span
              className="sn-eyebrow"
            >
              Sans date ({drawerTodos.length})
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
            {drawerTodos.length === 0 ? (
              <p
                className="text-[11px] text-center py-6"
                style={{ color: "var(--text-muted)" }}
              >
                Toutes les tâches ont une date.
              </p>
            ) : (
              drawerTodos.map((t) => (
                <DrawerTodoItem key={t.id} todo={t} onEdit={onEdit} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Drag overlay — shows a ghost while dragging */}
      <DragOverlay dropAnimation={null}>
        {activeTodo ? (
          <div
            className="rounded px-2 py-1 text-[11px] font-medium shadow-lg max-w-[180px] truncate"
            style={{
              backgroundColor: `${importanceColor(activeTodo.importance)}33`,
              color: importanceColor(activeTodo.importance),
              border: `1px solid ${importanceColor(activeTodo.importance)}`,
            }}
          >
            <InlineMarkdown text={activeTodo.text} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

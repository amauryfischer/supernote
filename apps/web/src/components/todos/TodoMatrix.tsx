"use client";

/**
 * TodoMatrix — Eisenhower matrix view for the /todos page.
 *
 * Two axes, four quadrants:
 *   - Urgency  ← the `urgent` flag (explicit per-task toggle / 🔥 inline token)
 *   - Importance ← the existing 4-level `importance` field, collapsed to a
 *     binary (high|critical = important, low|medium = not important).
 *
 *        │ URGENT            │ PAS URGENT
 *   ─────┼───────────────────┼───────────────────
 *   IMP. │ Faire (Do)        │ Planifier (Schedule)
 *   ¬IMP.│ Déléguer (Deleg.) │ Éliminer (Eliminate)
 *
 * Dragging a card to another quadrant rewrites its urgency + importance via
 * `onMove`. Importance granularity is preserved within each half (see
 * `importanceForAxis` in TodoRow).
 */

import * as React from "react";
import {
  DndContext,
  useDraggable,
  useDroppable,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  closestCenter,
  type DragEndEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { TodoRow, isImportant, type TodoRowData } from "./TodoRow";

type QuadrantKey = "do" | "schedule" | "delegate" | "eliminate";

interface QuadrantDef {
  key: QuadrantKey;
  title: string;
  hint: string;
  urgent: boolean;
  important: boolean;
  accent: string;
}

// Reading order = grid order (2 columns): urgent column first.
const QUADRANTS: QuadrantDef[] = [
  { key: "do", title: "Faire", hint: "Urgent + important — traiter maintenant", urgent: true, important: true, accent: "#EF4444" },
  { key: "schedule", title: "Planifier", hint: "Important, pas urgent — programmer", urgent: false, important: true, accent: "#3B82F6" },
  { key: "delegate", title: "Déléguer", hint: "Urgent, pas important — déléguer", urgent: true, important: false, accent: "#F59E0B" },
  { key: "eliminate", title: "Éliminer", hint: "Ni urgent ni important — abandonner", urgent: false, important: false, accent: "#9CA3AF" },
];

const AXIS_BY_QUADRANT: Record<QuadrantKey, { urgent: boolean; important: boolean }> = {
  do: { urgent: true, important: true },
  schedule: { urgent: false, important: true },
  delegate: { urgent: true, important: false },
  eliminate: { urgent: false, important: false },
};

const URGENT_WITHIN_DAYS = 2;

/**
 * L'axe urgence se déduit de l'échéance tant que personne ne l'a fixé à la
 * main : sans ça une tâche « à faire avant vendredi » tombait dans « Éliminer »,
 * le seul quadrant que personne ne relit. Un glisser-déposer écrit `urgent` et
 * reprend alors la main — l'arbitrage de l'utilisateur prime toujours.
 */
function isUrgent(row: TodoRowData): boolean {
  if (typeof row.urgent === "boolean") return row.urgent;
  if (!row.dueDate) return false;
  const due = new Date(row.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const days = (due.getTime() - Date.now()) / 86_400_000;
  return days <= URGENT_WITHIN_DAYS;
}

function quadrantOf(row: TodoRowData): QuadrantKey {
  const urg = isUrgent(row);
  const imp = isImportant(row.importance);
  if (urg && imp) return "do";
  if (!urg && imp) return "schedule";
  if (urg && !imp) return "delegate";
  return "eliminate";
}

/**
 * Pointer-first collision: the quadrant whose full (padded) rectangle is under
 * the cursor wins — the entire visible card area is a valid drop target, not
 * just where the dragged card's rect happens to overlap. Falls back to the
 * nearest quadrant center so a release in the inter-quadrant gap (or just past
 * an edge) still resolves to the closest quadrant instead of silently failing.
 *
 * The default `rectIntersection` measures the dragged element's rect overlap,
 * which made drops near padding/edges land on the source quadrant (no-op) or
 * nothing (`over === null`) — felt like the drop zone wasn't the whole tile.
 */
const matrixCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
};

interface TodoMatrixProps {
  todos: TodoRowData[];
  onMove: (row: TodoRowData, target: { urgent: boolean; important: boolean }) => void;
  onToggle: (row: TodoRowData) => void;
  onEdit: (row: TodoRowData) => void;
  onEmail: (row: TodoRowData) => void;
  onContextMenu: (e: React.MouseEvent, row: TodoRowData) => void;
}

export function TodoMatrix({
  todos,
  onMove,
  onToggle,
  onEdit,
  onEmail,
  onContextMenu,
}: TodoMatrixProps) {
  // Souris et doigt sont volontairement séparés (au lieu d'un PointerSensor
  // unique) : au doigt, un seuil en distance déclenche le drag dès qu'on
  // commence à faire défiler la page, et comme les quadrants s'empilent sous
  // 768px la matrice occupe plusieurs écrans de haut. Le doigt passe donc par
  // un appui long (250ms), ce qui laisse le geste vertical au navigateur.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const byQuadrant = React.useMemo(() => {
    const map: Record<QuadrantKey, TodoRowData[]> = {
      do: [],
      schedule: [],
      delegate: [],
      eliminate: [],
    };
    for (const t of todos) map[quadrantOf(t)].push(t);
    return map;
  }, [todos]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const row = todos.find((t) => t.id === active.id);
    if (!row) return;
    const target = AXIS_BY_QUADRANT[over.id as QuadrantKey];
    if (!target) return;
    // Même source que `quadrantOf` : comparer `row.urgent` ici ferait passer
    // pour « déjà à sa place » une tâche urgente par sa date qu'on glisse vers
    // un quadrant non urgent, et le geste échouerait en silence.
    const curUrgent = isUrgent(row);
    const curImportant = isImportant(row.importance);
    if (target.urgent === curUrgent && target.important === curImportant) return;
    onMove(row, target);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={matrixCollision} onDragEnd={handleDragEnd}>
      <div className="grid h-full grid-cols-1 gap-3 md:grid-cols-2">
        {QUADRANTS.map((q) => (
          <Quadrant
            key={q.key}
            def={q}
            rows={byQuadrant[q.key]}
            onToggle={onToggle}
            onEdit={onEdit}
            onEmail={onEmail}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    </DndContext>
  );
}

interface QuadrantProps {
  def: QuadrantDef;
  rows: TodoRowData[];
  onToggle: (row: TodoRowData) => void;
  onEdit: (row: TodoRowData) => void;
  onEmail: (row: TodoRowData) => void;
  onContextMenu: (e: React.MouseEvent, row: TodoRowData) => void;
}

function Quadrant({ def, rows, onToggle, onEdit, onEmail, onContextMenu }: QuadrantProps) {
  const { setNodeRef, isOver } = useDroppable({ id: def.key });
  return (
    <div
      ref={setNodeRef}
      // Hauteur plancher réservée au desktop : sur téléphone les quadrants
      // s'empilent, et quatre blocs de 180px imposaient trois écrans de
      // défilement même quand la moitié est vide.
      className="flex min-h-0 flex-col rounded-xl border p-3 md:min-h-[180px]"
      style={{
        borderColor: isOver ? def.accent : "var(--border-subtle)",
        backgroundColor: isOver ? "var(--surface-2)" : "var(--surface-1)",
        transition: "var(--sn-transition-colors)",
      }}
    >
      <header className="mb-2 flex items-baseline gap-2">
        {/* Pastille de quadrant : porte la couleur Eisenhower (remplace
            l'ancienne bordure gauche 4px) */}
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 self-center rounded-full"
          style={{ backgroundColor: def.accent }}
        />
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {def.title}
        </h3>
        <span
          className="rounded-full px-1.5 text-[10px] font-medium tabular-nums"
          style={{ backgroundColor: "var(--surface-3)", color: "var(--text-muted)" }}
        >
          {rows.length}
        </span>
        <span
          className="ml-auto min-w-0 truncate text-[10px]"
          style={{ color: "var(--text-muted)" }}
        >
          {def.hint}
        </span>
      </header>
      <ul className="flex flex-1 flex-col gap-1">
        {rows.length === 0 ? (
          <li
            className="flex flex-1 items-center justify-center rounded-md border border-dashed py-2 text-[11px] md:py-6"
            style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
          >
            Déposer une tâche ici
          </li>
        ) : (
          rows.map((row) => (
            <MatrixCard
              key={row.id}
              row={row}
              onToggle={() => onToggle(row)}
              onEdit={() => onEdit(row)}
              onEmail={() => onEmail(row)}
              onContextMenu={(e) => onContextMenu(e, row)}
            />
          ))
        )}
      </ul>
    </div>
  );
}

interface MatrixCardProps {
  row: TodoRowData;
  onToggle: () => void;
  onEdit: () => void;
  onEmail: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function MatrixCard({ row, onToggle, onEdit, onEmail, onContextMenu }: MatrixCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: row.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
    cursor: "grab",
    // PAS `none` : ça coupait le défilement vertical partout où une carte se
    // trouve sous le doigt — sur téléphone les quadrants sont empilés, donc
    // avec un vrai backlog la quasi-totalité de la surface devenait non
    // scrollable. `manipulation` laisse passer le pan, et c'est le seuil de
    // 250ms du TouchSensor qui distingue « je défile » de « je déplace ».
    touchAction: "manipulation",
    // While dragging: no transform transition so the card tracks the pointer
    // 1:1. On release (isDragging false, transform cleared) the residual
    // offset eases back to rest with the signature glide. Opacity always
    // settles so the dim/restore at drag start/end isn't an abrupt snap.
    transition: isDragging
      ? "var(--sn-transition-opacity)"
      : "transform var(--sn-dur-2) var(--sn-ease-glide), var(--sn-transition-opacity)",
  };
  // The draggable node is the wrapper <li>; TodoRow renders as a <div> inside
  // it (the wrapper already provides the list-item slot).
  return (
    <li ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TodoRow
        as="div"
        row={row}
        multiline
        onToggle={onToggle}
        onEdit={onEdit}
        onEmail={onEmail}
        onContextMenu={onContextMenu}
      />
    </li>
  );
}

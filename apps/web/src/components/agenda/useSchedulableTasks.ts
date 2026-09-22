import { useMemo } from "react";
import type { CalEventRow } from "@supernote/ipc";
import { trpc } from "@/lib/trpc/client";
import { taskRefOf } from "@/lib/agenda/task-ref";
import { quadrantOf, type QuadrantKey } from "@/components/todos/TodoMatrix";
import type { TodoImportance, TodoRowData } from "@/components/todos/TodoRow";
import { useMailTodos } from "@/components/todos/useMailTodos";
import { useNoteChecklistTodos } from "@/components/todos/useNoteChecklistTodos";
import { useScheduledBlocks } from "./useScheduledBlocks";

export interface SchedulableTask {
  ref: string;
  title: string;
  quadrant: QuadrantKey;
  block: CalEventRow | null;
}

const IMPORTANCES: readonly TodoImportance[] = ["low", "medium", "high", "critical"];
const ignoreMailError = () => undefined;

function todoEntityRow(id: string, f: Record<string, unknown>): TodoRowData | null {
  if (f["done"] === true || f["done"] === "true") return null;
  // Anciennes tâches projetées depuis une note : la checklist de la note fait foi.
  if (typeof f["sourceNoteId"] === "string" && f["sourceNoteId"]) return null;
  const str = (k: string) => (typeof f[k] === "string" && f[k] ? (f[k] as string) : null);
  const urgent = f["urgent"];
  return {
    id,
    text: str("text") ?? "(sans texte)",
    done: false,
    sourceNoteId: null,
    line: null,
    blockId: null,
    startDate: str("startDate"),
    dueDate: str("dueDate"),
    priority: null,
    importance: IMPORTANCES.find((i) => i === f["importance"]) ?? "medium",
    urgent: urgent === true || urgent === "true" ? true : urgent === false || urgent === "false" ? false : null,
  };
}

export function useSchedulableTasks(): { tasks: SchedulableTask[]; openRefs: ReadonlySet<string> | null } {
  const todos = trpc.entities.list.useQuery({ typeId: "todo", limit: 5000, offset: 0 }, { staleTime: 30_000 });
  const notes = useNoteChecklistTodos();
  const mail = useMailTodos(ignoreMailError);
  const { blocks } = useScheduledBlocks();

  const tasks = useMemo(() => {
    const rows: TodoRowData[] = [
      ...(todos.data?.items ?? []).flatMap((e) => todoEntityRow(e.id, e.fields ?? {}) ?? []),
      ...notes.rows.filter((r) => !r.done),
      ...mail.rows.filter((r) => !r.done),
    ];
    // Deux lignes de même texte dans une note partagent la référence : une seule entrée.
    const byRef = new Map<string, SchedulableTask>();
    for (const row of rows) {
      const ref = taskRefOf(row);
      if (!byRef.has(ref)) {
        byRef.set(ref, { ref, title: row.text, quadrant: quadrantOf(row), block: blocks.get(ref) ?? null });
      }
    }
    return [...byRef.values()];
  }, [todos.data, notes.rows, mail.rows, blocks]);

  const loading = todos.isLoading || notes.isLoading;
  const openRefs = useMemo(() => (loading ? null : new Set(tasks.map((t) => t.ref))), [loading, tasks]);
  return { tasks, openRefs };
}

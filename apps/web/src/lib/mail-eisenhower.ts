/**
 * mail-eisenhower — la matrice d'Eisenhower du mail vit dans 4 labels Gmail, un
 * par quadrant. Le quadrant d'un thread se lit dans ses `labelIds` : même vue
 * depuis Supernote, Gmail ou Shortwave, sans store local.
 */

import { createLabel, listLabels, type GmailLabel } from "./gmail";
import { INBOX_LABEL } from "./mail-triage";

export type EisenhowerQuadrant = "do" | "schedule" | "delegate" | "eliminate";

export interface EisenhowerQuadrantDef {
  id: EisenhowerQuadrant;
  label: string;
  urgent: boolean;
  important: boolean;
}

/** Ordre de lecture de la grille 2×2, aligné sur `TodoMatrix`. */
export const QUADRANTS: readonly EisenhowerQuadrantDef[] = [
  { id: "do", label: "Faire", urgent: true, important: true },
  { id: "schedule", label: "Planifier", urgent: false, important: true },
  { id: "delegate", label: "Déléguer", urgent: true, important: false },
  { id: "eliminate", label: "Éliminer", urgent: false, important: false },
];

// Le préfixe numéroté garde l'ordre de la matrice dans les listes de labels
// triées alphabétiquement (Gmail, Shortwave).
export const TODO_LABEL_NAMES: Record<EisenhowerQuadrant, string> = {
  do: "Todo/1 Faire",
  schedule: "Todo/2 Planifier",
  delegate: "Todo/3 Déléguer",
  eliminate: "Todo/4 Éliminer",
};

export type TodoLabelIds = Partial<Record<EisenhowerQuadrant, string>>;

/** Paires `[id, nom]` : un `Map` id→nom ou `labels.map((l) => [l.id, l.name])`. */
type LabelPairs = Iterable<readonly [string, string]>;

// Gmail tient les noms de label pour uniques sans égard à la casse.
export function resolveTodoLabelIds(labels: LabelPairs): TodoLabelIds {
  const byName = new Map<string, string>();
  for (const [id, name] of labels) byName.set(name.toLowerCase(), id);
  const ids: TodoLabelIds = {};
  for (const q of QUADRANTS) {
    const id = byName.get(TODO_LABEL_NAMES[q.id].toLowerCase());
    if (id) ids[q.id] = id;
  }
  return ids;
}

export function todoLabelIdSet(ids: TodoLabelIds): Set<string> {
  return new Set(Object.values(ids).filter((id): id is string => Boolean(id)));
}

export function quadrantOfLabels(
  labelIds: readonly string[],
  ids: TodoLabelIds,
): EisenhowerQuadrant | null {
  for (const q of QUADRANTS) {
    const id = ids[q.id];
    if (id && labelIds.includes(id)) return q.id;
  }
  return null;
}

export type TodoLabels = Record<EisenhowerQuadrant, GmailLabel>;

/**
 * Renvoie les 4 labels todo, créés s'ils manquent. La liste locale peut être
 * périmée (label créé depuis Shortwave) : on relit Gmail avant de créer, sinon
 * `createLabel` prendrait un 409.
 */
export async function ensureTodoLabels(clientId: string, known: LabelPairs): Promise<TodoLabels> {
  let pairs: Array<readonly [string, string]> = [...known];
  if (Object.keys(resolveTodoLabelIds(pairs)).length < QUADRANTS.length) {
    pairs = (await listLabels(clientId)).map((l) => [l.id, l.name] as const);
  }
  const ids = resolveTodoLabelIds(pairs);
  const out = {} as TodoLabels;
  for (const q of QUADRANTS) {
    const id = ids[q.id];
    out[q.id] = id
      ? { id, name: TODO_LABEL_NAMES[q.id] }
      : await createLabel(clientId, TODO_LABEL_NAMES[q.id]);
  }
  return out;
}

/** Ranger dans `q` retire les trois autres labels ; `null` les retire tous. */
export function todoLabelChange(
  labels: TodoLabels,
  q: EisenhowerQuadrant | null,
): { addLabelIds: string[]; removeLabelIds: string[] } {
  return {
    addLabelIds: q ? [labels[q].id] : [],
    removeLabelIds: QUADRANTS.filter((d) => d.id !== q).map((d) => labels[d.id].id),
  };
}

export function applyLabelChange(
  labelIds: readonly string[],
  change: { addLabelIds: string[]; removeLabelIds: string[] },
): string[] {
  const remove = new Set(change.removeLabelIds);
  const kept = labelIds.filter((id) => !remove.has(id));
  return [...kept, ...change.addLabelIds.filter((id) => !kept.includes(id))];
}

const LEGACY_BINDINGS_KEY = "supernote.mail.todo-bindings";

function isQuadrant(v: unknown): v is EisenhowerQuadrant {
  return typeof v === "string" && QUADRANTS.some((q) => q.id === v);
}

function readLegacyBindings(): Array<{ threadId: string; quadrant: EisenhowerQuadrant }> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(LEGACY_BINDINGS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((b: unknown) => {
      if (typeof b !== "object" || b === null) return [];
      const { threadId, quadrant } = b as Record<string, unknown>;
      return typeof threadId === "string" && threadId && isQuadrant(quadrant)
        ? [{ threadId, quadrant }]
        : [];
    });
  } catch {
    return [];
  }
}

/**
 * Migration unique de l'ancien store localStorage (thread → tâche coffre) : on
 * pose le label du quadrant et on remet INBOX, que l'ancienne conversion
 * retirait. Un thread supprimé (404) est ignoré ; tout autre échec garde la clé
 * pour retenter, sinon les liaisons seraient perdues. Renvoie le nombre de
 * threads migrés.
 */
export async function migrateLegacyTodoBindings(
  labels: TodoLabels,
  modify: (threadId: string, change: { addLabelIds: string[]; removeLabelIds: string[] }) => Promise<void>,
): Promise<number> {
  const legacy = readLegacyBindings();
  let migrated = 0;
  let retryable = 0;
  for (const b of legacy) {
    const change = todoLabelChange(labels, b.quadrant);
    try {
      await modify(b.threadId, { ...change, addLabelIds: [...change.addLabelIds, INBOX_LABEL] });
      migrated++;
    } catch (e) {
      if (!/ 404/.test(String(e))) retryable++;
    }
  }
  if (retryable > 0) throw new Error(`${retryable} thread(s) non migré(s)`);
  try {
    window.localStorage.removeItem(LEGACY_BINDINGS_KEY);
  } catch {
    /* storage bloqué : on retentera au prochain montage */
  }
  return migrated;
}

export function hasLegacyTodoBindings(): boolean {
  try {
    return window.localStorage.getItem(LEGACY_BINDINGS_KEY) !== null;
  } catch {
    return false;
  }
}

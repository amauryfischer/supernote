/**
 * mail-todo-binding — store PUR + persistance localStorage des liaisons entre un
 * thread Gmail et une tâche (`todo`) de base créée depuis cet email.
 *
 * Pourquoi un store local (calqué sur le store snooze de `mail-triage.ts`) :
 *   La création d'une tâche depuis un email produit une entité `todo` dans le
 *   coffre, mais on a besoin de retrouver « ce thread a déjà une tâche, dans tel
 *   quadrant » côté UI mail sans re-requêter le coffre. C'est un store
 *   best-effort (localStorage), volontairement simple et testable : aucune
 *   dépendance React, aucun effet de bord réseau, jamais d'exception, et
 *   tolérant à l'absence de `window` (environnement non-DOM).
 *
 * Invariant : une seule liaison par `threadId` (dédoublonnage à l'écriture, la
 * dernière entrée gagne) — re-créer/déplacer une tâche pour un thread déjà lié
 * écrase la liaison précédente.
 */

import type { EisenhowerQuadrant } from "./mail-eisenhower";

/** Liaison persistée entre un thread et la tâche qu'il a engendrée. */
export interface MailTodoBinding {
  /** Identifiant du thread Gmail (clé d'unicité du store). */
  threadId: string;
  /** Identifiant de l'entité `todo` créée dans le coffre. */
  todoId: string;
  /** Quadrant Eisenhower courant de la tâche (miroir local, MAJ optimiste). */
  quadrant: EisenhowerQuadrant;
  /** Sujet de l'email au moment de la création (affichage rapide). */
  subject: string;
  /** Date de création de la liaison (epoch ms). */
  createdAt: number;
}

/** Clé localStorage du store des liaisons thread ↔ todo. */
export const MAIL_TODO_STORAGE_KEY = "supernote.mail.todo-bindings";

/** Quadrants valides, pour la garde de type runtime. */
const VALID_QUADRANTS: readonly EisenhowerQuadrant[] = [
  "do",
  "schedule",
  "delegate",
  "eliminate",
];

function isQuadrant(v: unknown): v is EisenhowerQuadrant {
  return typeof v === "string" && (VALID_QUADRANTS as readonly string[]).includes(v);
}

/** Garde de type runtime : `v` est une `MailTodoBinding` exploitable. */
function isBinding(v: unknown): v is MailTodoBinding {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.threadId === "string" &&
    o.threadId.length > 0 &&
    typeof o.todoId === "string" &&
    o.todoId.length > 0 &&
    isQuadrant(o.quadrant) &&
    typeof o.subject === "string" &&
    typeof o.createdAt === "number" &&
    Number.isFinite(o.createdAt)
  );
}

/**
 * Lit le store des liaisons depuis localStorage. Tolérant : JSON invalide,
 * valeur absente, entrées malformées → renvoie un tableau (filtré). Jamais
 * d'exception. PUR vis-à-vis de l'appelant (lecture seule de localStorage).
 */
export function loadBindings(): MailTodoBinding[] {
  if (typeof window === "undefined") return [];
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(MAIL_TODO_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBinding);
  } catch {
    return [];
  }
}

/**
 * Écrit l'ensemble du store. Best-effort (quota / storage désactivé →
 * silencieux). On dédoublonne par `threadId` (la dernière entrée gagne) pour
 * garantir l'invariant « une liaison par thread ».
 */
export function saveBindings(bindings: MailTodoBinding[]): void {
  if (typeof window === "undefined") return;
  const byThread = new Map<string, MailTodoBinding>();
  for (const b of bindings) {
    if (isBinding(b)) byThread.set(b.threadId, b);
  }
  try {
    window.localStorage.setItem(MAIL_TODO_STORAGE_KEY, JSON.stringify([...byThread.values()]));
  } catch {
    /* quota / storage désactivé — best-effort */
  }
}

/**
 * Ajoute (ou remplace) une liaison pour un thread, puis persiste. Renvoie la
 * liste mise à jour (utile pour les tests / l'état optimiste). Une entrée
 * malformée est ignorée silencieusement (no-op + retour de l'état courant).
 */
export function addBinding(b: MailTodoBinding): MailTodoBinding[] {
  if (!isBinding(b)) return loadBindings();
  const next = [...loadBindings().filter((e) => e.threadId !== b.threadId), b];
  saveBindings(next);
  return next;
}

/** Retire la liaison d'un thread (no-op si absente), puis persiste. */
export function removeBinding(threadId: string): MailTodoBinding[] {
  const next = loadBindings().filter((e) => e.threadId !== threadId);
  saveBindings(next);
  return next;
}

/** Renvoie la liaison d'un thread, ou `undefined` si absente. Lecture seule. */
export function getBinding(threadId: string): MailTodoBinding | undefined {
  return loadBindings().find((e) => e.threadId === threadId);
}

/**
 * Met à jour le quadrant de la liaison d'un thread (MAJ optimiste après un
 * déplacement de quadrant), puis persiste. No-op si le thread n'est pas lié.
 * Renvoie la liste mise à jour.
 */
export function updateBindingQuadrant(
  threadId: string,
  quadrant: EisenhowerQuadrant,
): MailTodoBinding[] {
  const next = loadBindings().map((e) =>
    e.threadId === threadId ? { ...e, quadrant } : e,
  );
  saveBindings(next);
  return next;
}

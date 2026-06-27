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

import { quadrantOf, type EisenhowerQuadrant } from "./mail-eisenhower";

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
  /** Aperçu compact du mail (snippet Gmail) — vue « quelques lignes ». Optionnel
   *  (liaisons créées avant cet ajout n'en ont pas). */
  snippet?: string;
  /** Résumé IA du fil (généré en arrière-plan à la conversion, best-effort).
   *  Préféré au snippet pour l'aperçu compact quand présent. Optionnel. */
  summary?: string;
  /** Nom de l'expéditeur/correspondant (clarté « c'est un email »). Optionnel. */
  fromName?: string;
  /** Email de l'expéditeur/correspondant. Optionnel. */
  fromEmail?: string;
  /** Date de création de la liaison (epoch ms). */
  createdAt: number;
}

/** Clé localStorage du store des liaisons thread ↔ todo. */
export const MAIL_TODO_STORAGE_KEY = "supernote.mail.todo-bindings";

/** Évènement `window` émis quand le store change de façon asynchrone (typiquement
 *  un résumé IA arrivé APRÈS la conversion) → les vues abonnées rechargent les
 *  liaisons sans dépendre d'une re-navigation. */
export const MAIL_BINDINGS_EVENT = "supernote:mail-bindings";

/** Notifie les vues abonnées qu'une liaison a changé. Best-effort, SSR-safe. */
function emitBindingsChanged(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(MAIL_BINDINGS_EVENT));
  } catch {
    /* environnement sans CustomEvent — best-effort */
  }
}

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
 * Met à jour le résumé IA de la liaison d'un thread (généré en arrière-plan
 * après la conversion), puis persiste ET notifie les vues abonnées via
 * `MAIL_BINDINGS_EVENT`. No-op si résumé vide ou thread non lié. Renvoie la
 * liste mise à jour.
 */
export function updateBindingSummary(
  threadId: string,
  summary: string,
): MailTodoBinding[] {
  const s = summary.trim();
  const current = loadBindings();
  if (!s || !current.some((e) => e.threadId === threadId)) return current;
  const next = current.map((e) =>
    e.threadId === threadId ? { ...e, summary: s } : e,
  );
  saveBindings(next);
  emitBindingsChanged();
  return next;
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

// ─── Provenance durable (miroir sur l'entité todo) ───────────────────────────
// Le store localStorage est volatil : vidage de cache, navigateur tiers, ou
// origine différente en dev (drift de port) → perte des liaisons, alors que les
// entités `todo` survivent dans le coffre. Pour que le board email-todo résiste à
// cette perte, la conversion écrit AUSSI la provenance email directement sur
// l'entité (`mail*`, durable). Au montage des vues, `reconcileBindings` recrée
// dans localStorage les liaisons manquantes depuis ces champs : le coffre est la
// source de vérité de l'existence, le localStorage reste un cache (quadrant
// optimiste + résumé IA).

/** Clés de champ persistées sur l'entité todo pour tracer son origine email. */
export const TODO_MAIL_FIELDS = {
  threadId: "mailThreadId",
  fromName: "mailFromName",
  fromEmail: "mailFromEmail",
  snippet: "mailSnippet",
} as const;

/** Construit les champs `mail*` à fusionner dans `fields` à la création de
 *  l'entité todo. Seules les valeurs présentes sont écrites (pas de clés vides).
 *  PUR. */
export function buildTodoProvenanceFields(input: {
  threadId: string;
  fromName?: string;
  fromEmail?: string;
  snippet?: string;
}): Record<string, string> {
  const out: Record<string, string> = { [TODO_MAIL_FIELDS.threadId]: input.threadId };
  if (input.fromName) out[TODO_MAIL_FIELDS.fromName] = input.fromName;
  if (input.fromEmail) out[TODO_MAIL_FIELDS.fromEmail] = input.fromEmail;
  if (input.snippet) out[TODO_MAIL_FIELDS.snippet] = input.snippet;
  return out;
}

/** Entité todo minimale exploitable par la réconciliation (sous-ensemble de
 *  `EntitySummary`) — découplé d'IPC pour rester testable sans coffre. */
export interface TodoProvenanceSource {
  id: string;
  fields?: Record<string, unknown> | null;
  createdAt?: string | number | null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Reconstruit une `MailTodoBinding` depuis les champs `mail*` d'une entité todo,
 *  ou `null` si l'entité n'a pas de provenance email exploitable (ou est faite).
 *  Le quadrant est dérivé des axes `urgent`/`importance` (inverse de la
 *  conversion). PUR. */
export function reconstructBindingFromEntity(
  src: TodoProvenanceSource,
): MailTodoBinding | null {
  const f = src.fields ?? {};
  const threadId = asString(f[TODO_MAIL_FIELDS.threadId]);
  if (!threadId) return null;
  // Tâche déjà faite → sa carte a été retirée du board, on ne la ressuscite pas.
  if (f["done"] === true || f["done"] === "true") return null;
  const urgent = f["urgent"] === true || f["urgent"] === "true";
  const snippet = asString(f[TODO_MAIL_FIELDS.snippet]);
  const fromName = asString(f[TODO_MAIL_FIELDS.fromName]);
  const fromEmail = asString(f[TODO_MAIL_FIELDS.fromEmail]);
  const createdAt =
    typeof src.createdAt === "number"
      ? src.createdAt
      : typeof src.createdAt === "string"
        ? Date.parse(src.createdAt) || 0
        : 0;
  const binding: MailTodoBinding = {
    threadId,
    todoId: src.id,
    quadrant: quadrantOf(urgent, asString(f["importance"])),
    subject: asString(f["text"]),
    ...(snippet ? { snippet } : {}),
    ...(fromName ? { fromName } : {}),
    ...(fromEmail ? { fromEmail } : {}),
    createdAt,
  };
  return isBinding(binding) ? binding : null;
}

/**
 * Réconcilie le store localStorage avec la provenance durable du coffre : pour
 * chaque entité todo portant un `mailThreadId` SANS liaison locale (ni par
 * thread, ni par todo), recrée la liaison. Ne touche JAMAIS une liaison existante
 * (localStorage gagne : il porte le quadrant optimiste + le résumé IA). Persiste
 * et notifie les vues abonnées (`MAIL_BINDINGS_EVENT`) si ≥1 ajout. Renvoie le
 * nombre d'ajouts.
 */
export function reconcileBindings(sources: readonly TodoProvenanceSource[]): number {
  const current = loadBindings();
  const knownThreads = new Set(current.map((b) => b.threadId));
  const knownTodos = new Set(current.map((b) => b.todoId));
  const additions: MailTodoBinding[] = [];
  for (const s of sources) {
    const b = reconstructBindingFromEntity(s);
    if (!b) continue;
    if (knownThreads.has(b.threadId) || knownTodos.has(b.todoId)) continue;
    additions.push(b);
    knownThreads.add(b.threadId);
    knownTodos.add(b.todoId);
  }
  if (additions.length === 0) return 0;
  saveBindings([...current, ...additions]);
  emitBindingsChanged();
  return additions.length;
}

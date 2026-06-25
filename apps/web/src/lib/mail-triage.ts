/**
 * mail-triage — logique PURE + persistance localStorage du triage d'un thread
 * Gmail (Done / Archive / Snooze).
 *
 * Modèle mental :
 *  - "Done"    : le thread est traité → on le retire de la boîte de réception
 *                (retrait du label système `INBOX`). Gmail conserve le fil dans
 *                « Tous les messages », rien n'est supprimé.
 *  - "Archive" : sémantiquement identique côté Gmail (retrait d'`INBOX`). On
 *                garde l'action séparée parce qu'elle a une intention UX
 *                différente (« je range » vs « c'est fini »).
 *  - "Snooze"  : on retire le thread de l'inbox MAINTENANT et on note localement
 *                une échéance `{threadId, until}`. La logique de ré-affichage à
 *                l'échéance est laissée à l'appelant (`listDue(now)` lui donne la
 *                liste des threads à faire réapparaître).
 *
 * Pourquoi un store local pour le snooze :
 *   Gmail n'expose pas de primitive « snooze » dans l'API REST publique (c'est
 *   une feature client). On émule donc l'échéance côté Supernote. C'est un store
 *   best-effort (localStorage), volontairement simple et testable : aucune
 *   dépendance React, aucun effet de bord réseau ici.
 *
 * Les mutations réseau (appel Gmail) vivent dans `applyTriage`, qui délègue à
 * `modifyThreadLabels` importé de `@/lib/gmail`. Le mapping action → labels est
 * isolé dans `actionToLabelOps`, 100 % pur et testé.
 */

import { modifyThreadLabels } from "./gmail";

/** Les trois actions de triage exposées par la barre d'actions du thread. */
export type TriageAction = "done" | "archive" | "snooze";

/** Label système Gmail retiré pour « sortir de la boîte de réception ». */
export const INBOX_LABEL = "INBOX";

/** Opérations de labels Gmail (forme attendue par `modifyThreadLabels`). */
export interface LabelOps {
  addLabelIds: string[];
  removeLabelIds: string[];
}

/**
 * Mappe une action de triage sur les opérations de labels Gmail correspondantes.
 * PUR — ne touche ni au réseau ni au localStorage. Done et Archive retirent
 * tous deux `INBOX` (Gmail ne distingue pas les deux) ; Snooze également (le
 * suivi de l'échéance est géré séparément par le store snooze).
 */
export function actionToLabelOps(action: TriageAction): LabelOps {
  switch (action) {
    case "done":
    case "archive":
    case "snooze":
      return { addLabelIds: [], removeLabelIds: [INBOX_LABEL] };
    default: {
      // Exhaustivité : si un nouveau membre d'union est ajouté sans branche,
      // TS lèvera une erreur ici (jamais atteint au runtime).
      const never: never = action;
      throw new Error(`Action de triage inconnue : ${String(never)}`);
    }
  }
}

// ─── Store snooze (persistance localStorage, PUR sur les helpers) ─────────────

/** Une entrée de snooze : un thread à faire réapparaître à `until` (epoch ms). */
export interface SnoozeEntry {
  threadId: string;
  /** Échéance en millisecondes (Date.now()). */
  until: number;
}

/** Clé localStorage du store snooze. */
export const SNOOZE_STORAGE_KEY = "supernote.mail.snooze";

/** Garde de type runtime : `v` est une `SnoozeEntry` exploitable. */
function isSnoozeEntry(v: unknown): v is SnoozeEntry {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.threadId === "string" && o.threadId.length > 0 && typeof o.until === "number" && Number.isFinite(o.until);
}

/**
 * Lit le store snooze depuis localStorage. Tolérant : JSON invalide, valeur
 * absente, entrées malformées → renvoie un tableau (filtré). Jamais d'exception.
 * PUR vis-à-vis de l'appelant (lecture seule de localStorage).
 */
export function loadSnoozed(): SnoozeEntry[] {
  if (typeof window === "undefined") return [];
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SNOOZE_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSnoozeEntry);
  } catch {
    return [];
  }
}

/**
 * Écrit l'ensemble du store snooze. Best-effort (quota / storage désactivé →
 * silencieux). On dédoublonne par `threadId` (la dernière entrée gagne) afin
 * qu'un re-snooze écrase l'échéance précédente.
 */
export function saveSnoozed(entries: SnoozeEntry[]): void {
  if (typeof window === "undefined") return;
  const byThread = new Map<string, SnoozeEntry>();
  for (const e of entries) {
    if (isSnoozeEntry(e)) byThread.set(e.threadId, e);
  }
  try {
    window.localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify([...byThread.values()]));
  } catch {
    /* quota / storage désactivé — best-effort */
  }
}

/**
 * Ajoute (ou remplace) une échéance de snooze pour un thread, puis persiste.
 * Renvoie la liste mise à jour (utile pour les tests / l'état optimiste).
 */
export function addSnooze(threadId: string, until: number): SnoozeEntry[] {
  const next = [...loadSnoozed().filter((e) => e.threadId !== threadId), { threadId, until }];
  saveSnoozed(next);
  return next;
}

/** Retire l'échéance de snooze d'un thread (no-op si absent), puis persiste. */
export function removeSnooze(threadId: string): SnoozeEntry[] {
  const next = loadSnoozed().filter((e) => e.threadId !== threadId);
  saveSnoozed(next);
  return next;
}

/**
 * Liste les threads dont l'échéance de snooze est atteinte (`until <= nowMs`).
 * PUR par rapport à `nowMs` (l'appelant injecte l'horloge → testable sans mock
 * global). Lecture seule du store.
 */
export function listDue(nowMs: number): SnoozeEntry[] {
  return loadSnoozed().filter((e) => e.until <= nowMs);
}

// ─── Calcul des échéances rapides (PUR, horloge injectée) ─────────────────────

/** Option de snooze proposée dans le Popover. */
export interface SnoozePreset {
  id: "tonight" | "tomorrow" | "monday";
  label: string;
  /** Calcule l'échéance (epoch ms) à partir d'une date « maintenant ». */
  computeUntil: (now: Date) => number;
}

/** Renvoie une copie de `now` à `hour:00:00.000`. PUR. */
function atHour(now: Date, hour: number): Date {
  const d = new Date(now.getTime());
  d.setHours(hour, 0, 0, 0);
  return d;
}

/**
 * « Ce soir » = 18 h aujourd'hui. Si on est déjà après 18 h, on bascule à 18 h
 * demain (sinon l'échéance serait déjà passée et le thread réapparaîtrait
 * immédiatement).
 */
export function tonight(now: Date): number {
  const target = atHour(now, 18);
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

/** « Demain » = 8 h le lendemain. PUR. */
export function tomorrowMorning(now: Date): number {
  const target = atHour(now, 8);
  target.setDate(target.getDate() + 1);
  return target.getTime();
}

/**
 * « Lundi prochain » = 8 h du prochain lundi STRICTEMENT futur. Si on est déjà
 * lundi, on vise le lundi de la semaine suivante (et non « tout à l'heure »).
 * PUR.
 */
export function nextMonday(now: Date): number {
  const target = atHour(now, 8);
  // getDay(): 0=dimanche … 1=lundi. Jours jusqu'au prochain lundi (1..7).
  const delta = ((1 - target.getDay() + 7) % 7) || 7;
  target.setDate(target.getDate() + delta);
  return target.getTime();
}

/** Presets de snooze, dans l'ordre d'affichage du Popover. */
export const SNOOZE_PRESETS: readonly SnoozePreset[] = [
  { id: "tonight", label: "Ce soir", computeUntil: tonight },
  { id: "tomorrow", label: "Demain", computeUntil: tomorrowMorning },
  { id: "monday", label: "Lundi prochain", computeUntil: nextMonday },
];

// ─── Exécution réseau (effet de bord isolé) ──────────────────────────────────

/**
 * Applique une action de triage côté Gmail (mutation des labels du thread).
 * Pour `snooze`, l'appelant doit appeler `addSnooze` séparément avec l'échéance
 * choisie — cette fonction ne gère QUE la mutation réseau, afin de rester
 * facilement composable et de garder le store local en dehors du chemin réseau.
 *
 * Lève en cas d'échec réseau (propage l'erreur de `modifyThreadLabels`) →
 * l'appelant affiche un toast et restaure l'état optimiste.
 */
export async function applyTriage(
  clientId: string,
  threadId: string,
  action: TriageAction,
): Promise<void> {
  const ops = actionToLabelOps(action);
  await modifyThreadLabels(clientId, threadId, ops);
}

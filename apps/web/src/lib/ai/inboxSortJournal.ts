/**
 * Journal du tri de l'inbox : déplacements faits, dossiers proposés, refus, et
 * état courant de la passe.
 *
 * Hors du composant, pour trois raisons : la spec garde le journal « pour la
 * durée de la session » alors que le toast qui l'ouvre ne dure que 12 s (d'où
 * les portes d'entrée barre du haut / tiroir mobile) ; les refus doivent
 * survivre à un remontage ; et les deux doivent être remis à zéro au
 * changement de coffre — un « Tout remettre » sur les ids du coffre précédent
 * n'a aucun sens.
 *
 * Les refus, eux, sont persistés : annuler puis recharger la page est le geste
 * le plus banal qui soit, et sans persistance la passe de démarrage refait le
 * déplacement 8 secondes plus tard (`temperature: 0` → même réponse).
 */

import { useSyncExternalStore } from "react";

export interface SortMove {
  noteId: string;
  title: string;
  fromFilePath: string;
  /**
   * Dossier d'origine, `""` pour la racine du coffre. Stocké au déplacement
   * plutôt que redérivé de `fromFilePath` : la racine n'a pas de séparateur,
   * et la redériver renvoyait la note dans `Inbox/` au lieu de sa place.
   */
  fromFolder: string;
  toFilePath: string;
  folder: string;
  passId: string;
  at: number;
  undone: boolean;
  /** La note a bougé après coup (main de l'utilisateur) : on n'y touche plus. */
  stale: boolean;
  /** La dernière tentative d'annulation a échoué ; la ligne reste réessayable. */
  failed?: boolean;
}

/** Une note portée par une proposition de dossier, figée au moment de la passe. */
export interface ProposedNote {
  id: string;
  title: string;
  filePath: string;
  /** Dossier d'origine, `""` pour la racine (même sémantique que `SortMove`). */
  fromFolder: string;
}

/**
 * Dossier que l'IA propose de créer, avec toutes les notes de la passe qui y
 * vont. Une seule carte par dossier : sept notes d'un même thème ne doivent
 * pas produire sept propositions.
 */
export interface ProposedFolder {
  id: string;
  /** Nom proposé. L'utilisateur peut le corriger avant de confirmer. */
  folder: string;
  notes: readonly ProposedNote[];
  passId: string;
  at: number;
}

/** Événement global qui ouvre la modale du journal, d'où qu'on le demande. */
export const OPEN_JOURNAL_EVENT = "supernote:open-inbox-sort-journal";

/** Demande une passe immédiate, sans attendre le repos ni l'intervalle. */
export const RUN_INBOX_SORT_EVENT = "supernote:run-inbox-sort";

/** Bornes : ni le journal ni les refus ne doivent croître sans fin. */
const MAX_JOURNAL_ENTRIES = 200;
const MAX_REFUSED_NOTES = 500;
const MAX_REFUSED_FOLDERS = 100;
const MAX_PROPOSALS = 20;

const REFUSALS_KEY_PREFIX = "supernote.ai.inboxSort.refused.";
const REFUSED_FOLDERS_KEY_PREFIX = "supernote.ai.inboxSort.refusedFolders.";
const PROPOSALS_KEY_PREFIX = "supernote.ai.inboxSort.proposals.";

let moves: readonly SortMove[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSortMoves(): readonly SortMove[] {
  return moves;
}

export function updateSortMoves(
  updater: (prev: readonly SortMove[]) => readonly SortMove[],
): void {
  moves = updater(moves).slice(0, MAX_JOURNAL_ENTRIES);
  emit();
}

export function useSortMoves(): readonly SortMove[] {
  return useSyncExternalStore(subscribe, getSortMoves, getSortMoves);
}

/** Déplacements encore en place ET annulables — le seul décompte affiché. */
export function pendingSortMoves(
  list: readonly SortMove[] = moves,
): readonly SortMove[] {
  return list.filter((m) => !m.undone && !m.stale);
}

/** 0 masque les portes d'entrée : pas de pastille pour un journal vide. */
export function useSortMovesPendingCount(): number {
  return pendingSortMoves(useSortMoves()).length;
}

export function openInboxSortJournal(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_JOURNAL_EVENT));
}

export function requestInboxSortNow(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(RUN_INBOX_SORT_EVENT));
}

// ── Propositions de dossier ──────────────────────────────────────────────────
// Persistées, contrairement au journal : une proposition est une décision qui
// ATTEND l'utilisateur. La perdre au rechargement, c'est perdre le seul moment
// où le tri a besoin de lui — et il n'a aucun moyen de la retrouver.

let proposals: readonly ProposedFolder[] = [];

/** Clé de comparaison des noms de dossier — la casse ne distingue pas. */
export function folderNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function getProposedFolders(): readonly ProposedFolder[] {
  return proposals;
}

export function updateProposedFolders(
  updater: (prev: readonly ProposedFolder[]) => readonly ProposedFolder[],
): void {
  proposals = updater(proposals).slice(0, MAX_PROPOSALS);
  persistProposals();
  emit();
}

export function useProposedFolders(): readonly ProposedFolder[] {
  return useSyncExternalStore(subscribe, getProposedFolders, getProposedFolders);
}

// Partagé, pas local à une surface : la proposition est offerte à la fois dans
// le panneau droit et dans le journal, et deux clics sur les deux surfaces
// créeraient le dossier deux fois.
let busyProposalId: string | null = null;

export function getBusyProposalId(): string | null {
  return busyProposalId;
}

export function setBusyProposalId(id: string | null): void {
  if (busyProposalId === id) return;
  busyProposalId = id;
  emit();
}

export function useBusyProposalId(): string | null {
  return useSyncExternalStore(subscribe, getBusyProposalId, getBusyProposalId);
}

// ── État de la passe ─────────────────────────────────────────────────────────
// Cinq `return` muets rendaient le tri indiscernable d'une fonctionnalité
// cassée. Chaque renoncement pose désormais une phase lisible dans la barre du
// haut.

export type InboxSortPhase =
  | "unknown"
  | "disabled"
  | "mobile"
  | "hidden"
  | "no-worker"
  | "ai-offline"
  | "waiting-idle"
  | "cooldown"
  | "peer-busy"
  | "running"
  | "empty-inbox"
  | "all-open"
  | "nothing-sortable"
  | "no-match"
  | "awaiting-confirmation"
  | "sorted";

/**
 * Vrai pour les phases qui décrivent le RÉSULTAT d'une passe, par opposition à
 * une attente. Le tick ne doit pas les écraser tant qu'elles sont fraîches :
 * « la passe démarre après 60 s sans frappe » est vrai en général et faux quand
 * la seule note d'inbox est ouverte — l'utilisateur attendrait une minute pour
 * rien, avec un message qui lui promet le contraire.
 */
export function isConclusivePhase(phase: InboxSortPhase): boolean {
  switch (phase) {
    case "empty-inbox":
    case "all-open":
    case "nothing-sortable":
    case "no-match":
    case "awaiting-confirmation":
    case "sorted":
    case "ai-offline":
      return true;
    default:
      return false;
  }
}

export interface InboxSortStatus {
  phase: InboxSortPhase;
  /** Ce que l'utilisateur peut faire, quand il peut faire quelque chose. */
  detail?: string;
  /** Dernière passe réellement exécutée (0 = aucune depuis l'ouverture). */
  lastPassAt: number;
  /** Résumé de cette passe, affiché sous l'état courant. */
  lastSummary?: string;
}

let status: InboxSortStatus = { phase: "unknown", lastPassAt: 0 };

export function getInboxSortStatus(): InboxSortStatus {
  return status;
}

/** Sans changement, aucun `emit` : le tick tourne toutes les 5 s. */
export function setInboxSortPhase(
  phase: InboxSortPhase,
  detail?: string,
): void {
  if (status.phase === phase && status.detail === detail) return;
  status = { ...status, phase, detail };
  emit();
}

export function noteInboxSortPass(summary: string): void {
  status = { ...status, lastPassAt: Date.now(), lastSummary: summary };
  emit();
}

export function useInboxSortStatus(): InboxSortStatus {
  return useSyncExternalStore(subscribe, getInboxSortStatus, getInboxSortStatus);
}

// ── Refus ────────────────────────────────────────────────────────────────────
// Annuler vaut refus : sans ça, la passe suivante refait le même déplacement
// sans même rappeler le modèle (décision en cache), et l'annulation devient
// décorative.

let vaultKey: string | null = null;
let refusals = new Map<string, Set<string>>();
/** Noms de dossiers proposés puis écartés — l'IA ne doit plus les proposer. */
let refusedFolders: readonly string[] = [];

function persistRefusals(): void {
  if (typeof window === "undefined" || !vaultKey) return;
  try {
    const flat: Record<string, string[]> = {};
    for (const [noteId, folders] of refusals) flat[noteId] = [...folders];
    window.localStorage.setItem(
      REFUSALS_KEY_PREFIX + vaultKey,
      JSON.stringify(flat),
    );
  } catch {
    /* quota plein ou stockage refusé : le refus reste valable en mémoire */
  }
}

function loadRefusals(): void {
  refusals = new Map();
  if (typeof window === "undefined" || !vaultKey) return;
  try {
    const raw = window.localStorage.getItem(REFUSALS_KEY_PREFIX + vaultKey);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return;
    for (const [noteId, folders] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!Array.isArray(folders)) continue;
      refusals.set(
        noteId,
        new Set(folders.filter((f): f is string => typeof f === "string")),
      );
    }
  } catch {
    /* contenu illisible : on repart d'un registre vide */
  }
}

function persistRefusedFolders(): void {
  if (typeof window === "undefined" || !vaultKey) return;
  try {
    window.localStorage.setItem(
      REFUSED_FOLDERS_KEY_PREFIX + vaultKey,
      JSON.stringify(refusedFolders),
    );
  } catch {
    /* quota plein ou stockage refusé : le refus reste valable en mémoire */
  }
}

function loadRefusedFolders(): void {
  refusedFolders = [];
  if (typeof window === "undefined" || !vaultKey) return;
  try {
    const raw = window.localStorage.getItem(REFUSED_FOLDERS_KEY_PREFIX + vaultKey);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    refusedFolders = parsed.filter((f): f is string => typeof f === "string");
  } catch {
    /* contenu illisible : on repart d'un registre vide */
  }
}

function isProposedNote(v: unknown): v is ProposedNote {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["id"] === "string" &&
    typeof o["title"] === "string" &&
    typeof o["filePath"] === "string" &&
    typeof o["fromFolder"] === "string"
  );
}

function isProposedFolder(v: unknown): v is ProposedFolder {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const notes = o["notes"];
  return (
    typeof o["id"] === "string" &&
    typeof o["folder"] === "string" &&
    typeof o["passId"] === "string" &&
    typeof o["at"] === "number" &&
    Array.isArray(notes) &&
    notes.every(isProposedNote)
  );
}

function persistProposals(): void {
  if (typeof window === "undefined" || !vaultKey) return;
  try {
    window.localStorage.setItem(
      PROPOSALS_KEY_PREFIX + vaultKey,
      JSON.stringify(proposals),
    );
  } catch {
    /* quota plein : la proposition reste valable pour la session */
  }
}

function loadProposals(): void {
  proposals = [];
  if (typeof window === "undefined" || !vaultKey) return;
  try {
    const raw = window.localStorage.getItem(PROPOSALS_KEY_PREFIX + vaultKey);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    proposals = parsed.filter(isProposedFolder).slice(0, MAX_PROPOSALS);
  } catch {
    /* contenu illisible : on repart sans proposition */
  }
}

/** Noms passés au prompt de proposition pour qu'il ne les reproduise pas. */
export function getRefusedFolderNames(): readonly string[] {
  return refusedFolders;
}

export function refuseProposedFolder(name: string): void {
  const key = folderNameKey(name);
  if (!key || refusedFolders.some((f) => folderNameKey(f) === key)) return;
  refusedFolders = [name.trim(), ...refusedFolders].slice(0, MAX_REFUSED_FOLDERS);
  persistRefusedFolders();
}

/**
 * Bascule le store sur un coffre. Vide le journal (ses ids appartiennent au
 * coffre précédent), puis recharge refus ET propositions du nouveau : une
 * décision en attente appartient au coffre, pas à l'onglet.
 */
export function bindSortJournalToVault(nextVaultId: string | null): void {
  if (vaultKey === nextVaultId) return;
  vaultKey = nextVaultId;
  moves = [];
  status = { phase: "unknown", lastPassAt: 0 };
  loadRefusals();
  loadRefusedFolders();
  loadProposals();
  emit();
}

export function refuseDestination(noteId: string, folder: string): void {
  const set = refusals.get(noteId) ?? new Set<string>();
  set.add(folder);
  refusals.set(noteId, set);
  while (refusals.size > MAX_REFUSED_NOTES) {
    const oldest = refusals.keys().next().value;
    if (oldest === undefined) break;
    refusals.delete(oldest);
  }
  persistRefusals();
}

export function isDestinationRefused(noteId: string, folder: string): boolean {
  return refusals.get(noteId)?.has(folder) === true;
}

/**
 * Vrai dès qu'un rangement de cette note a été annulé. La passe s'en sert pour
 * écarter la note AVANT d'appeler le modèle : à température nulle il rendrait
 * la même destination, et une note refusée coûterait deux appels par passe, à
 * vie.
 */
export function hasAnyRefusal(noteId: string): boolean {
  return (refusals.get(noteId)?.size ?? 0) > 0;
}

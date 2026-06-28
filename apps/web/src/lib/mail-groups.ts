/**
 * mail-groups — store PUR + persistance localStorage des « groupes » mail :
 * des vues nommées alimentées par un ou plusieurs labels Gmail. Brique du
 * système « zéro-inbox » : les emails portant un label routé sont SORTIS de
 * l'inbox (query `-label:…`) et regroupés dans l'onglet de leur groupe.
 *
 * Pourquoi un store local (calqué sur `mail-triage` / `mail-todo-binding`) :
 *   un groupe est une CONFIG DE VUE (préférence d'affichage), pas du contenu.
 *   Best-effort : aucune dépendance React, aucun effet réseau, jamais
 *   d'exception, tolérant à l'absence de `window` (SSR / tests node).
 *
 * Invariant : `id` unique (dédoublonnage à l'écriture, la dernière entrée gagne).
 */

/** Une vue nommée alimentée par des labels Gmail. */
export interface MailGroup {
  /** Identifiant stable (clé d'unicité, sert d'onglet `g:<id>`). */
  id: string;
  /** Nom affiché de l'onglet (ex. « Réunions », « Factures »). */
  name: string;
  /** Labels Gmail (ids) qui alimentent ce groupe. */
  labelIds: string[];
  /** Date de création (epoch ms). */
  createdAt: number;
}

/** Clé localStorage du store des groupes. */
export const MAIL_GROUPS_STORAGE_KEY = "supernote.mail.groups";

/** Évènement `window` émis quand le store change → vues abonnées rechargent. */
export const MAIL_GROUPS_EVENT = "supernote:mail-groups";

/** Notifie les vues abonnées d'un changement. Best-effort, SSR-safe. */
function emitGroupsChanged(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(MAIL_GROUPS_EVENT));
  } catch {
    /* environnement sans CustomEvent — best-effort */
  }
}

/** Garde de type runtime : `v` est un `MailGroup` exploitable. */
function isGroup(v: unknown): v is MailGroup {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    o.id.length > 0 &&
    typeof o.name === "string" &&
    Array.isArray(o.labelIds) &&
    o.labelIds.every((l) => typeof l === "string") &&
    typeof o.createdAt === "number" &&
    Number.isFinite(o.createdAt)
  );
}

/**
 * Lit le store depuis localStorage. Tolérant : JSON invalide / absent / entrées
 * malformées → tableau filtré. Jamais d'exception.
 */
export function loadGroups(): MailGroup[] {
  if (typeof window === "undefined") return [];
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(MAIL_GROUPS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isGroup);
  } catch {
    return [];
  }
}

/**
 * Écrit l'ensemble du store. Best-effort (quota / storage off → silencieux).
 * Dédoublonne par `id` (la dernière entrée gagne).
 */
export function saveGroups(groups: MailGroup[]): void {
  if (typeof window === "undefined") return;
  const byId = new Map<string, MailGroup>();
  for (const g of groups) {
    if (isGroup(g)) byId.set(g.id, g);
  }
  try {
    window.localStorage.setItem(MAIL_GROUPS_STORAGE_KEY, JSON.stringify([...byId.values()]));
  } catch {
    /* quota / storage désactivé — best-effort */
  }
}

/** Ajoute (ou remplace) un groupe, persiste, notifie. Renvoie la liste à jour. */
export function upsertGroup(g: MailGroup): MailGroup[] {
  if (!isGroup(g)) return loadGroups();
  const next = [...loadGroups().filter((e) => e.id !== g.id), g];
  saveGroups(next);
  emitGroupsChanged();
  return next;
}

/** Retire un groupe (no-op si absent), persiste, notifie. Renvoie la liste. */
export function removeGroup(id: string): MailGroup[] {
  const current = loadGroups();
  const next = current.filter((e) => e.id !== id);
  if (next.length !== current.length) {
    saveGroups(next);
    emitGroupsChanged();
  }
  return next;
}

/** Renvoie un groupe par id, ou `undefined`. Lecture seule. */
export function getGroup(id: string): MailGroup | undefined {
  return loadGroups().find((e) => e.id === id);
}

/** Tous les labelIds routés (union de tous les groupes), dédoublonnés. */
export function routedLabelIds(groups: readonly MailGroup[]): string[] {
  return [...new Set(groups.flatMap((g) => g.labelIds))];
}

// ─── Préfixe d'onglet de groupe ──────────────────────────────────────────────
// L'onglet mail actif est une chaîne : "inbox", "todo", ou "g:<id>" pour un
// groupe. Ces helpers encodent/décodent ce préfixe (purs).

/** Préfixe des onglets de groupe dans l'état `mailTab`. */
export const GROUP_TAB_PREFIX = "g:";

/** Construit la clé d'onglet d'un groupe. */
export function groupTabKey(id: string): string {
  return `${GROUP_TAB_PREFIX}${id}`;
}

/** Renvoie l'id du groupe si `tab` est un onglet de groupe, sinon `null`. */
export function groupIdFromTab(tab: string): string | null {
  return tab.startsWith(GROUP_TAB_PREFIX) ? tab.slice(GROUP_TAB_PREFIX.length) : null;
}

// ─── Filtrage des items par onglet (zéro-inbox) ──────────────────────────────
// L'inbox lit le mirror local (tous les fils INBOX) ; le routage se fait donc par
// labelId côté client, pas par requête Gmail. PUR, testable.

/** Vrai si l'item porte au moins un des labelIds donnés. */
function hasAnyLabel(labelIds: readonly string[], target: ReadonlySet<string>): boolean {
  return labelIds.some((l) => target.has(l));
}

/**
 * Filtre les items de l'inbox « zéro-inbox » : on RETIRE ceux portant un label
 * routé (affecté à un groupe) — ils vivent désormais dans l'onglet de leur
 * groupe. PUR.
 */
export function filterInboxItems<T extends { labelIds: string[] }>(
  items: readonly T[],
  groups: readonly MailGroup[],
): T[] {
  const routed = new Set(routedLabelIds(groups));
  if (routed.size === 0) return [...items];
  return items.filter((it) => !hasAnyLabel(it.labelIds, routed));
}

/**
 * Filtre les items d'un onglet de groupe : on GARDE ceux portant au moins un des
 * labels du groupe. Groupe inconnu / sans label → []. PUR.
 */
export function filterGroupItems<T extends { labelIds: string[] }>(
  items: readonly T[],
  group: MailGroup | undefined,
): T[] {
  const set = new Set(group?.labelIds ?? []);
  if (set.size === 0) return [];
  return items.filter((it) => hasAnyLabel(it.labelIds, set));
}

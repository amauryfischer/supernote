/**
 * mail-mute — fils IGNORÉS et expéditeurs BLOQUÉS (stores locaux).
 *
 * Pourquoi local : l'API Gmail n'expose ni le « mute » (fonction client Gmail,
 * pas de label système `MUTED` modifiable), ni les filtres de blocage sans le
 * scope `gmail.settings.basic`. On émule donc les deux côté Supernote :
 *
 *  - fil ignoré     : à chaque reconciliation, s'il revient en boîte de
 *                     réception, on le ré-archive (cf. `applyMuteRules`) ;
 *  - expéditeur bloqué : tout NOUVEAU fil de cet expéditeur est archivé dès
 *                     qu'il apparaît.
 *
 * Aucune donnée d'email n'est stockée : uniquement des identifiants de fil et
 * des adresses, en clair, dans le localStorage du navigateur.
 */

const MUTED_KEY = "supernote.mail.muted";
const BLOCKED_KEY = "supernote.mail.blocked";

/** Émis à chaque changement (les vues qui affichent l'état se rafraîchissent). */
export const MAIL_MUTE_EVENT = "supernote:mail-mute";

function readSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string" && v.length > 0));
  } catch {
    return new Set();
  }
}

function writeSet(key: string, values: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify([...values]));
    window.dispatchEvent(new CustomEvent(MAIL_MUTE_EVENT));
  } catch {
    /* quota / storage désactivé — best-effort */
  }
}

/** Normalise une adresse pour la comparaison (casse + espaces). PUR. */
export function normalizeAddress(email: string): string {
  return email.trim().toLowerCase();
}

// ── Fils ignorés ─────────────────────────────────────────────────────────────

export function loadMutedThreads(): Set<string> {
  return readSet(MUTED_KEY);
}

export function isThreadMuted(threadId: string): boolean {
  return loadMutedThreads().has(threadId);
}

export function muteThread(threadId: string): void {
  const s = loadMutedThreads();
  s.add(threadId);
  writeSet(MUTED_KEY, s);
}

export function unmuteThread(threadId: string): void {
  const s = loadMutedThreads();
  if (s.delete(threadId)) writeSet(MUTED_KEY, s);
}

// ── Expéditeurs bloqués ──────────────────────────────────────────────────────

export function loadBlockedSenders(): Set<string> {
  return readSet(BLOCKED_KEY);
}

export function isSenderBlocked(email: string): boolean {
  return loadBlockedSenders().has(normalizeAddress(email));
}

export function blockSender(email: string): void {
  const addr = normalizeAddress(email);
  if (!addr) return;
  const s = loadBlockedSenders();
  s.add(addr);
  writeSet(BLOCKED_KEY, s);
}

export function unblockSender(email: string): void {
  const s = loadBlockedSenders();
  if (s.delete(normalizeAddress(email))) writeSet(BLOCKED_KEY, s);
}

// ── Application des règles ───────────────────────────────────────────────────

/** Item minimal nécessaire pour décider d'un ré-archivage. */
export interface MutableThreadLike {
  id: string;
  from: { email: string };
  labelIds: string[];
}

/**
 * Parmi des fils de la boîte de réception, ceux qui doivent en RESSORTIR parce
 * qu'ils sont ignorés ou proviennent d'un expéditeur bloqué. PUR (les stores
 * sont passés en argument → testable sans localStorage).
 */
export function threadsToAutoArchive(
  items: MutableThreadLike[],
  muted: ReadonlySet<string>,
  blocked: ReadonlySet<string>,
): string[] {
  return items
    .filter(
      (it) =>
        it.labelIds.includes("INBOX") &&
        (muted.has(it.id) || blocked.has(normalizeAddress(it.from.email))),
    )
    .map((it) => it.id);
}

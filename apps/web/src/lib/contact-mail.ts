/**
 * Logique pure de la timeline mail d'un contact / organisation (« 360 »).
 *
 * À partir d'une ou plusieurs adresses email d'un contact, on :
 *  1. construit une requête Gmail (`from:x OR to:x …`) — voir `buildContactMailQuery` ;
 *  2. transforme la liste de threads renvoyée par Gmail en entrées de timeline
 *     triées (récent → ancien), avec un SENS entrant/sortant déduit du `From`
 *     vs le compte connecté (`selfEmail`) — voir `toContactTimeline`.
 *
 * Tout est pur & déterministe (aucun I/O) → testable sans réseau. L'appel réseau
 * (`searchThreads` / `listThreadSummaries`) vit dans le composant.
 */

import type { ThreadListItem } from "@/lib/gmail";

/**
 * Normalise une adresse pour comparaison/dédup : trim + minuscule. On ne
 * touche pas au contenu (pas de strip de sous-adressage `+tag`) — on reste
 * conservateur pour ne pas confondre deux boîtes distinctes.
 */
export function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

/** Dédup (insensible à la casse) + retrait des vides, en préservant l'ordre. */
export function dedupeEmails(emails: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const norm = normalizeEmail(raw);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/**
 * Construit la requête Gmail recherchant tous les threads échangés avec un
 * contact (reçus OU envoyés). Pour chaque adresse `a` on cherche `from:a` et
 * `to:a` (la recherche Gmail `to:` couvre aussi Cc), le tout en OR :
 *
 *   (from:a OR to:a OR from:b OR to:b)
 *
 * Retourne `""` si aucune adresse exploitable (l'appelant doit alors sauter
 * l'appel réseau). Les adresses sont dédupliquées (insensible à la casse).
 */
export function buildContactMailQuery(emails: readonly string[]): string {
  const addrs = dedupeEmails(emails);
  if (addrs.length === 0) return "";
  const clauses = addrs.flatMap((a) => [`from:${a}`, `to:${a}`]);
  return `(${clauses.join(" OR ")})`;
}

/** Sens d'un échange vis-à-vis du compte connecté. */
export type MailDirection = "incoming" | "outgoing" | "unknown";

/**
 * Déduit le sens d'un thread depuis l'expéditeur de son dernier message
 * (`from.email`, tel que rempli par `listThreadSummaries`) :
 *  - `outgoing` : expéditeur === compte connecté (c'est moi qui ai écrit) ;
 *  - `incoming` : expéditeur renseigné mais ≠ moi (le contact/un tiers) ;
 *  - `unknown`  : `selfEmail` absent, ou expéditeur vide.
 * Insensible à la casse. Pur.
 */
export function threadDirection(
  fromEmail: string,
  selfEmail: string | undefined,
): MailDirection {
  const from = normalizeEmail(fromEmail);
  const self = normalizeEmail(selfEmail ?? "");
  if (!from || !self) return "unknown";
  return from === self ? "outgoing" : "incoming";
}

/** Une entrée de la timeline mail d'un contact (1 thread = 1 entrée). */
export interface ContactMailEntry {
  /** threadId Gmail (clé stable, sert aussi de lien d'ouverture). */
  id: string;
  /** Sujet du thread (« (sans objet) » via Gmail si vide). */
  subject: string;
  /** Date ISO du dernier message (`""` si Gmail n'a pas fourni de date). */
  date: string;
  /** Aperçu (snippet du dernier message). */
  snippet: string;
  /** Nom affiché de l'expéditeur du dernier message (fallback : email). */
  fromName: string;
  /** Email de l'expéditeur du dernier message. */
  fromEmail: string;
  /** Sens entrant/sortant déduit de `fromEmail` vs `selfEmail`. */
  direction: MailDirection;
  /** labelIds (bruts) du thread — l'appelant peut les résoudre en noms. */
  labelIds: string[];
}

/**
 * Convertit la liste brute de threads (`listThreadSummaries`) en timeline
 * triée du plus récent au plus ancien. Les entrées sans date sont reléguées
 * en fin (tri stable). Pur & déterministe.
 *
 * `selfEmail` : compte connecté → renseigne le sens de chaque entrée.
 */
export function toContactTimeline(
  threads: readonly ThreadListItem[],
  selfEmail?: string,
): ContactMailEntry[] {
  const entries = threads.map<ContactMailEntry>((t) => ({
    id: t.id,
    subject: t.subject || "(sans objet)",
    date: t.date ?? "",
    snippet: t.snippet ?? "",
    fromName: t.from.name || t.from.email,
    fromEmail: t.from.email,
    direction: threadDirection(t.from.email, selfEmail),
    labelIds: t.labelIds ?? [],
  }));

  // Tri récent → ancien. Les dates vides ("") comparent comme « plus petites »
  // → renvoyées en fin. localeCompare inversé pour de l'ISO (tri lexical = tri
  // chronologique sur ISO 8601).
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      if (a.e.date === b.e.date) return a.i - b.i; // stable
      if (!a.e.date) return 1;
      if (!b.e.date) return -1;
      return a.e.date < b.e.date ? 1 : -1;
    })
    .map(({ e }) => e);
}

/** Statistiques d'en-tête de la timeline (compteurs entrants/sortants). */
export interface ContactMailStats {
  total: number;
  incoming: number;
  outgoing: number;
  /** Date ISO du dernier échange (`""` si aucune). */
  lastDate: string;
}

/** Agrège des compteurs simples pour l'en-tête de la timeline. Pur. */
export function contactMailStats(entries: readonly ContactMailEntry[]): ContactMailStats {
  let incoming = 0;
  let outgoing = 0;
  let lastDate = "";
  for (const e of entries) {
    if (e.direction === "incoming") incoming += 1;
    else if (e.direction === "outgoing") outgoing += 1;
    if (e.date && e.date > lastDate) lastDate = e.date;
  }
  return { total: entries.length, incoming, outgoing, lastDate };
}

/**
 * Recherche unifiée (PUR) — fusion, classement et déduplication de résultats
 * hétérogènes (emails Gmail, notes/entités du coffre, Bases / EntityTypes).
 *
 * Ce module ne fait AUCUN I/O : il ne connaît ni Gmail, ni tRPC, ni React. Les
 * appelants (cf. `useUnifiedSearch`) récupèrent les données brutes de chaque
 * source puis les passent aux mappeurs `emailToResult` / `searchResultToResult`
 * / `baseToResult`, et utilisent `mergeRankResults` pour produire la liste
 * finale affichée par la command palette.
 *
 * Politique de classement (du plus fort au plus faible) :
 *   1. correspondance dans le TITRE  >  correspondance dans le snippet ;
 *   2. à pertinence égale, le plus RÉCENT d'abord (résultats sans date après) ;
 *   3. tie-break stable par source puis par id (déterminisme des tests).
 *
 * 100 % testable — voir `unified-search.test.ts`.
 */

export type UnifiedSource = "email" | "note" | "base";

export interface UnifiedResult {
  source: UnifiedSource;
  /** Identifiant stable et unique POUR LA SOURCE (threadId, entityId, typeId). */
  id: string;
  title: string;
  subtitle?: string;
  /** Timestamp epoch (ms) pour le tri par récence. Absent ⇒ trié en dernier. */
  date?: number;
  /** Cible de navigation interne (route) ou URL externe (mailto/web). */
  href?: string;
}

// ── Mappeurs depuis les formes sources ────────────────────────────────────────

/** Forme minimale d'un thread Gmail (cf. ThreadListItem de @/lib/gmail). */
export interface EmailLike {
  id: string;
  subject: string;
  from: { name: string; email: string };
  /** ISO 8601 ou "" (cf. EmailMessage.date). */
  date: string;
  snippet: string;
}

/** Forme minimale d'un résultat FTS du coffre (cf. SearchResult de @supernote/ipc). */
export interface VaultResultLike {
  entityId: string;
  typeId: string;
  typeName: string;
  title: string;
  excerpts: string[];
}

/** Forme minimale d'une Base / EntityType (cf. EntityType de @supernote/ipc). */
export interface BaseLike {
  id: string;
  name: string;
  plural: string;
  icon?: string;
}

/** Parse une date ISO en epoch ms ; renvoie `undefined` si vide/non parsable. */
export function parseDate(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? undefined : t;
}

/** Email → résultat unifié. Le titre est le sujet ; le sous-titre l'expéditeur. */
export function emailToResult(item: EmailLike): UnifiedResult {
  const sender = item.from.name.trim() || item.from.email.trim();
  return {
    source: "email",
    id: item.id,
    title: item.subject.trim() || "(sans objet)",
    subtitle: sender ? `${sender}${item.snippet ? ` · ${item.snippet}` : ""}` : item.snippet,
    date: parseDate(item.date),
    href: `https://mail.google.com/mail/u/0/#all/${item.id}`,
  };
}

/**
 * Résultat FTS du coffre → résultat unifié. Une « personne »/« contact » pointe
 * vers /contacts/:id, tout le reste vers /notes/:id (politique de route alignée
 * sur components/search/ResultCard.tsx). La `source` reste "note" (catégorie UI).
 */
export function searchResultToResult(r: VaultResultLike): UnifiedResult {
  const t = r.typeId.toLowerCase();
  const href = t === "personne" || t === "contact" ? `/contacts/${r.entityId}` : `/notes/${r.entityId}`;
  const excerpt = r.excerpts.find((e) => e.trim().length > 0)?.trim();
  return {
    source: "note",
    id: r.entityId,
    title: r.title.trim() || "(sans titre)",
    subtitle: excerpt ? `${r.typeName} · ${excerpt}` : r.typeName,
    href,
  };
}

/** Base / EntityType → résultat unifié (navigue vers la table /bases/:typeId). */
export function baseToResult(b: BaseLike): UnifiedResult {
  return {
    source: "base",
    id: b.id,
    title: b.name.trim() || b.id,
    subtitle: b.plural.trim() || undefined,
    href: `/bases/${b.id}`,
  };
}

// ── Filtrage des Bases par nom (les EntityTypes n'ont pas de FTS) ──────────────

/**
 * Filtre une liste de Bases sur une requête (insensible casse/accents),
 * match sur le nom OU le pluriel. Vide/blanc ⇒ aucune Base (on n'inonde pas la
 * palette sans intention de recherche).
 */
export function filterBases(bases: BaseLike[], query: string): BaseLike[] {
  const q = normalize(query);
  if (!q) return [];
  return bases.filter((b) => normalize(b.name).includes(q) || normalize(b.plural).includes(q));
}

// ── Normalisation & scoring ────────────────────────────────────────────────────

/** Minuscule + suppression des diacritiques (NFD) + trim. Pur. */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Score de correspondance d'un résultat vis-à-vis d'une requête.
 *   - 3 : titre commence par la requête (préfixe) ;
 *   - 2 : titre contient la requête ;
 *   - 1 : sous-titre/snippet contient la requête ;
 *   - 0 : aucune correspondance (mais on garde le résultat — la source a déjà
 *         filtré côté serveur ; on classe juste plus bas).
 * Requête vide ⇒ score neutre (1) pour préserver l'ordre par récence.
 */
export function matchScore(result: UnifiedResult, query: string): number {
  const q = normalize(query);
  if (!q) return 1;
  const title = normalize(result.title);
  if (title.startsWith(q)) return 3;
  if (title.includes(q)) return 2;
  if (result.subtitle && normalize(result.subtitle).includes(q)) return 1;
  return 0;
}

// ── Déduplication ──────────────────────────────────────────────────────────────

/**
 * Déduplique par clé `source:id` en conservant la PREMIÈRE occurrence (donc
 * l'ordre d'entrée prime). Deux sources différentes avec le même id coexistent.
 */
export function dedupResults(results: UnifiedResult[]): UnifiedResult[] {
  const seen = new Set<string>();
  const out: UnifiedResult[] = [];
  for (const r of results) {
    const key = `${r.source}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ── Tri / classement ────────────────────────────────────────────────────────────

const SOURCE_TIE_ORDER: Record<UnifiedSource, number> = { note: 0, base: 1, email: 2 };

/**
 * Classe une liste (déjà dédupliquée ou non) par : score décroissant, puis
 * récence décroissante (sans date = dernier), puis tie-break stable
 * (source, id). Ne mute pas l'entrée. Déduplique d'abord pour un résultat sûr.
 */
export function rankResults(results: UnifiedResult[], query: string): UnifiedResult[] {
  const deduped = dedupResults(results);
  return deduped
    .map((r, i) => ({ r, i, score: matchScore(r, query) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const da = a.r.date ?? -Infinity;
      const db = b.r.date ?? -Infinity;
      if (db !== da) return db - da;
      const sa = SOURCE_TIE_ORDER[a.r.source];
      const sb = SOURCE_TIE_ORDER[b.r.source];
      if (sa !== sb) return sa - sb;
      if (a.r.id !== b.r.id) return a.r.id < b.r.id ? -1 : 1;
      return a.i - b.i;
    })
    .map((x) => x.r);
}

/**
 * Fusionne plusieurs lots hétérogènes en une liste classée et dédupliquée,
 * éventuellement bornée par `limit`. Point d'entrée principal pour la palette.
 */
export function mergeRankResults(
  batches: UnifiedResult[][],
  query: string,
  limit?: number,
): UnifiedResult[] {
  const merged = ([] as UnifiedResult[]).concat(...batches);
  const ranked = rankResults(merged, query);
  return typeof limit === "number" ? ranked.slice(0, Math.max(0, limit)) : ranked;
}

/**
 * ambientMargins — analyse IA "ambiante" d'une note : notes sémantiquement
 * proches non encore citées, et contradictions potentielles. Pas un chat :
 * un appel ponctuel, déclenché en arrière-plan pendant l'écriture.
 *
 * Pipeline :
 *  1. RAG local — embed du corps courant, cosinus vs embeddings des autres
 *     notes (déjà indexées via runIndex) → top candidats proches.
 *  2. Filtrage des notes déjà citées ([[wikilink]] dans le corps).
 *  3. Appel Ollama unique (JSON) pour qualifier liens manquants + contradictions.
 *
 * Les fonctions pures (extraction wikilinks, ranking) sont exportées et testées
 * isolément ; l'appel réseau reste dans `analyzeAmbient`.
 */

import { cosineSimilarity, parseEmbeddingField, embedQuery, DEFAULT_EMBED_MODEL } from "@/lib/rag";

export interface AmbientCandidate {
  id: string;
  title: string;
  score: number;
  excerpt: string;
}

export interface AmbientLink {
  id: string;
  title: string;
  reason: string;
}

export interface AmbientContradiction {
  id: string;
  title: string;
  issue: string;
}

export interface AmbientResult {
  links: AmbientLink[];
  contradictions: AmbientContradiction[];
}

export interface NoteLike {
  id: string;
  title: string;
  body: string;
  fields: Record<string, unknown>;
}

/** Titres déjà cités via [[wikilink]] (ou [[cible|alias]]) dans le corps, en minuscules. */
export function citedTitles(body: string): Set<string> {
  const out = new Set<string>();
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const t = m[1]?.trim().toLowerCase();
    if (t) out.add(t);
  }
  return out;
}

/** Nettoie un corps markdown en extrait plein-texte court. */
export function cleanExcerpt(body: string, max = 220): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/[#>*`~_[\]|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Classe les autres notes par proximité au vecteur courant, en excluant la
 * note elle-même et celles déjà citées. Pure (pas de réseau).
 */
export function rankCandidates(
  currentId: string,
  currentVec: number[],
  cited: Set<string>,
  others: readonly NoteLike[],
  opts: { minScore?: number; limit?: number } = {},
): AmbientCandidate[] {
  const minScore = opts.minScore ?? 0.62;
  const limit = opts.limit ?? 5;
  const scored: AmbientCandidate[] = [];
  for (const n of others) {
    if (n.id === currentId) continue;
    if (cited.has(n.title.trim().toLowerCase())) continue;
    const emb = parseEmbeddingField(n.fields["embedding"]);
    if (!emb) continue;
    const score = cosineSimilarity(currentVec, emb);
    if (score < minScore) continue;
    scored.push({ id: n.id, title: n.title, score, excerpt: cleanExcerpt(n.body) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function buildPrompt(currentTitle: string, currentBody: string, candidates: AmbientCandidate[]): string {
  const related = candidates
    .map((c, i) => `[${i + 1}] id=${c.id} titre="${c.title}"\n${c.excerpt}`)
    .join("\n\n");
  return `Tu es un assistant d'annotation de notes. Analyse la NOTE COURANTE par rapport aux NOTES CONNEXES (trouvées par similarité sémantique).

Détecte :
1. "links" — notes connexes vraiment pertinentes que la note courante devrait citer ([[lien]]) mais ne cite pas encore. Sois sélectif : seulement si le lien apporte vraiment.
2. "contradictions" — affirmations de la note courante qui contredisent une note connexe.

Réponds UNIQUEMENT en JSON valide, sans texte autour, schéma :
{"links":[{"id":"<id exact>","title":"<titre>","reason":"<pourquoi, 1 phrase courte>"}],"contradictions":[{"id":"<id exact>","title":"<titre>","issue":"<la contradiction, 1 phrase>"}]}
Si rien de pertinent : {"links":[],"contradictions":[]}.

NOTE COURANTE — titre="${currentTitle}"
${currentBody.slice(0, 1600)}

NOTES CONNEXES :
${related}`;
}

/** Parse tolérant de la réponse JSON du modèle (extrait le 1er objet). */
export function parseAmbientResponse(raw: string, validIds: Set<string>): AmbientResult {
  const empty: AmbientResult = { links: [], contradictions: [] };
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return empty;
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return empty;
  }
  if (typeof obj !== "object" || obj === null) return empty;
  const o = obj as { links?: unknown; contradictions?: unknown };
  const links: AmbientLink[] = Array.isArray(o.links)
    ? o.links
        .map((x): AmbientLink | null => {
          if (typeof x !== "object" || x === null) return null;
          const r = x as Record<string, unknown>;
          const id = typeof r["id"] === "string" ? r["id"] : "";
          if (!validIds.has(id)) return null;
          return {
            id,
            title: typeof r["title"] === "string" ? r["title"] : "",
            reason: typeof r["reason"] === "string" ? r["reason"] : "",
          };
        })
        .filter((x): x is AmbientLink => x !== null)
    : [];
  const contradictions: AmbientContradiction[] = Array.isArray(o.contradictions)
    ? o.contradictions
        .map((x): AmbientContradiction | null => {
          if (typeof x !== "object" || x === null) return null;
          const r = x as Record<string, unknown>;
          const id = typeof r["id"] === "string" ? r["id"] : "";
          if (!validIds.has(id)) return null;
          return {
            id,
            title: typeof r["title"] === "string" ? r["title"] : "",
            issue: typeof r["issue"] === "string" ? r["issue"] : "",
          };
        })
        .filter((x): x is AmbientContradiction => x !== null)
    : [];
  return { links, contradictions };
}

export interface AnalyzeOptions {
  current: NoteLike;
  others: readonly NoteLike[];
  host: string;
  model: string;
  signal?: AbortSignal;
}

/** Analyse complète : RAG local + appel Ollama. Lève en cas d'erreur réseau. */
export async function analyzeAmbient(opts: AnalyzeOptions): Promise<AmbientResult> {
  const { current, others, host, model, signal } = opts;
  const queryText = `${current.title}\n${cleanExcerpt(current.body, 600)}`.trim();
  if (!queryText) return { links: [], contradictions: [] };

  const vec = await embedQuery(queryText, host, DEFAULT_EMBED_MODEL);
  const cited = citedTitles(current.body);
  const candidates = rankCandidates(current.id, vec, cited, others);
  if (candidates.length === 0) return { links: [], contradictions: [] };

  const res = await fetch(`${host}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: buildPrompt(current.title, current.body, candidates),
      stream: false,
      options: { temperature: 0.2 },
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama generate HTTP ${res.status}`);
  const data = (await res.json()) as { response?: string };
  const validIds = new Set(candidates.map((c) => c.id));
  return parseAmbientResponse(data.response ?? "", validIds);
}

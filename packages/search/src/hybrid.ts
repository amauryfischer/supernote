import type { Database } from "better-sqlite3";
import type { EmbeddingEngine } from "./semantic/embedding-engine.js";
import { ftsQuery } from "./fts/query.js";
import { semanticQuery } from "./semantic/query.js";
import { parseQuery } from "./query/parser.js";
import { compileToFtsAndPredicates } from "./query/compiler.js";
import { isOk } from "@supernote/core";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface HybridResult {
  readonly entityId: string;
  readonly typeId: string;
  /** BM25 rank (negative, lower is better) — undefined when not in FTS results */
  readonly ftsRank?: number;
  /** Cosine similarity — undefined when not in semantic results */
  readonly semanticSimilarity?: number;
  /** Combined RRF score (higher = better) */
  readonly combinedScore: number;
}

export interface HybridSearchOptions {
  readonly limit?: number;
  /** Weight for semantic score in fusion (0..1). Default 0.4 */
  readonly semanticWeight?: number;
  readonly typeFilter?: string;
  readonly minSimilarity?: number;
}

// ---------------------------------------------------------------------------
// Reciprocal Rank Fusion
// ---------------------------------------------------------------------------

const RRF_K = 60; // standard constant

function rrfScore(rank: number): number {
  return 1 / (RRF_K + rank + 1);
}

/** Fuse FTS and semantic result lists using Reciprocal Rank Fusion. */
function fuseRrf(
  ftsResults: Array<{ entityId: string; typeId: string; rank: number }>,
  semResults: Array<{ entityId: string; typeId: string; similarity: number }>,
  semanticWeight: number,
): HybridResult[] {
  const ftsWeight = 1 - semanticWeight;
  const scores = new Map<
    string,
    {
      entityId: string;
      typeId: string;
      ftsRank?: number;
      semanticSimilarity?: number;
      ftsScore: number;
      semScore: number;
    }
  >();

  ftsResults.forEach((r, idx) => {
    scores.set(r.entityId, {
      entityId: r.entityId,
      typeId: r.typeId,
      ftsRank: r.rank,
      ftsScore: rrfScore(idx),
      semScore: 0,
    });
  });

  semResults.forEach((r, idx) => {
    const existing = scores.get(r.entityId);
    if (existing) {
      existing.semScore = rrfScore(idx);
      existing.semanticSimilarity = r.similarity;
    } else {
      scores.set(r.entityId, {
        entityId: r.entityId,
        typeId: r.typeId,
        semanticSimilarity: r.similarity,
        ftsScore: 0,
        semScore: rrfScore(idx),
      });
    }
  });

  return Array.from(scores.values())
    .map((s) => ({
      entityId: s.entityId,
      typeId: s.typeId,
      ftsRank: s.ftsRank,
      semanticSimilarity: s.semanticSimilarity,
      combinedScore: s.ftsScore * ftsWeight + s.semScore * semanticWeight,
    }))
    .sort((a, b) => b.combinedScore - a.combinedScore);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Hybrid search combining FTS5 and ONNX semantic search via RRF fusion.
 *
 * @param db - SQLite database (better-sqlite3)
 * @param embedder - Lazy-loaded embedding engine
 * @param query - Raw user query string
 * @param opts - Tuning options
 */
export async function hybridSearch(
  db: Database,
  embedder: EmbeddingEngine,
  query: string,
  opts: HybridSearchOptions = {},
): Promise<HybridResult[]> {
  const {
    limit = 20,
    semanticWeight = 0.4,
    typeFilter,
    minSimilarity = 0.2,
  } = opts;

  const ast = parseQuery(query);
  const freeTextStr = isOk(ast) ? ast.value.freeText.join(" ") : query;
  const compiled = isOk(ast)
    ? compileToFtsAndPredicates(ast.value)
    : { ftsExpr: query, sqlPredicates: [] };

  const ftsExpr = compiled.ftsExpr || query;

  // Run FTS and semantic search in parallel
  const [ftsResults, semResults] = await Promise.all([
    Promise.resolve(
      ftsQuery(db, ftsExpr, { limit: limit * 2, typeFilter }),
    ),
    semanticQuery(db, freeTextStr || query, embedder, {
      limit: limit * 2,
      minSimilarity,
      typeFilter,
    }),
  ]);

  const fused = fuseRrf(ftsResults, semResults, semanticWeight);
  return fused.slice(0, limit);
}

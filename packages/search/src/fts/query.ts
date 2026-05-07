import type { Database } from "better-sqlite3";
import type { FtsResult, FtsQueryOptions } from "./types.js";

interface FtsRow {
  entity_id: string;
  type_id: string;
  title: string;
  rank: number;
  snippet: string;
}

/**
 * Query the FTS5 index using BM25 ranking.
 * Supports all FTS5 operators: AND, OR, NOT, NEAR, phrase quotes, column filters.
 */
export function ftsQuery(
  db: Database,
  query: string,
  opts: FtsQueryOptions = {},
): FtsResult[] {
  const {
    limit = 20,
    typeFilter,
    highlightOpen = "<mark>",
    highlightClose = "</mark>",
  } = opts;

  if (!query.trim()) return [];

  const params: unknown[] = [query, highlightOpen, highlightClose, query];
  let typeClause = "";
  if (typeFilter) {
    typeClause = "AND type_id = ?";
    params.push(typeFilter);
  }
  params.push(limit);

  const sql = `
    SELECT
      entity_id,
      type_id,
      title,
      rank,
      snippet(entity_fts, 2, ?, ?, '...', 20) AS snippet
    FROM entity_fts
    WHERE entity_fts MATCH ?
    ${typeClause}
    ORDER BY rank
    LIMIT ?
  `;

  // Rebuild params in correct order: snippet open/close, MATCH query, typeFilter, limit
  const orderedParams: unknown[] = [
    highlightOpen,
    highlightClose,
    query,
  ];
  if (typeFilter) orderedParams.push(typeFilter);
  orderedParams.push(limit);

  try {
    const rows = db.prepare(sql).all(...orderedParams) as FtsRow[];
    return rows.map((r) => ({
      entityId: r.entity_id,
      typeId: r.type_id,
      title: r.title,
      rank: r.rank,
      snippet: r.snippet,
    }));
  } catch {
    // FTS5 throws on malformed queries — return empty rather than crash
    return [];
  }
}

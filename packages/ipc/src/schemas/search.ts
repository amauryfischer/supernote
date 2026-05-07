import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

export const SearchResultSchema = z.object({
  entityId: z.string(),
  typeId: z.string(),
  typeName: z.string(),
  filePath: z.string(),
  title: z.string(),
  /** Highlighted excerpts with context */
  excerpts: z.array(z.string()),
  /** Relevance score (0–1) */
  score: z.number().min(0).max(1),
  /** Whether this result came from semantic (vector) search */
  semantic: z.boolean().default(false),
  tags: z.array(z.string()),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

// ── Input schemas ─────────────────────────────────────────────────────────────

export const QuerySearchInput = z.object({
  query: z.string().min(1),
  typeId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(200).default(20),
  offset: z.number().int().nonnegative().default(0),
});
export type QuerySearchInput = z.infer<typeof QuerySearchInput>;

export const SemanticSearchInput = z.object({
  query: z.string().min(1),
  typeId: z.string().optional(),
  limit: z.number().int().positive().max(50).default(10),
});
export type SemanticSearchInput = z.infer<typeof SemanticSearchInput>;

export const HybridSearchInput = z.object({
  query: z.string().min(1),
  typeId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  /** Weight for semantic results (0 = pure FTS, 1 = pure semantic) */
  semanticWeight: z.number().min(0).max(1).default(0.5),
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().nonnegative().default(0),
});
export type HybridSearchInput = z.infer<typeof HybridSearchInput>;

// ── Output schemas ────────────────────────────────────────────────────────────

export const SearchOutput = z.object({
  items: z.array(SearchResultSchema),
  total: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().optional(),
});
export type SearchOutput = z.infer<typeof SearchOutput>;

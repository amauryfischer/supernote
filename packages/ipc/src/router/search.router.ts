import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  QuerySearchInput,
  SemanticSearchInput,
  HybridSearchInput,
  SearchOutput,
} from "../schemas/search.js";

export const searchRouter = router({
  /** Full-text search using SQLite FTS5. */
  query: publicProcedure
    .input(QuerySearchInput)
    .output(SearchOutput)
    .query(() => {
      throw notImplemented("search.query");
    }),

  /** Semantic vector search using ONNX embeddings (transformers.js). */
  semantic: publicProcedure
    .input(SemanticSearchInput)
    .output(SearchOutput)
    .query(() => {
      throw notImplemented("search.semantic");
    }),

  /** Hybrid search combining FTS5 + semantic results with configurable weighting. */
  hybrid: publicProcedure
    .input(HybridSearchInput)
    .output(SearchOutput)
    .query(() => {
      throw notImplemented("search.hybrid");
    }),
});

export type SearchRouter = typeof searchRouter;

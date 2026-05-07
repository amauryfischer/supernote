// FTS module
export {
  installFts,
  indexEntity,
  removeFromFts,
  ftsQuery,
} from "./fts/index.js";
export type {
  FtsResult,
  FtsQueryOptions,
  IndexEntityInput,
} from "./fts/index.js";

// Semantic module
export {
  EmbeddingEngine,
  DEFAULT_MODEL,
  cosineSimilarity,
  upsertEmbedding,
  loadEmbeddings,
  deleteEmbedding,
  semanticQuery,
  reembedEntity,
} from "./semantic/index.js";
export type {
  SemanticResult,
  SemanticQueryOptions,
} from "./semantic/index.js";

// Query language
export {
  parseQuery,
  compileToFtsAndPredicates,
  tokenize,
} from "./query/index.js";
export type {
  QueryAst,
  Filter,
  FilterKey,
  ComparisonOp,
  BoolNode,
  QueryParseError,
  QueryParseResult,
  CompiledQuery,
} from "./query/index.js";

// Hybrid search
export { hybridSearch } from "./hybrid.js";
export type { HybridResult, HybridSearchOptions } from "./hybrid.js";

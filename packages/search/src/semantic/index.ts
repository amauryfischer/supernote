export { EmbeddingEngine, DEFAULT_MODEL } from "./embedding-engine.js";
export { cosineSimilarity } from "./cosine.js";
export { upsertEmbedding, loadEmbeddings, deleteEmbedding } from "./storage.js";
export { semanticQuery, reembedEntity } from "./query.js";
export type {
  SemanticResult,
  SemanticQueryOptions,
  EmbeddingRow,
} from "./types.js";

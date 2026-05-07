/** A single semantic search result */
export interface SemanticResult {
  readonly entityId: string;
  readonly typeId: string;
  readonly similarity: number;
}

/** Options for semanticQuery */
export interface SemanticQueryOptions {
  readonly limit?: number;
  readonly minSimilarity?: number;
  readonly typeFilter?: string;
}

/** Row from the embedding table */
export interface EmbeddingRow {
  readonly id: string;
  readonly entityId: string;
  readonly model: string;
  readonly vector: string;
  readonly dim: number;
}

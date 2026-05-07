import type { Entity, EntityType } from "@supernote/core";

/** Row stored in entity_fts virtual table */
export interface FtsRow {
  readonly entityId: string;
  readonly title: string;
  readonly body: string;
  readonly tags: string;
  readonly fieldText: string;
  readonly typeId: string;
}

/** Single result from an FTS query */
export interface FtsResult {
  readonly entityId: string;
  readonly typeId: string;
  readonly title: string;
  /** BM25 rank — negative; lower is better */
  readonly rank: number;
  /** Highlighted snippet from body (FTS5 snippet()) */
  readonly snippet: string;
}

/** Options for ftsQuery */
export interface FtsQueryOptions {
  readonly limit?: number;
  readonly typeFilter?: string;
  readonly highlightOpen?: string;
  readonly highlightClose?: string;
}

/** Input for indexing an entity */
export interface IndexEntityInput {
  readonly entity: Entity;
  readonly schema: EntityType;
}

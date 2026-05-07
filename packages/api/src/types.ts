import type { Entity, EntityType, RelationEdge, RelationType, Tag } from "@supernote/core";

// ---- Logger -------------------------------------------------

export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

// ---- Pagination / filter ------------------------------------

export interface ListEntitiesFilter {
  type?: string;
  tag?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface SearchOptions {
  query: string;
  kind?: "fts" | "semantic" | "hybrid";
  limit?: number;
}

// ---- Resolvers ----------------------------------------------

export interface Resolvers {
  listEntities(filter: ListEntitiesFilter): Promise<Entity[]>;
  getEntity(id: string): Promise<Entity | null>;
  createEntity(data: CreateEntityInput): Promise<Entity>;
  updateEntity(id: string, data: UpdateEntityInput): Promise<Entity | null>;
  deleteEntity(id: string): Promise<boolean>;

  listSchemas(): Promise<EntityType[]>;
  getSchema(id: string): Promise<EntityType | null>;

  search(opts: SearchOptions): Promise<Entity[]>;

  listRelations(sourceId: string): Promise<RelationEdge[]>;
  getBacklinks(entityId: string): Promise<RelationEdge[]>;
  createRelation(data: CreateRelationInput): Promise<RelationEdge>;

  listTags(): Promise<Tag[]>;

  listRelationTypes(): Promise<RelationType[]>;
}

export interface CreateEntityInput {
  typeId: string;
  fields: Record<string, unknown>;
  body: string;
  tags?: string[];
}

export interface UpdateEntityInput {
  fields?: Record<string, unknown>;
  body?: string;
  tags?: string[];
}

export interface CreateRelationInput {
  sourceId: string;
  targetId: string;
  relationTypeId: string;
  fields?: Record<string, unknown>;
}

// ---- Event bus ----------------------------------------------

export type EventKind =
  | "entity.created"
  | "entity.updated"
  | "entity.deleted"
  | "relation.created"
  | "relation.deleted";

export interface VaultEvent {
  kind: EventKind;
  entityId?: string;
  payload: unknown;
  timestamp: string;
}

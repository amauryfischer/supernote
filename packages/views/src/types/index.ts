import type { Entity, EntityType } from "@supernote/core/types";

// ---- Filter & Sort -------------------------------------------------

export type FilterOperator =
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "isEmpty"
  | "isNotEmpty"
  | "in"
  | "notIn";

export interface FilterClause {
  readonly fieldId: string;
  readonly operator: FilterOperator;
  readonly value?: string | number | boolean | string[] | number[];
}

export type SortDirection = "asc" | "desc";

export interface SortClause {
  readonly fieldId: string;
  readonly direction: SortDirection;
}

// ---- Column config -------------------------------------------------

export interface ColumnConfig {
  readonly fieldId: string;
  readonly width?: number;
  readonly hidden?: boolean;
  readonly label?: string;
}

// ---- Card config ---------------------------------------------------

export interface CardConfig {
  readonly titleFieldId?: string;
  readonly subtitleFieldId?: string;
  readonly coverImageFieldId?: string;
  readonly colCount?: number;
  readonly fields?: string[];
}

// ---- Graph config --------------------------------------------------

export interface GraphConfig {
  readonly nodeLabelFieldId?: string;
  readonly nodeColorFieldId?: string;
  readonly nodeSize?: number;
  readonly showRelationLabels?: boolean;
}

// ---- View definition -----------------------------------------------

export type ViewKind =
  | "table"
  | "kanban"
  | "gallery"
  | "calendar"
  | "timeline"
  | "graph";

export interface ViewDefinition {
  readonly id: string;
  readonly name: string;
  readonly kind: ViewKind;
  readonly filters?: FilterClause[];
  readonly sort?: SortClause[];
  readonly groupBy?: string;
  readonly columns?: ColumnConfig[];
  readonly cardConfig?: CardConfig;
  readonly dateField?: string;
  readonly endDateField?: string;
  readonly graphConfig?: GraphConfig;
}

// ---- Graph edge (for graph view) -----------------------------------

export interface RelationEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly relationTypeId: string;
  readonly label?: string;
}

// ---- View props ----------------------------------------------------

export interface ViewProps<T extends Entity = Entity> {
  readonly view: ViewDefinition;
  readonly entities: T[];
  readonly schema: EntityType;
  readonly edges?: RelationEdge[];
  readonly onEntityClick?: (entity: T) => void;
  readonly onEntityChange?: (entity: T) => void;
  readonly onEntityCreate?: (groupKey?: string) => void;
  readonly onEntityDelete?: (entity: T) => void;
}

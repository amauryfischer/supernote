import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

export const CardinalitySchema = z.enum(["one-to-one", "one-to-many", "many-to-many"]);
export type Cardinality = z.infer<typeof CardinalitySchema>;

export const RelationTypeSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  forwardLabel: z.string().min(1),
  inverseLabel: z.string().min(1),
  sourceTypeId: z.string().optional(),
  targetTypeId: z.string().optional(),
  cardinality: CardinalitySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RelationType = z.infer<typeof RelationTypeSchema>;

export const RelationEdgeSchema = z.object({
  id: z.string(),
  relationTypeId: z.string(),
  relationTypeName: z.string(),
  sourceId: z.string(),
  targetId: z.string(),
  fields: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().datetime(),
});
export type RelationEdge = z.infer<typeof RelationEdgeSchema>;

// ── Input schemas ─────────────────────────────────────────────────────────────

export const CreateRelationInput = z.object({
  relationTypeId: z.string().min(1),
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  fields: z.record(z.string(), z.unknown()).optional(),
});
export type CreateRelationInput = z.infer<typeof CreateRelationInput>;

export const DeleteRelationInput = z.object({
  id: z.string().min(1),
});
export type DeleteRelationInput = z.infer<typeof DeleteRelationInput>;

export const ListRelationsForEntityInput = z.object({
  entityId: z.string().min(1),
  relationTypeId: z.string().optional(),
  direction: z.enum(["source", "target", "both"]).default("both"),
});
export type ListRelationsForEntityInput = z.infer<typeof ListRelationsForEntityInput>;

export const ListAllRelationsInput = z.object({
  relationTypeId: z.string().optional(),
  limit: z.number().int().positive().max(1000).default(100),
  offset: z.number().int().nonnegative().default(0),
});
export type ListAllRelationsInput = z.infer<typeof ListAllRelationsInput>;

// ── Output schemas ────────────────────────────────────────────────────────────

export const ListRelationsOutput = z.array(RelationEdgeSchema);
export type ListRelationsOutput = z.infer<typeof ListRelationsOutput>;

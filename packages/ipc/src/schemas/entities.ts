import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

export const FieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.string()),
]);
export type FieldValue = z.infer<typeof FieldValueSchema>;

export const EntitySchema = z.object({
  id: z.string(),
  typeId: z.string(),
  typeName: z.string(),
  filePath: z.string(),
  fields: z.record(z.string(), FieldValueSchema),
  body: z.string(),
  tags: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Entity = z.infer<typeof EntitySchema>;

export const EntitySummarySchema = EntitySchema.omit({ body: true });
export type EntitySummary = z.infer<typeof EntitySummarySchema>;

export const SortOrderSchema = z.enum(["asc", "desc"]);
export type SortOrder = z.infer<typeof SortOrderSchema>;

export const PaginationSchema = z.object({
  limit: z.number().int().positive().max(1000).default(50),
  offset: z.number().int().nonnegative().default(0),
});
export type Pagination = z.infer<typeof PaginationSchema>;

// ── Input schemas ─────────────────────────────────────────────────────────────

export const ListEntitiesInput = z
  .object({
    typeId: z.string().optional(),
    typeName: z.string().optional(),
    tags: z.array(z.string()).optional(),
    sortBy: z.string().optional(),
    sortOrder: SortOrderSchema.optional(),
  })
  .merge(PaginationSchema);
export type ListEntitiesInput = z.infer<typeof ListEntitiesInput>;

export const GetEntityInput = z.object({
  id: z.string().min(1),
});
export type GetEntityInput = z.infer<typeof GetEntityInput>;

export const CreateEntityInput = z.object({
  typeId: z.string().min(1),
  fields: z.record(z.string(), FieldValueSchema),
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type CreateEntityInput = z.infer<typeof CreateEntityInput>;

export const UpdateEntityInput = z.object({
  id: z.string().min(1),
  fields: z.record(z.string(), FieldValueSchema).optional(),
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type UpdateEntityInput = z.infer<typeof UpdateEntityInput>;

export const DeleteEntityInput = z.object({
  id: z.string().min(1),
  moveToTrash: z.boolean().optional().default(true),
});
export type DeleteEntityInput = z.infer<typeof DeleteEntityInput>;

export const SearchEntitiesInput = z.object({
  query: z.string().min(1),
  typeId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(200).default(20),
});
export type SearchEntitiesInput = z.infer<typeof SearchEntitiesInput>;

export const GetRelatedInput = z.object({
  id: z.string().min(1),
  relationTypeId: z.string().optional(),
});
export type GetRelatedInput = z.infer<typeof GetRelatedInput>;

export const GetBacklinksInput = z.object({
  id: z.string().min(1),
});
export type GetBacklinksInput = z.infer<typeof GetBacklinksInput>;

// ── Output schemas ────────────────────────────────────────────────────────────

export const ListEntitiesOutput = z.object({
  items: z.array(EntitySummarySchema),
  total: z.number().int().nonnegative(),
});
export type ListEntitiesOutput = z.infer<typeof ListEntitiesOutput>;

export const SearchEntitiesOutput = z.object({
  items: z.array(EntitySummarySchema),
  total: z.number().int().nonnegative(),
});
export type SearchEntitiesOutput = z.infer<typeof SearchEntitiesOutput>;

export const BacklinkSchema = z.object({
  sourceId: z.string(),
  sourceFilePath: z.string(),
  context: z.string().optional(),
});
export type Backlink = z.infer<typeof BacklinkSchema>;

export const GetBacklinksOutput = z.array(BacklinkSchema);
export type GetBacklinksOutput = z.infer<typeof GetBacklinksOutput>;

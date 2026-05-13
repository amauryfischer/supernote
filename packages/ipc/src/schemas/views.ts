import { z } from "zod";

// ── ViewKind ──────────────────────────────────────────────────────────────────

export const ViewKindSchema = z.enum(["table", "board", "gallery", "calendar", "list"]);
export type ViewKind = z.infer<typeof ViewKindSchema>;

export const RowHeightSchema = z.enum(["short", "normal", "tall"]);
export type RowHeight = z.infer<typeof RowHeightSchema>;

// ── FilterClause / SortClause ─────────────────────────────────────────────────

export const FilterOpSchema = z.enum([
  "eq",
  "neq",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "gt",
  "lt",
  "gte",
  "lte",
  "is_empty",
  "is_not_empty",
  "in",
  "not_in",
]);
export type FilterOp = z.infer<typeof FilterOpSchema>;

export const FilterClauseSchema = z.object({
  fieldId: z.string().min(1),
  op: FilterOpSchema,
  value: z.unknown().optional(),
});
export type FilterClause = z.infer<typeof FilterClauseSchema>;

export const SortClauseSchema = z.object({
  fieldId: z.string().min(1),
  direction: z.enum(["asc", "desc"]),
});
export type SortClause = z.infer<typeof SortClauseSchema>;

// ── ViewDefinition (saved view) ───────────────────────────────────────────────

export const ViewSchema = z.object({
  id: z.string(),
  typeId: z.string(),
  name: z.string().min(1),
  icon: z.string().optional(),
  kind: ViewKindSchema,
  filters: z.array(FilterClauseSchema).default([]),
  sorts: z.array(SortClauseSchema).default([]),
  visibleFields: z.array(z.string()).default([]),
  hiddenFields: z.array(z.string()).default([]),
  groupByField: z.string().optional(),
  rowHeight: RowHeightSchema.default("normal"),
  isSystem: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type View = z.infer<typeof ViewSchema>;

// ── Input / output schemas ────────────────────────────────────────────────────

export const ListViewsInput = z.object({
  typeId: z.string().optional(),
});
export type ListViewsInput = z.infer<typeof ListViewsInput>;

export const ListViewsOutput = z.array(ViewSchema);
export type ListViewsOutput = z.infer<typeof ListViewsOutput>;

export const GetViewInput = z.object({
  id: z.string().min(1),
});
export type GetViewInput = z.infer<typeof GetViewInput>;

export const CreateViewInput = z.object({
  typeId: z.string().min(1),
  name: z.string().min(1),
  icon: z.string().optional(),
  kind: ViewKindSchema.default("table"),
  filters: z.array(FilterClauseSchema).default([]),
  sorts: z.array(SortClauseSchema).default([]),
  visibleFields: z.array(z.string()).default([]),
  hiddenFields: z.array(z.string()).default([]),
  groupByField: z.string().optional(),
  rowHeight: RowHeightSchema.default("normal"),
});
export type CreateViewInput = z.infer<typeof CreateViewInput>;

export const UpdateViewInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  icon: z.string().optional(),
  kind: ViewKindSchema.optional(),
  filters: z.array(FilterClauseSchema).optional(),
  sorts: z.array(SortClauseSchema).optional(),
  visibleFields: z.array(z.string()).optional(),
  hiddenFields: z.array(z.string()).optional(),
  groupByField: z.string().nullable().optional(),
  rowHeight: RowHeightSchema.optional(),
});
export type UpdateViewInput = z.infer<typeof UpdateViewInput>;

export const DeleteViewInput = z.object({
  id: z.string().min(1),
});
export type DeleteViewInput = z.infer<typeof DeleteViewInput>;

export const EnsureDefaultViewInput = z.object({
  typeId: z.string().min(1),
});
export type EnsureDefaultViewInput = z.infer<typeof EnsureDefaultViewInput>;

// ── entities.queryForView ─────────────────────────────────────────────────────

export const QueryForViewInput = z.object({
  typeId: z.string().min(1),
  filters: z.array(FilterClauseSchema).default([]),
  sorts: z.array(SortClauseSchema).default([]),
  limit: z.number().int().positive().max(5000).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type QueryForViewInput = z.infer<typeof QueryForViewInput>;

/**
 * Lightweight row shape returned by `views.queryForView`. Mirrors the
 * canonical `EntitySummary` from `schemas/entities.ts` but kept local with a
 * looser typing so we don't pull a heavy schema-extension chain into the
 * views module. Exported only as a type.
 */
const QueryForViewRowSchema = z.object({
  id: z.string(),
  typeId: z.string(),
  typeName: z.string().optional(),
  filePath: z.string(),
  fields: z.record(z.string(), z.unknown()),
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type QueryForViewRow = z.infer<typeof QueryForViewRowSchema>;

export const QueryForViewOutput = z.object({
  items: z.array(QueryForViewRowSchema),
  total: z.number().int().nonnegative(),
});
export type QueryForViewOutput = z.infer<typeof QueryForViewOutput>;

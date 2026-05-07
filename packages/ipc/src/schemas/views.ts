import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

export const ViewTypeSchema = z.enum([
  "table",
  "kanban",
  "gallery",
  "calendar",
  "timeline",
  "graph",
  "map",
  "dashboard",
]);
export type ViewType = z.infer<typeof ViewTypeSchema>;

export const FilterConditionSchema = z.object({
  field: z.string(),
  operator: z.enum([
    "eq",
    "neq",
    "lt",
    "lte",
    "gt",
    "gte",
    "contains",
    "startsWith",
    "endsWith",
    "isEmpty",
    "isNotEmpty",
    "in",
    "notIn",
  ]),
  value: z.unknown().optional(),
});
export type FilterCondition = z.infer<typeof FilterConditionSchema>;

export const SortConfigSchema = z.object({
  field: z.string(),
  direction: z.enum(["asc", "desc"]),
});
export type SortConfig = z.infer<typeof SortConfigSchema>;

export const ViewConfigSchema = z.object({
  columns: z.array(z.string()).optional(),
  filters: z.array(FilterConditionSchema).optional(),
  sorts: z.array(SortConfigSchema).optional(),
  groupBy: z.string().optional(),
  groupDirection: z.enum(["asc", "desc"]).optional(),
});
export type ViewConfig = z.infer<typeof ViewConfigSchema>;

export const ViewSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  type: ViewTypeSchema,
  /** The EntityType this view is bound to, if any */
  typeId: z.string().optional(),
  config: ViewConfigSchema,
  isDefault: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type View = z.infer<typeof ViewSchema>;

// ── Input schemas ─────────────────────────────────────────────────────────────

export const ListViewsInput = z.object({
  typeId: z.string().optional(),
  viewType: ViewTypeSchema.optional(),
});
export type ListViewsInput = z.infer<typeof ListViewsInput>;

export const GetViewInput = z.object({
  id: z.string().min(1),
});
export type GetViewInput = z.infer<typeof GetViewInput>;

export const SaveViewInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  type: ViewTypeSchema,
  typeId: z.string().optional(),
  config: ViewConfigSchema,
  isDefault: z.boolean().optional(),
});
export type SaveViewInput = z.infer<typeof SaveViewInput>;

export const DeleteViewInput = z.object({
  id: z.string().min(1),
});
export type DeleteViewInput = z.infer<typeof DeleteViewInput>;

// ── Output schemas ────────────────────────────────────────────────────────────

export const ListViewsOutput = z.array(ViewSchema);
export type ListViewsOutput = z.infer<typeof ListViewsOutput>;

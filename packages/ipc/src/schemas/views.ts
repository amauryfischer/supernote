import { z } from "zod";

// ── ViewKind ──────────────────────────────────────────────────────────────────

export const ViewKindSchema = z.enum([
  "table",
  "board",
  "gallery",
  "calendar",
  "list",
  "chart",
  "form",
  "detail",
  "timeline",
]);
export type ViewKind = z.infer<typeof ViewKindSchema>;

export const RowHeightSchema = z.enum(["short", "normal", "tall"]);
export type RowHeight = z.infer<typeof RowHeightSchema>;

// ── Summarize (row footer aggregations) ──────────────────────────────────────

export const SummarizeOpSchema = z.enum([
  "none",
  "count_all",
  "count_filled",
  "count_empty",
  "count_unique",
  "percent_filled",
  "percent_empty",
  "sum",
  "avg",
  "median",
  "min",
  "max",
  "range",
  "earliest",
  "latest",
  "date_range_days",
]);
export type SummarizeOp = z.infer<typeof SummarizeOpSchema>;

export const SummarizeConfigSchema = z.record(z.string(), SummarizeOpSchema);
export type SummarizeConfig = z.infer<typeof SummarizeConfigSchema>;

// ── Conditional formatting rules ─────────────────────────────────────────────

export const CFStyleSchema = z.object({
  bg: z.string().optional(),
  fg: z.string().optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  icon: z.string().optional(),
});
export type CFStyle = z.infer<typeof CFStyleSchema>;

export const ConditionalFormatRuleSchema = z.object({
  id: z.string(),
  fieldId: z.string().min(1),
  op: z.string().min(1),
  value: z.unknown().optional(),
  style: CFStyleSchema,
  scope: z.enum(["cell", "row"]).default("cell"),
  enabled: z.boolean().default(true),
});
export type ConditionalFormatRule = z.infer<typeof ConditionalFormatRuleSchema>;

// ── Chart config (kind = "chart") ────────────────────────────────────────────

export const ChartKindSchema = z.enum(["bar", "line", "area", "pie", "scatter"]);
export type ChartKind = z.infer<typeof ChartKindSchema>;

export const ChartAggSchema = z.enum(["sum", "avg", "count", "min", "max"]);
export type ChartAgg = z.infer<typeof ChartAggSchema>;

export const ChartConfigSchema = z.object({
  kind: ChartKindSchema.default("bar"),
  xField: z.string().optional(),
  yField: z.string().optional(),
  yAgg: ChartAggSchema.default("sum"),
  seriesField: z.string().optional(),
  stacked: z.boolean().default(false),
});
export type ChartConfig = z.infer<typeof ChartConfigSchema>;

// ── Form config (kind = "form") ──────────────────────────────────────────────

export const FormFieldConfigSchema = z.object({
  fieldId: z.string(),
  required: z.boolean().default(false),
  label: z.string().optional(),
  helpText: z.string().optional(),
  visible: z.boolean().default(true),
});
export type FormFieldConfig = z.infer<typeof FormFieldConfigSchema>;

export const FormConfigSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(FormFieldConfigSchema).default([]),
  successMessage: z.string().optional(),
  isPublic: z.boolean().default(false),
  publicSlug: z.string().optional(),
});
export type FormConfig = z.infer<typeof FormConfigSchema>;

// ── Timeline config (kind = "timeline") ──────────────────────────────────────

export const TimelineConfigSchema = z.object({
  startField: z.string().optional(),
  endField: z.string().optional(),
  colorField: z.string().optional(),
});
export type TimelineConfig = z.infer<typeof TimelineConfigSchema>;

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
  summarize: SummarizeConfigSchema.default({}),
  conditionalFormats: z.array(ConditionalFormatRuleSchema).default([]),
  chartConfig: ChartConfigSchema.optional(),
  formConfig: FormConfigSchema.optional(),
  timelineConfig: TimelineConfigSchema.optional(),
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
  summarize: SummarizeConfigSchema.optional(),
  conditionalFormats: z.array(ConditionalFormatRuleSchema).optional(),
  chartConfig: ChartConfigSchema.optional(),
  formConfig: FormConfigSchema.optional(),
  timelineConfig: TimelineConfigSchema.optional(),
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
  summarize: SummarizeConfigSchema.optional(),
  conditionalFormats: z.array(ConditionalFormatRuleSchema).optional(),
  chartConfig: ChartConfigSchema.nullable().optional(),
  formConfig: FormConfigSchema.nullable().optional(),
  timelineConfig: TimelineConfigSchema.nullable().optional(),
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

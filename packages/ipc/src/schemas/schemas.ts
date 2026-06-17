import { z } from "zod";

// ── Field type enum ───────────────────────────────────────────────────────────

export const FieldTypeSchema = z.enum([
  "text",
  "longtext",
  "number",
  "currency",
  "percent",
  "rating",
  "progress",
  "date",
  "datetime",
  "duration",
  "bool",
  "url",
  "email",
  "phone",
  "select",
  "multiselect",
  "file",
  "image",
  "color",
  "markdown",
  "relation",
  "formula",
  "rollup",
  "lookup",
  "createdAt",
  "updatedAt",
  "createdBy",
  "autoNumber",
  "status",
  "ai",
]);
export type FieldType = z.infer<typeof FieldTypeSchema>;

// ── Field definition ──────────────────────────────────────────────────────────

export const SelectOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  color: z.string().optional(),
});
export type SelectOption = z.infer<typeof SelectOptionSchema>;

export const FieldDefinitionSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  // Libellé humain affiché dans les en-têtes / formulaires. `name` reste le
  // slug machine. Optional pour rétro-compat avec d'anciens enregistrements.
  label: z.string().optional(),
  type: FieldTypeSchema,
  required: z.boolean().default(false),
  unique: z.boolean().default(false),
  multiple: z.boolean().default(false),
  defaultValue: z.unknown().optional(),
  options: z.array(SelectOptionSchema).optional(),
  relationTypeId: z.string().optional(),
  // Relation target + cardinality. Without these the worker (which reads them
  // raw from the stored JSON) keeps working, but the output schema would strip
  // them on read — so the UI's RelationField loses its target. Carry them.
  targetTypeId: z.string().optional(),
  cardinality: z.enum(["one_to_one", "one_to_many", "many_to_many"]).optional(),
  formulaExpr: z.string().optional(),
  formulaOutputKind: z.enum(["text", "number", "date", "bool"]).optional(),
  formulaOutputFormat: z.string().optional(),
  aiPrompt: z.string().optional(),
  aiOutputKind: z.enum(["text", "longtext", "number", "bool", "select"]).optional(),
  aiModel: z.string().optional(),
  aiAutoRecompute: z.boolean().optional(),
  helpText: z.string().optional(),
  group: z.string().optional(),
});
export type FieldDefinition = z.infer<typeof FieldDefinitionSchema>;

// ── EntityType (schema) ───────────────────────────────────────────────────────

export const EntityTypeSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  plural: z.string().min(1),
  icon: z.string().optional(),
  color: z.string().optional(),
  fields: z.array(FieldDefinitionSchema),
  defaultPath: z.string().optional(),
  fileNamePattern: z.string().optional(),
  // Marqueur des seeds système (créés par seed-default-types). Permet à l'UI
  // de filtrer ou tagger les Bases pré-installées vs celles de l'utilisateur.
  isSystem: z.boolean().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EntityType = z.infer<typeof EntityTypeSchema>;

// ── Input schemas ─────────────────────────────────────────────────────────────

export const ListSchemasInput = z.object({
  search: z.string().optional(),
});
export type ListSchemasInput = z.infer<typeof ListSchemasInput>;

export const GetSchemaInput = z.object({
  id: z.string().min(1),
});
export type GetSchemaInput = z.infer<typeof GetSchemaInput>;

export const CreateSchemaInput = z.object({
  name: z.string().min(1),
  plural: z.string().min(1),
  icon: z.string().optional(),
  color: z.string().optional(),
  fields: z.array(FieldDefinitionSchema.omit({ id: true })).optional(),
  defaultPath: z.string().optional(),
  fileNamePattern: z.string().optional(),
});
export type CreateSchemaInput = z.infer<typeof CreateSchemaInput>;

export const UpdateSchemaInput = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  plural: z.string().min(1).optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
  fields: z.array(FieldDefinitionSchema).optional(),
  defaultPath: z.string().optional(),
  fileNamePattern: z.string().optional(),
});
export type UpdateSchemaInput = z.infer<typeof UpdateSchemaInput>;

export const DeleteSchemaInput = z.object({
  id: z.string().min(1),
});
export type DeleteSchemaInput = z.infer<typeof DeleteSchemaInput>;

export const ValidateSchemaInput = z.object({
  schemaId: z.string().min(1),
  fields: z.record(z.string(), z.unknown()),
});
export type ValidateSchemaInput = z.infer<typeof ValidateSchemaInput>;

// ── Output schemas ────────────────────────────────────────────────────────────

export const ValidationErrorSchema = z.object({
  field: z.string(),
  message: z.string(),
});
export type ValidationError = z.infer<typeof ValidationErrorSchema>;

export const ValidateSchemaOutput = z.object({
  valid: z.boolean(),
  errors: z.array(ValidationErrorSchema),
});
export type ValidateSchemaOutput = z.infer<typeof ValidateSchemaOutput>;

export const ListSchemasOutput = z.array(EntityTypeSchema);
export type ListSchemasOutput = z.infer<typeof ListSchemasOutput>;

import { z } from "zod";

// ── Primitive schemas (mirrors @supernote/core/variable) ──────────────────────

export const VariableTypeSchema = z.enum(["number", "string", "boolean", "date"]);
export type VariableType = z.infer<typeof VariableTypeSchema>;

export const VariableValueSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("literal"),
    value: z.union([z.number(), z.string(), z.boolean()]),
  }),
  z.object({
    kind: z.literal("formula"),
    expression: z.string().min(1),
  }),
]);
export type VariableValue = z.infer<typeof VariableValueSchema>;

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const VariableInputSchema = z.object({
  name: z.string().regex(NAME_RE),
  type: VariableTypeSchema,
  value: VariableValueSchema,
});
export type VariableInput = z.infer<typeof VariableInputSchema>;

export const VariableSchema = VariableInputSchema.extend({
  id: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Variable = z.infer<typeof VariableSchema>;

// ── Procedure I/O ─────────────────────────────────────────────────────────────

export const ListVariablesOutput = z.array(VariableSchema);

export const GetVariableInput = z.object({ id: z.string() });

export const CreateVariableInput = VariableInputSchema;

export const UpdateVariableInput = z.object({
  id: z.string(),
  patch: VariableInputSchema.partial(),
});

export const DeleteVariableInput = z.object({ id: z.string() });

export const EvaluatedValue = z.object({
  value: z.string().nullable(),
  error: z.string().nullable(),
});

export const EvaluateVariableInput = z.object({ id: z.string() });
export const EvaluateVariableOutput = EvaluatedValue;

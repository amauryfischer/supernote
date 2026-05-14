import { z } from 'zod';

export const VariableType = z.enum(['number', 'string', 'boolean', 'date']);
export type VariableType = z.infer<typeof VariableType>;

export const VariableValue = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('literal'),
    value: z.union([z.number(), z.string(), z.boolean()]),
  }),
  z.object({
    kind: z.literal('formula'),
    expression: z.string().min(1, 'expression must be non-empty'),
  }),
]);
export type VariableValue = z.infer<typeof VariableValue>;

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export const VariableInput = z.object({
  name: z.string().regex(NAME_RE, 'name must be a valid identifier (letters, digits, underscore; no leading digit)'),
  type: VariableType,
  value: VariableValue,
});
export type VariableInput = z.infer<typeof VariableInput>;

export const Variable = VariableInput.extend({
  id: z.string(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Variable = z.infer<typeof Variable>;

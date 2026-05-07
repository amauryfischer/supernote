import { z } from "zod";

// ── Template schema ───────────────────────────────────────────────────────────

export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  entityType: z.string().optional(),
  defaultPath: z.string().optional(),
  body: z.string(),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
  /** "seed" = built-in, "user" = persisted in .supernote/templates/ */
  source: z.enum(["seed", "user"]),
});
export type TemplateIpc = z.infer<typeof TemplateSchema>;

// ── Input schemas ─────────────────────────────────────────────────────────────

export const ListTemplatesInput = z.object({
  source: z.enum(["seed", "user", "all"]).default("all"),
});
export type ListTemplatesInput = z.infer<typeof ListTemplatesInput>;

export const GetTemplateInput = z.object({
  id: z.string().min(1),
});
export type GetTemplateInput = z.infer<typeof GetTemplateInput>;

export const SaveTemplateInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  entityType: z.string().optional(),
  body: z.string(),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
});
export type SaveTemplateInput = z.infer<typeof SaveTemplateInput>;

export const DeleteTemplateInput = z.object({
  id: z.string().min(1),
});
export type DeleteTemplateInput = z.infer<typeof DeleteTemplateInput>;

export const TestTemplateInput = z.object({
  id: z.string().optional(),
  body: z.string(),
  frontmatter: z.record(z.string(), z.unknown()).optional(),
});
export type TestTemplateInput = z.infer<typeof TestTemplateInput>;

// ── Output schemas ────────────────────────────────────────────────────────────

export const ListTemplatesOutput = z.array(TemplateSchema);
export type ListTemplatesOutput = z.infer<typeof ListTemplatesOutput>;

export const TestTemplateOutput = z.object({
  rendered: z.string(),
  error: z.string().optional(),
});
export type TestTemplateOutput = z.infer<typeof TestTemplateOutput>;

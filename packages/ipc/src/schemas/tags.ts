import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

export const TagSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** Full hierarchical path, e.g. "client/important" */
  path: z.string().min(1),
  /** Number of entities using this tag */
  count: z.number().int().nonnegative(),
});
export type Tag = z.infer<typeof TagSchema>;

export const TagNodeSchema: z.ZodType<TagNode> = z.lazy(() =>
  z.object({
    name: z.string().min(1),
    path: z.string().min(1),
    count: z.number().int().nonnegative(),
    children: z.array(TagNodeSchema),
  }),
);

export interface TagNode {
  name: string;
  path: string;
  count: number;
  children: TagNode[];
}

// ── Input schemas ─────────────────────────────────────────────────────────────

export const ListTagsInput = z.object({
  search: z.string().optional(),
  prefix: z.string().optional(),
});
export type ListTagsInput = z.infer<typeof ListTagsInput>;

export const RenameTagInput = z.object({
  oldPath: z.string().min(1),
  newPath: z.string().min(1),
});
export type RenameTagInput = z.infer<typeof RenameTagInput>;

export const DeleteTagInput = z.object({
  path: z.string().min(1),
  /** If true, also delete all child tags */
  recursive: z.boolean().default(false),
});
export type DeleteTagInput = z.infer<typeof DeleteTagInput>;

// ── Output schemas ────────────────────────────────────────────────────────────

export const ListTagsOutput = z.array(TagSchema);
export type ListTagsOutput = z.infer<typeof ListTagsOutput>;

export const GetHierarchyOutput = z.array(TagNodeSchema);
export type GetHierarchyOutput = z.infer<typeof GetHierarchyOutput>;

export const RenameTagOutput = z.object({
  affected: z.number().int().nonnegative(),
});
export type RenameTagOutput = z.infer<typeof RenameTagOutput>;

export const DeleteTagOutput = z.object({
  affected: z.number().int().nonnegative(),
});
export type DeleteTagOutput = z.infer<typeof DeleteTagOutput>;

import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

export const TagSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** Full hierarchical path, e.g. "client/important" */
  path: z.string().min(1),
  /** Number of entities using this tag */
  count: z.number().int().nonnegative(),
  /** Hex color, optional — used by the UI for the swatch. */
  color: z.string().nullable().optional(),
  /** Parent path for hierarchical tags (e.g. "client" for "client/important"). */
  parentPath: z.string().nullable().optional(),
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

export const CreateTagInput = z.object({
  /** Full path of the tag (e.g. "client/important"). */
  path: z.string().min(1),
  /** Display label. Defaults to the leaf segment of `path`. */
  label: z.string().min(1).optional(),
  /** Optional hex color for the UI swatch. */
  color: z.string().nullable().optional(),
});
export type CreateTagInput = z.infer<typeof CreateTagInput>;

export const UpdateTagInput = z.object({
  /** Path identifying the tag (paths are unique per vault). */
  path: z.string().min(1),
  /** New label, if changed. */
  label: z.string().min(1).optional(),
  /** New color (or null to clear). */
  color: z.string().nullable().optional(),
});
export type UpdateTagInput = z.infer<typeof UpdateTagInput>;

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

export const ListEntitiesForTagInput = z.object({
  path: z.string().min(1),
  limit: z.number().int().positive().max(500).optional(),
  /**
   * When true, also include entities tagged with any descendant of `path`
   * (e.g. `client/premium/europe` counts toward `client`). Defaults to true:
   * the hierarchical tags UI relies on rolled-up counts.
   */
  recursive: z.boolean().optional(),
});
export type ListEntitiesForTagInput = z.infer<typeof ListEntitiesForTagInput>;

export const MoveTagInput = z.object({
  /** Path of the tag to move. */
  path: z.string().min(1),
  /**
   * Target parent path, or `null` to promote the tag to the root level.
   * The leaf segment of `path` is preserved; the result becomes
   * `<newParentPath>/<leaf>` (or `<leaf>` when null).
   */
  newParentPath: z.string().nullable(),
});
export type MoveTagInput = z.infer<typeof MoveTagInput>;

export const MergeTagsInput = z.object({
  /** Source tag path — entities currently using it are re-tagged with `targetPath`. */
  sourcePath: z.string().min(1),
  /** Target tag path. Created if missing. */
  targetPath: z.string().min(1),
  /**
   * When true, also re-parent every descendant of `sourcePath` underneath
   * `targetPath`. When false, descendants are deleted along with `sourcePath`
   * (after re-tagging entities that lived directly under `sourcePath`).
   */
  includeDescendants: z.boolean().optional(),
});
export type MergeTagsInput = z.infer<typeof MergeTagsInput>;

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

export const CreateTagOutput = TagSchema;
export type CreateTagOutput = z.infer<typeof CreateTagOutput>;

export const UpdateTagOutput = TagSchema;
export type UpdateTagOutput = z.infer<typeof UpdateTagOutput>;

/** A single entity returned by `tags.entities`. Lightweight on purpose — the
 * UI only needs the entity type, an identifier, and a display title. */
export const TagEntitySchema = z.object({
  id: z.string(),
  typeId: z.string(),
  typeName: z.string(),
  filePath: z.string().nullable(),
  title: z.string(),
  updatedAt: z.string(),
});
export type TagEntity = z.infer<typeof TagEntitySchema>;

export const ListEntitiesForTagOutput = z.array(TagEntitySchema);
export type ListEntitiesForTagOutput = z.infer<typeof ListEntitiesForTagOutput>;

export const MoveTagOutput = z.object({
  affected: z.number().int().nonnegative(),
});
export type MoveTagOutput = z.infer<typeof MoveTagOutput>;

export const MergeTagsOutput = z.object({
  /** Number of entities re-tagged (i.e. whose entity_tag rows changed). */
  reTagged: z.number().int().nonnegative(),
  /** Number of source tag rows removed (1 + descendants when included). */
  removed: z.number().int().nonnegative(),
});
export type MergeTagsOutput = z.infer<typeof MergeTagsOutput>;

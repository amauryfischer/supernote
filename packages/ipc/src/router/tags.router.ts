import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  ListTagsInput,
  ListTagsOutput,
  GetHierarchyOutput,
  CreateTagInput,
  CreateTagOutput,
  UpdateTagInput,
  UpdateTagOutput,
  RenameTagInput,
  RenameTagOutput,
  DeleteTagInput,
  DeleteTagOutput,
  ListEntitiesForTagInput,
  ListEntitiesForTagOutput,
  MoveTagInput,
  MoveTagOutput,
  MergeTagsInput,
  MergeTagsOutput,
} from "../schemas/tags.js";

export const tagsRouter = router({
  /** List all tags with their entity counts. */
  list: publicProcedure
    .input(ListTagsInput)
    .output(ListTagsOutput)
    .query(() => {
      throw notImplemented("tags.list");
    }),

  /** Get the full hierarchical tag tree. */
  getHierarchy: publicProcedure
    .output(GetHierarchyOutput)
    .query(() => {
      throw notImplemented("tags.getHierarchy");
    }),

  /** Create a new tag (no-op if it already exists at `path`). */
  create: publicProcedure
    .input(CreateTagInput)
    .output(CreateTagOutput)
    .mutation(() => {
      throw notImplemented("tags.create");
    }),

  /** Update label or color of an existing tag. */
  update: publicProcedure
    .input(UpdateTagInput)
    .output(UpdateTagOutput)
    .mutation(() => {
      throw notImplemented("tags.update");
    }),

  /**
   * Rename a tag. Cascades through every descendant: renaming `client` to
   * `clients` rewrites `client/premium/europe` → `clients/premium/europe`.
   */
  rename: publicProcedure
    .input(RenameTagInput)
    .output(RenameTagOutput)
    .mutation(() => {
      throw notImplemented("tags.rename");
    }),

  /**
   * Move a tag to a different parent (preserving its leaf segment) and
   * cascade-rewrite every descendant. This is rename's "parent-only" cousin
   * exposed as a dedicated route so the UI can surface a "Déplacer" menu
   * entry without having to compute the new path itself.
   */
  move: publicProcedure
    .input(MoveTagInput)
    .output(MoveTagOutput)
    .mutation(() => {
      throw notImplemented("tags.move");
    }),

  /**
   * Merge `sourcePath` into `targetPath`: every entity tagged with the source
   * is re-tagged with the target, then the source tag is removed. When
   * `includeDescendants` is true, descendants of the source are re-parented
   * underneath the target instead of being deleted.
   */
  merge: publicProcedure
    .input(MergeTagsInput)
    .output(MergeTagsOutput)
    .mutation(() => {
      throw notImplemented("tags.merge");
    }),

  /** Delete a tag, removing it from all entities. */
  delete: publicProcedure
    .input(DeleteTagInput)
    .output(DeleteTagOutput)
    .mutation(() => {
      throw notImplemented("tags.delete");
    }),

  /** List the entities currently tagged with a given path. */
  entities: publicProcedure
    .input(ListEntitiesForTagInput)
    .output(ListEntitiesForTagOutput)
    .query(() => {
      throw notImplemented("tags.entities");
    }),
});

export type TagsRouter = typeof tagsRouter;

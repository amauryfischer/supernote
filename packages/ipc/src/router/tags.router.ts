import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  ListTagsInput,
  ListTagsOutput,
  GetHierarchyOutput,
  RenameTagInput,
  RenameTagOutput,
  DeleteTagInput,
  DeleteTagOutput,
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

  /** Rename a tag (and optionally all its children). */
  rename: publicProcedure
    .input(RenameTagInput)
    .output(RenameTagOutput)
    .mutation(() => {
      throw notImplemented("tags.rename");
    }),

  /** Delete a tag, removing it from all entities. */
  delete: publicProcedure
    .input(DeleteTagInput)
    .output(DeleteTagOutput)
    .mutation(() => {
      throw notImplemented("tags.delete");
    }),
});

export type TagsRouter = typeof tagsRouter;

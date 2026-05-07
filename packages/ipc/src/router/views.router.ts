import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  ListViewsInput,
  ListViewsOutput,
  GetViewInput,
  ViewSchema,
  SaveViewInput,
  DeleteViewInput,
} from "../schemas/views.js";
import { z } from "zod";

export const viewsRouter = router({
  /** List saved views, optionally filtered by entity type or view type. */
  list: publicProcedure
    .input(ListViewsInput)
    .output(ListViewsOutput)
    .query(() => {
      throw notImplemented("views.list");
    }),

  /** Get a single saved view by id. */
  get: publicProcedure
    .input(GetViewInput)
    .output(ViewSchema)
    .query(() => {
      throw notImplemented("views.get");
    }),

  /** Create or update a view (upsert by id if provided). */
  save: publicProcedure
    .input(SaveViewInput)
    .output(ViewSchema)
    .mutation(() => {
      throw notImplemented("views.save");
    }),

  /** Delete a saved view. */
  delete: publicProcedure
    .input(DeleteViewInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(() => {
      throw notImplemented("views.delete");
    }),
});

export type ViewsRouter = typeof viewsRouter;

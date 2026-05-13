import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import { z } from "zod";
import {
  ListViewsInput,
  ListViewsOutput,
  GetViewInput,
  ViewSchema,
  CreateViewInput,
  UpdateViewInput,
  DeleteViewInput,
  EnsureDefaultViewInput,
  QueryForViewInput,
  QueryForViewOutput,
} from "../schemas/views.js";

export const viewsRouter = router({
  /** List saved views, optionally filtered by typeId (Base). */
  list: publicProcedure
    .input(ListViewsInput)
    .output(ListViewsOutput)
    .query(() => {
      throw notImplemented("views.list");
    }),

  /** Get a single view by id. */
  get: publicProcedure
    .input(GetViewInput)
    .output(ViewSchema)
    .query(() => {
      throw notImplemented("views.get");
    }),

  /** Create a new view for a Base. */
  create: publicProcedure
    .input(CreateViewInput)
    .output(ViewSchema)
    .mutation(() => {
      throw notImplemented("views.create");
    }),

  /** Patch an existing view (filters, sorts, visible fields, etc.). */
  update: publicProcedure
    .input(UpdateViewInput)
    .output(ViewSchema)
    .mutation(() => {
      throw notImplemented("views.update");
    }),

  /** Delete a view. System (default) views cannot be deleted. */
  delete: publicProcedure
    .input(DeleteViewInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(() => {
      throw notImplemented("views.delete");
    }),

  /**
   * Idempotent: returns the default Table view for `typeId`, creating it
   * (isSystem: true) on first call. Used by the Base page on first visit so
   * the user always lands on something.
   */
  ensureDefault: publicProcedure
    .input(EnsureDefaultViewInput)
    .output(ViewSchema)
    .mutation(() => {
      throw notImplemented("views.ensureDefault");
    }),

  /**
   * Query entities for a view: applies filters + sorts and returns matching
   * Entity rows. Distinct from `entities.list` which is a raw fetch by
   * typeId/typeName — `queryForView` is the data path used by every view
   * renderer (table, board, gallery, …).
   */
  queryForView: publicProcedure
    .input(QueryForViewInput)
    .output(QueryForViewOutput)
    .query(() => {
      throw notImplemented("views.queryForView");
    }),
});

export type ViewsRouter = typeof viewsRouter;

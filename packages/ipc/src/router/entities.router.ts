import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  ListEntitiesInput,
  ListEntitiesOutput,
  GetEntityInput,
  EntitySchema,
  CreateEntityInput,
  UpdateEntityInput,
  MoveEntityIfFreeInput,
  MoveEntityIfFreeOutput,
  DeleteEntityInput,
  SearchEntitiesInput,
  SearchEntitiesOutput,
  GetRelatedInput,
  ListEntitiesOutput as RelatedEntitiesOutput,
  GetBacklinksInput,
  GetBacklinksOutput,
  ListByDateRangeInput,
  BacklinkCountsOutput,
  CountEntitiesInput,
  CountEntitiesOutput,
} from "../schemas/entities.js";
import { z } from "zod";

export const entitiesRouter = router({
  /** List entities with optional type/tag/sort filters and pagination. */
  list: publicProcedure
    .input(ListEntitiesInput)
    .output(ListEntitiesOutput)
    .query(() => {
      throw notImplemented("entities.list");
    }),

  /**
   * Like `list` but the worker returns only a short body excerpt (not the full
   * markdown). For read-only preview/aggregation surfaces (home widgets, tag
   * clouds) that never feed the optimistic-update cache — avoids structure-
   * cloning thousands of full bodies across the worker boundary.
   */
  listSummaries: publicProcedure
    .input(ListEntitiesInput)
    .output(ListEntitiesOutput)
    .query(() => {
      throw notImplemented("entities.listSummaries");
    }),

  /** Count entities matching an optional type filter (pure SQL COUNT). */
  count: publicProcedure
    .input(CountEntitiesInput)
    .output(CountEntitiesOutput)
    .query(() => {
      throw notImplemented("entities.count");
    }),

  /** Get a single entity by id (includes full body). */
  get: publicProcedure
    .input(GetEntityInput)
    .output(EntitySchema)
    .query(() => {
      throw notImplemented("entities.get");
    }),

  /** Create a new entity from a type definition. */
  create: publicProcedure
    .input(CreateEntityInput)
    .output(EntitySchema)
    .mutation(() => {
      throw notImplemented("entities.create");
    }),

  /** Update fields, body, or tags of an existing entity. */
  update: publicProcedure
    .input(UpdateEntityInput)
    .output(EntitySchema)
    .mutation(() => {
      throw notImplemented("entities.update");
    }),

  /**
   * Move an entity into a folder, resolving the first FREE filename worker-side
   * (`-2`, `-3`, … like `create`). The occupancy test must be atomic with the
   * write — a client-side check goes stale between scan and mutation, and the
   * move writes the destination file BEFORE deleting the source, so a collision
   * destroys both notes.
   */
  moveIfFree: publicProcedure
    .input(MoveEntityIfFreeInput)
    .output(MoveEntityIfFreeOutput)
    .mutation(() => {
      throw notImplemented("entities.moveIfFree");
    }),

  /** Delete an entity (moves to trash by default). */
  delete: publicProcedure
    .input(DeleteEntityInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(() => {
      throw notImplemented("entities.delete");
    }),

  /** List entities whose createdAt/updatedAt falls in [from, to). */
  listByDateRange: publicProcedure
    .input(ListByDateRangeInput)
    .output(ListEntitiesOutput)
    .query(() => {
      throw notImplemented("entities.listByDateRange");
    }),

  /** Full-text search across all entities. */
  search: publicProcedure
    .input(SearchEntitiesInput)
    .output(SearchEntitiesOutput)
    .query(() => {
      throw notImplemented("entities.search");
    }),

  /** Get entities related to a given entity via relation edges. */
  getRelated: publicProcedure
    .input(GetRelatedInput)
    .output(RelatedEntitiesOutput)
    .query(() => {
      throw notImplemented("entities.getRelated");
    }),

  /** Get all entities that wikilink or embed the given entity. */
  getBacklinks: publicProcedure
    .input(GetBacklinksInput)
    .output(GetBacklinksOutput)
    .query(() => {
      throw notImplemented("entities.getBacklinks");
    }),

  /** Backlink count per target entity, aggregated in one pass. */
  backlinkCounts: publicProcedure
    .output(BacklinkCountsOutput)
    .query(() => {
      throw notImplemented("entities.backlinkCounts");
    }),
});

export type EntitiesRouter = typeof entitiesRouter;

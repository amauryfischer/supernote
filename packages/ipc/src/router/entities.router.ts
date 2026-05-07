import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  ListEntitiesInput,
  ListEntitiesOutput,
  GetEntityInput,
  EntitySchema,
  CreateEntityInput,
  UpdateEntityInput,
  DeleteEntityInput,
  SearchEntitiesInput,
  SearchEntitiesOutput,
  GetRelatedInput,
  ListEntitiesOutput as RelatedEntitiesOutput,
  GetBacklinksInput,
  GetBacklinksOutput,
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

  /** Delete an entity (moves to trash by default). */
  delete: publicProcedure
    .input(DeleteEntityInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(() => {
      throw notImplemented("entities.delete");
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
});

export type EntitiesRouter = typeof entitiesRouter;

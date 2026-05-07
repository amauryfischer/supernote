import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  CreateRelationInput,
  DeleteRelationInput,
  ListRelationsForEntityInput,
  ListAllRelationsInput,
  RelationEdgeSchema,
  ListRelationsOutput,
} from "../schemas/relations.js";
import { z } from "zod";

export const relationsRouter = router({
  /** Create a typed relation edge between two entities. */
  create: publicProcedure
    .input(CreateRelationInput)
    .output(RelationEdgeSchema)
    .mutation(() => {
      throw notImplemented("relations.create");
    }),

  /** Delete a relation edge by id. */
  delete: publicProcedure
    .input(DeleteRelationInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(() => {
      throw notImplemented("relations.delete");
    }),

  /** List all relation edges where the given entity is source or target. */
  listForEntity: publicProcedure
    .input(ListRelationsForEntityInput)
    .output(ListRelationsOutput)
    .query(() => {
      throw notImplemented("relations.listForEntity");
    }),

  /** List all relation edges in the vault (paginated). */
  listAll: publicProcedure
    .input(ListAllRelationsInput)
    .output(ListRelationsOutput)
    .query(() => {
      throw notImplemented("relations.listAll");
    }),
});

export type RelationsRouter = typeof relationsRouter;

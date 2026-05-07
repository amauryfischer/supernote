import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  ListSchemasInput,
  ListSchemasOutput,
  GetSchemaInput,
  EntityTypeSchema,
  CreateSchemaInput,
  UpdateSchemaInput,
  DeleteSchemaInput,
  ValidateSchemaInput,
  ValidateSchemaOutput,
} from "../schemas/schemas.js";
import { z } from "zod";

export const schemasRouter = router({
  /** List all defined EntityType schemas. */
  list: publicProcedure
    .input(ListSchemasInput)
    .output(ListSchemasOutput)
    .query(() => {
      throw notImplemented("schemas.list");
    }),

  /** Get a single EntityType schema by id. */
  get: publicProcedure
    .input(GetSchemaInput)
    .output(EntityTypeSchema)
    .query(() => {
      throw notImplemented("schemas.get");
    }),

  /** Create a new EntityType schema. */
  create: publicProcedure
    .input(CreateSchemaInput)
    .output(EntityTypeSchema)
    .mutation(() => {
      throw notImplemented("schemas.create");
    }),

  /** Update an existing EntityType schema (may trigger migration). */
  update: publicProcedure
    .input(UpdateSchemaInput)
    .output(EntityTypeSchema)
    .mutation(() => {
      throw notImplemented("schemas.update");
    }),

  /** Delete an EntityType schema. Fails if entities of this type exist. */
  delete: publicProcedure
    .input(DeleteSchemaInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(() => {
      throw notImplemented("schemas.delete");
    }),

  /** Validate a set of field values against an EntityType schema. */
  validate: publicProcedure
    .input(ValidateSchemaInput)
    .output(ValidateSchemaOutput)
    .query(() => {
      throw notImplemented("schemas.validate");
    }),
});

export type SchemasRouter = typeof schemasRouter;

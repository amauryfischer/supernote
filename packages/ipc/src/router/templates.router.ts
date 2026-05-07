import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  ListTemplatesInput,
  ListTemplatesOutput,
  GetTemplateInput,
  TemplateSchema,
  SaveTemplateInput,
  DeleteTemplateInput,
  TestTemplateInput,
  TestTemplateOutput,
} from "../schemas/templates.js";
import { z } from "zod";

export const templatesRouter = router({
  /** List all templates (seeds + persisted user templates). */
  list: publicProcedure
    .input(ListTemplatesInput)
    .output(ListTemplatesOutput)
    .query(() => {
      throw notImplemented("templates.list");
    }),

  /** Get a single template by id. */
  get: publicProcedure
    .input(GetTemplateInput)
    .output(TemplateSchema)
    .query(() => {
      throw notImplemented("templates.get");
    }),

  /** Create or update a user template (upsert by id). */
  save: publicProcedure
    .input(SaveTemplateInput)
    .output(TemplateSchema)
    .mutation(() => {
      throw notImplemented("templates.save");
    }),

  /** Delete a persisted user template. */
  delete: publicProcedure
    .input(DeleteTemplateInput)
    .output(z.object({ id: z.string(), deleted: z.boolean() }))
    .mutation(() => {
      throw notImplemented("templates.delete");
    }),

  /** Render a template body with mock resolvers and return the result. */
  test: publicProcedure
    .input(TestTemplateInput)
    .output(TestTemplateOutput)
    .mutation(() => {
      throw notImplemented("templates.test");
    }),
});

export type TemplatesRouter = typeof templatesRouter;

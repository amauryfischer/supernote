import { Hono } from "hono";
import type { Resolvers } from "../../types.js";

export function buildTagsRouter(resolvers: Resolvers): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const tags = await resolvers.listTags();
    return c.json({ data: tags });
  });

  return app;
}

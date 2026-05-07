import { Hono } from "hono";
import type { Resolvers } from "../../types.js";

export function buildSchemasRouter(resolvers: Resolvers): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const schemas = await resolvers.listSchemas();
    return c.json({ data: schemas });
  });

  app.get("/:id", async (c) => {
    const schema = await resolvers.getSchema(c.req.param("id"));
    if (!schema) return c.json({ error: "Not Found" }, 404);
    return c.json({ data: schema });
  });

  return app;
}

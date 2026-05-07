import { Hono } from "hono";
import { z } from "zod";
import type { Resolvers } from "../../types.js";

const kindSchema = z.enum(["fts", "semantic", "hybrid"]);

export function buildSearchRouter(resolvers: Resolvers): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    const qs = c.req.query();
    const q = qs["q"] ?? "";
    const kind = kindSchema.catch("hybrid").parse(qs["kind"]);
    const limit = qs["limit"] ? Number(qs["limit"]) : 10;

    if (!q) return c.json({ error: "Missing query parameter 'q'" }, 400);

    const results = await resolvers.search({ query: q, kind, limit });
    return c.json({ data: results });
  });

  return app;
}

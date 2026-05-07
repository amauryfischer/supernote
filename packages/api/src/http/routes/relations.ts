import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Resolvers } from "../../types.js";
import type { EventBus } from "../event-bus.js";
import { buildEvent } from "../event-bus.js";

const createRelationSchema = z.object({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  relationTypeId: z.string().min(1),
  fields: z.record(z.unknown()).optional(),
});

export function buildRelationsRouter(resolvers: Resolvers, bus: EventBus): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const source = c.req.query("source");
    if (!source) return c.json({ error: "Missing 'source' query parameter" }, 400);
    const relations = await resolvers.listRelations(source);
    return c.json({ data: relations });
  });

  app.get("/backlinks/:entityId", async (c) => {
    const backlinks = await resolvers.getBacklinks(c.req.param("entityId"));
    return c.json({ data: backlinks });
  });

  app.post("/", zValidator("json", createRelationSchema), async (c) => {
    const data = c.req.valid("json");
    const relation = await resolvers.createRelation(data);
    bus.publish(buildEvent("relation.created", data.sourceId, relation));
    return c.json({ data: relation }, 201);
  });

  return app;
}

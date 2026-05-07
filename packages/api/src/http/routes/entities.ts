import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { Resolvers } from "../../types.js";
import type { EventBus } from "../event-bus.js";
import { buildEvent } from "../event-bus.js";

const createSchema = z.object({
  typeId: z.string().min(1),
  fields: z.record(z.unknown()).default({}),
  body: z.string().default(""),
  tags: z.array(z.string()).optional(),
});

const updateSchema = z.object({
  fields: z.record(z.unknown()).optional(),
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export function buildEntitiesRouter(resolvers: Resolvers, bus: EventBus): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const { type, tag, q, limit, offset } = c.req.query();
    const entities = await resolvers.listEntities({
      type,
      tag,
      q,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return c.json({ data: entities });
  });

  app.get("/:id", async (c) => {
    const entity = await resolvers.getEntity(c.req.param("id"));
    if (!entity) return c.json({ error: "Not Found" }, 404);
    return c.json({ data: entity });
  });

  app.post("/", zValidator("json", createSchema), async (c) => {
    const body = c.req.valid("json");
    const entity = await resolvers.createEntity(body);
    bus.publish(buildEvent("entity.created", entity.id, entity));
    return c.json({ data: entity }, 201);
  });

  app.patch("/:id", zValidator("json", updateSchema), async (c) => {
    const entity = await resolvers.updateEntity(c.req.param("id"), c.req.valid("json"));
    if (!entity) return c.json({ error: "Not Found" }, 404);
    bus.publish(buildEvent("entity.updated", entity.id, entity));
    return c.json({ data: entity });
  });

  app.delete("/:id", async (c) => {
    const deleted = await resolvers.deleteEntity(c.req.param("id"));
    if (!deleted) return c.json({ error: "Not Found" }, 404);
    bus.publish(buildEvent("entity.deleted", c.req.param("id")));
    return c.json({ data: { deleted: true } });
  });

  return app;
}

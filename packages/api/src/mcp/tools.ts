import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Resolvers } from "../types.js";

// ---- Input schemas -----------------------------------------

const listEntitiesInput = {
  type: z.string().optional().describe("Entity type filter"),
  tag: z.string().optional().describe("Tag filter"),
  limit: z.number().int().positive().max(200).optional().default(50).describe("Max results"),
};

const getEntityInput = {
  id: z.string().min(1).describe("Entity ID"),
};

const createEntityInput = {
  typeId: z.string().min(1).describe("Entity type ID"),
  fields: z.record(z.unknown()).default({}).describe("Field values"),
  body: z.string().default("").describe("Markdown body"),
  tags: z.array(z.string()).optional().describe("Tag names"),
};

const updateEntityInput = {
  id: z.string().min(1).describe("Entity ID"),
  fields: z.record(z.unknown()).optional().describe("Fields to update"),
  body: z.string().optional().describe("New markdown body"),
  tags: z.array(z.string()).optional().describe("New tags (replaces existing)"),
};

const deleteEntityInput = {
  id: z.string().min(1).describe("Entity ID"),
  soft: z.boolean().optional().default(false).describe("Soft delete (move to trash)"),
};

const searchInput = {
  query: z.string().min(1).describe("Search query"),
  kind: z.enum(["fts", "semantic", "hybrid"]).optional().default("hybrid"),
  limit: z.number().int().positive().max(50).optional().default(10),
};

const getSchemaInput = {
  id: z.string().min(1).describe("Schema/EntityType ID"),
};

const createRelationInput = {
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  relationTypeId: z.string().min(1),
  fields: z.record(z.unknown()).optional(),
};

const listRelationsInput = {
  entityId: z.string().min(1).describe("Source entity ID"),
};

const getBacklinksInput = {
  entityId: z.string().min(1).describe("Target entity ID"),
};

// ---- Tool registration -------------------------------------

export function registerMcpTools(server: McpServer, resolvers: Resolvers): void {
  server.tool("list_entities", "List entities with optional filters", listEntitiesInput, async (args) => {
    const entities = await resolvers.listEntities({ type: args.type, tag: args.tag, limit: args.limit });
    return { content: [{ type: "text", text: JSON.stringify(entities, null, 2) }] };
  });

  server.tool("get_entity", "Get a single entity by ID", getEntityInput, async (args) => {
    const entity = await resolvers.getEntity(args.id);
    if (!entity) return { content: [{ type: "text", text: `Entity ${args.id} not found` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(entity, null, 2) }] };
  });

  server.tool("create_entity", "Create a new entity", createEntityInput, async (args) => {
    const entity = await resolvers.createEntity({ typeId: args.typeId, fields: args.fields, body: args.body, tags: args.tags });
    return { content: [{ type: "text", text: JSON.stringify(entity, null, 2) }] };
  });

  server.tool("update_entity", "Update an existing entity", updateEntityInput, async (args) => {
    const { id, ...data } = args;
    const entity = await resolvers.updateEntity(id, data);
    if (!entity) return { content: [{ type: "text", text: `Entity ${id} not found` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(entity, null, 2) }] };
  });

  server.tool("delete_entity", "Delete an entity", deleteEntityInput, async (args) => {
    const deleted = await resolvers.deleteEntity(args.id);
    return { content: [{ type: "text", text: deleted ? "Deleted" : "Not found" }], isError: !deleted };
  });

  server.tool("search", "Search entities across the vault", searchInput, async (args) => {
    const results = await resolvers.search({ query: args.query, kind: args.kind, limit: args.limit });
    return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
  });

  server.tool("list_schemas", "List all entity type schemas", {}, async () => {
    const schemas = await resolvers.listSchemas();
    return { content: [{ type: "text", text: JSON.stringify(schemas, null, 2) }] };
  });

  server.tool("get_schema", "Get a specific entity type schema", getSchemaInput, async (args) => {
    const schema = await resolvers.getSchema(args.id);
    if (!schema) return { content: [{ type: "text", text: `Schema ${args.id} not found` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(schema, null, 2) }] };
  });

  server.tool("create_relation", "Create a relation between two entities", createRelationInput, async (args) => {
    const relation = await resolvers.createRelation(args);
    return { content: [{ type: "text", text: JSON.stringify(relation, null, 2) }] };
  });

  server.tool("list_relations", "List relations from an entity", listRelationsInput, async (args) => {
    const relations = await resolvers.listRelations(args.entityId);
    return { content: [{ type: "text", text: JSON.stringify(relations, null, 2) }] };
  });

  server.tool("get_backlinks", "Get backlinks (incoming relations) to an entity", getBacklinksInput, async (args) => {
    const backlinks = await resolvers.getBacklinks(args.entityId);
    return { content: [{ type: "text", text: JSON.stringify(backlinks, null, 2) }] };
  });
}

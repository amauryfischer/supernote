import { describe, it, expect, vi } from "vitest";
import { createMcpServer } from "../mcp/server.js";
import { createMockResolvers, MOCK_ENTITY, MOCK_ENTITY_TYPE, MOCK_RELATION } from "./mock-resolvers.js";

// Internal shape of McpServer._registeredTools entries
interface RegisteredTool {
  handler: (args: unknown, extra: unknown) => Promise<unknown>;
}

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

// Access the registered tools through the internal plain-object registry
async function callTool(
  server: ReturnType<typeof createMcpServer>,
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const registry = (server.server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
  const tool = registry[toolName];
  if (!tool) throw new Error(`Tool ${toolName} not registered`);
  return tool.handler(args, {}) as Promise<ToolResult>;
}

describe("MCP Tools", () => {
  const resolvers = createMockResolvers();
  const handle = createMcpServer({ resolvers });

  it("list_entities returns entities", async () => {
    const result = await callTool(handle, "list_entities", { limit: 10 });
    expect(result.content[0]?.type).toBe("text");
    const data = JSON.parse(result.content[0]!.text) as unknown[];
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
  });

  it("get_entity returns entity for known id", async () => {
    const result = await callTool(handle, "get_entity", { id: MOCK_ENTITY.id });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { id: string };
    expect(data.id).toBe(MOCK_ENTITY.id);
  });

  it("get_entity returns error for unknown id", async () => {
    const result = await callTool(handle, "get_entity", { id: "unknown" });
    expect(result.isError).toBe(true);
  });

  it("create_entity creates and returns entity", async () => {
    const result = await callTool(handle, "create_entity", {
      typeId: "contact",
      fields: { name: "Test" },
      body: "body",
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { typeId: string };
    expect(data.typeId).toBe("contact");
  });

  it("update_entity updates existing entity", async () => {
    const result = await callTool(handle, "update_entity", {
      id: MOCK_ENTITY.id,
      body: "new body",
    });
    expect(result.isError).toBeFalsy();
  });

  it("update_entity returns error for unknown id", async () => {
    const result = await callTool(handle, "update_entity", {
      id: "unknown",
      body: "new body",
    });
    expect(result.isError).toBe(true);
  });

  it("delete_entity deletes known entity", async () => {
    const result = await callTool(handle, "delete_entity", { id: MOCK_ENTITY.id, soft: false });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]?.text).toBe("Deleted");
  });

  it("delete_entity returns error for unknown id", async () => {
    const result = await callTool(handle, "delete_entity", { id: "unknown", soft: false });
    expect(result.isError).toBe(true);
  });

  it("search returns results", async () => {
    const result = await callTool(handle, "search", { query: "alice", kind: "hybrid", limit: 10 });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as unknown[];
    expect(Array.isArray(data)).toBe(true);
  });

  it("list_schemas returns schemas", async () => {
    const result = await callTool(handle, "list_schemas", {});
    const data = JSON.parse(result.content[0]!.text) as unknown[];
    expect(data).toHaveLength(1);
  });

  it("get_schema returns schema for known id", async () => {
    const result = await callTool(handle, "get_schema", { id: MOCK_ENTITY_TYPE.id });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { id: string };
    expect(data.id).toBe(MOCK_ENTITY_TYPE.id);
  });

  it("get_schema returns error for unknown id", async () => {
    const result = await callTool(handle, "get_schema", { id: "unknown" });
    expect(result.isError).toBe(true);
  });

  it("create_relation creates relation", async () => {
    const result = await callTool(handle, "create_relation", {
      sourceId: "src",
      targetId: "tgt",
      relationTypeId: "knows",
    });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]!.text) as { sourceId: string };
    expect(data.sourceId).toBe("src");
  });

  it("list_relations returns relations", async () => {
    const result = await callTool(handle, "list_relations", { entityId: MOCK_RELATION.sourceId });
    const data = JSON.parse(result.content[0]!.text) as unknown[];
    expect(data).toHaveLength(1);
  });

  it("get_backlinks returns backlinks", async () => {
    const result = await callTool(handle, "get_backlinks", { entityId: MOCK_RELATION.targetId });
    const data = JSON.parse(result.content[0]!.text) as unknown[];
    expect(data).toHaveLength(1);
  });

  // Input validation — required fields missing should cause an error
  it("create_entity fails when resolver rejects", async () => {
    const failResolver = createMockResolvers({
      createEntity: vi.fn().mockRejectedValue(new Error("validation failed")),
    });
    const localHandle = createMcpServer({ resolvers: failResolver });
    await expect(callTool(localHandle, "create_entity", { typeId: "x", fields: {}, body: "" })).rejects.toThrow();
  });
});

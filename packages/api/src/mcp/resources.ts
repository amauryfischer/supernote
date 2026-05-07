import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Resolvers } from "../types.js";

export function registerMcpResources(server: McpServer, resolvers: Resolvers): void {
  // vault://entities/{id}
  const entityTemplate = new ResourceTemplate("vault://entities/{id}", { list: undefined });
  server.resource(
    "vault-entity",
    entityTemplate,
    { description: "Full entity document from the vault" },
    async (uri, variables) => {
      const rawId = variables["id"];
      const entityId = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "");
      const entity = await resolvers.getEntity(entityId);
      if (!entity) {
        return { contents: [{ uri: uri.href, text: `Entity ${entityId} not found`, mimeType: "text/plain" }] };
      }
      return { contents: [{ uri: uri.href, text: JSON.stringify(entity, null, 2), mimeType: "application/json" }] };
    }
  );

  // vault://schemas/{id}
  const schemaTemplate = new ResourceTemplate("vault://schemas/{id}", { list: undefined });
  server.resource(
    "vault-schema",
    schemaTemplate,
    { description: "Entity type schema definition" },
    async (uri, variables) => {
      const rawId = variables["id"];
      const schemaId = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "");
      const schema = await resolvers.getSchema(schemaId);
      if (!schema) {
        return { contents: [{ uri: uri.href, text: `Schema ${schemaId} not found`, mimeType: "text/plain" }] };
      }
      return { contents: [{ uri: uri.href, text: JSON.stringify(schema, null, 2), mimeType: "application/json" }] };
    }
  );

  // vault://search — static URI, query params in URL
  server.resource(
    "vault-search",
    "vault://search",
    { description: "Search results from the vault" },
    async (uri) => {
      const q = uri.searchParams.get("q") ?? "";
      const kind = (uri.searchParams.get("kind") ?? "hybrid") as "fts" | "semantic" | "hybrid";
      const limit = Number(uri.searchParams.get("limit") ?? "10");

      if (!q) {
        return { contents: [{ uri: uri.href, text: "Missing 'q' search parameter", mimeType: "text/plain" }] };
      }

      const results = await resolvers.search({ query: q, kind, limit });
      return { contents: [{ uri: uri.href, text: JSON.stringify(results, null, 2), mimeType: "application/json" }] };
    }
  );
}

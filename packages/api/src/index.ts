// HTTP server
export { createHttpServer } from "./http/index.js";
export type { HttpServer, HttpServerOptions } from "./http/index.js";
export { createEventBus } from "./http/index.js";
export type { EventBus } from "./http/index.js";

// MCP server
export { createMcpServer } from "./mcp/index.js";
export type { McpOptions, McpServerHandle } from "./mcp/index.js";

// Shared types
export type {
  Logger,
  Resolvers,
  CreateEntityInput,
  UpdateEntityInput,
  CreateRelationInput,
  ListEntitiesFilter,
  SearchOptions,
  VaultEvent,
  EventKind,
} from "./types.js";

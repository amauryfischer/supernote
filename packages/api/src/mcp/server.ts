import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Resolvers, Logger } from "../types.js";
import { registerMcpTools } from "./tools.js";
import { registerMcpResources } from "./resources.js";

export interface McpOptions {
  resolvers: Resolvers;
  logger?: Logger;
  /** Server display name */
  name?: string;
  version?: string;
}

export interface McpServerHandle {
  /** Connect via stdio (for Claude Desktop). Returns when disconnected. */
  connectStdio(): Promise<void>;
  /** Underlying server instance for advanced use */
  server: McpServer;
}

export function createMcpServer(opts: McpOptions): McpServerHandle {
  const { resolvers, logger, name = "supernote-vault", version = "1.0.0" } = opts;

  const server = new McpServer({ name, version });

  registerMcpTools(server, resolvers);
  registerMcpResources(server, resolvers);

  async function connectStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    logger?.info("MCP server connecting via stdio");
    await server.connect(transport);
    logger?.info("MCP stdio transport closed");
  }

  return { connectStdio, server };
}

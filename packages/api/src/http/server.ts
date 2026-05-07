import { Hono } from "hono";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";
import type { Resolvers, Logger } from "../types.js";
import { generateToken } from "./token.js";
import { createAuthMiddleware, createRateLimitMiddleware, createCorsMiddleware } from "./middleware.js";
import { createEventBus } from "./event-bus.js";
import { createWsServer } from "./websocket.js";
import { buildEntitiesRouter } from "./routes/entities.js";
import { buildSchemasRouter } from "./routes/schemas.js";
import { buildSearchRouter } from "./routes/search.js";
import { buildRelationsRouter } from "./routes/relations.js";
import { buildTagsRouter } from "./routes/tags.js";

export interface HttpServerOptions {
  host?: string;
  port?: number;
  token?: string;
  resolvers: Resolvers;
  logger?: Logger;
}

export interface HttpServer {
  start(): Promise<{ url: string; port: number; token: string }>;
  stop(): Promise<void>;
  getUrl(): string;
  getToken(): string;
  /** Publish an event to all WS subscribers */
  publish: ReturnType<typeof createEventBus>["publish"];
}

export function createHttpServer(opts: HttpServerOptions): HttpServer {
  const host = opts.host ?? "127.0.0.1";
  const token = opts.token ?? generateToken();
  const { resolvers, logger } = opts;

  let _url = "";
  let _server: Server | null = null;
  const bus = createEventBus();

  function buildApp(): Hono {
    const app = new Hono();

    app.use("*", createCorsMiddleware());
    app.use("*", createRateLimitMiddleware());

    app.get("/api/v1/health", (c) => c.json({ status: "ok" }));

    const auth = createAuthMiddleware(token);
    const api = new Hono();
    api.use("*", auth);

    api.route("/entities", buildEntitiesRouter(resolvers, bus));
    api.route("/schemas", buildSchemasRouter(resolvers));
    api.route("/search", buildSearchRouter(resolvers));
    api.route("/relations", buildRelationsRouter(resolvers, bus));
    api.route("/tags", buildTagsRouter(resolvers));

    app.route("/api/v1", api);

    app.notFound((c) => c.json({ error: "Not Found" }, 404));

    return app;
  }

  return {
    async start() {
      const app = buildApp();
      const wsServer = createWsServer({ bus, token, logger });

      return new Promise((resolve, reject) => {
        try {
          const server = serve(
            { fetch: app.fetch, hostname: host, port: opts.port ?? 0 },
            (info) => {
              _server = server as unknown as Server;
              _url = `http://${info.address}:${info.port}`;
              logger?.info(`HTTP server started at ${_url}`);
              logger?.info(`HTTP token: ${token}`);

              (server as unknown as Server).on("upgrade", (req, socket, head) => {
                const url = new URL(req.url ?? "/", _url);
                if (url.pathname === "/api/v1/events") {
                  wsServer.handleUpgrade(req, socket as import("node:stream").Duplex, head as Buffer);
                } else {
                  socket.destroy();
                }
              });

              resolve({ url: _url, port: info.port, token });
            }
          );
        } catch (err) {
          reject(err);
        }
      });
    },

    async stop() {
      if (_server) {
        await new Promise<void>((resolve, reject) => {
          _server!.close((err) => (err ? reject(err) : resolve()));
        });
        _server = null;
        _url = "";
        logger?.info("HTTP server stopped");
      }
    },

    getUrl() { return _url; },
    getToken() { return token; },
    publish: bus.publish.bind(bus),
  };
}

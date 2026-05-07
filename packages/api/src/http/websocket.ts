import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, WebSocket } from "ws";
import type { EventBus } from "./event-bus.js";
import type { Logger } from "../types.js";

export interface WsServerOptions {
  bus: EventBus;
  token: string;
  logger?: Logger;
}

export interface WsServer {
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
  close(): void;
  clientCount(): number;
}

export function createWsServer(opts: WsServerOptions): WsServer {
  const { bus, token, logger } = opts;
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: WebSocket) => {
    logger?.debug("WS client connected");
    const unsubscribe = bus.subscribe((event) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event));
      }
    });

    ws.on("close", () => {
      unsubscribe();
      logger?.debug("WS client disconnected");
    });

    ws.on("error", (err) => {
      logger?.error("WS client error", err);
    });
  });

  function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    const authToken = url.searchParams.get("token");

    if (authToken !== token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }

  return {
    handleUpgrade,
    close: () => wss.close(),
    clientCount: () => wss.clients.size,
  };
}

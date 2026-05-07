import { createConnection } from "node:net";
import { existsSync } from "node:fs";
import type { JsonRpcRequest, JsonRpcResponse, TransportOutcome } from "./types.js";

let _requestId = 1;

function nextId(): number {
  return _requestId++;
}

export function isSocketAvailable(socketPath: string): boolean {
  return existsSync(socketPath);
}

export async function callSocket<T>(
  socketPath: string,
  method: string,
  params: unknown,
): Promise<TransportOutcome<T>> {
  const id = nextId();
  const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

  return new Promise((resolve) => {
    const client = createConnection(socketPath);
    let buffer = "";
    const timeout = setTimeout(() => {
      client.destroy();
      resolve({ ok: false, error: "Socket timeout", transport: "socket" });
    }, 5000);

    client.on("connect", () => {
      client.write(JSON.stringify(request) + "\n");
    });

    client.on("data", (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx === -1) return;
      clearTimeout(timeout);
      const line = buffer.slice(0, newlineIdx);
      client.destroy();
      try {
        const response = JSON.parse(line) as JsonRpcResponse<T>;
        if (response.error) {
          resolve({ ok: false, error: response.error.message, transport: "socket" });
        } else {
          resolve({ ok: true, data: response.result as T, transport: "socket" });
        }
      } catch {
        resolve({ ok: false, error: "Invalid JSON response", transport: "socket" });
      }
    });

    client.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: err.message, transport: "socket" });
    });
  });
}

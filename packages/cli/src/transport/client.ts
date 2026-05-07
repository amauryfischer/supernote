import type { SupernoteConfig, RuntimeJson } from "../config/index.js";
import { readRuntimeJson } from "../config/index.js";
import { isSocketAvailable, callSocket } from "./socket.js";
import { callHttp } from "./http.js";
import type { TransportOutcome } from "./types.js";

export type { TransportOutcome };

/** Send an RPC call via socket → HTTP → error (caller handles offline). */
export async function rpc<T>(
  config: SupernoteConfig,
  method: string,
  params: unknown = {},
): Promise<TransportOutcome<T>> {
  // 1. Try Unix socket
  if (isSocketAvailable(config.socketPath)) {
    const result = await callSocket<T>(config.socketPath, method, params);
    if (result.ok) return result;
    // Socket exists but call failed — fall through to HTTP
  }

  // 2. Try HTTP fallback
  const runtime: RuntimeJson = readRuntimeJson();
  if (runtime.token && runtime.port) {
    const result = await callHttp<T>(runtime.token, runtime.port, method, params);
    if (result.ok) return result;
  }

  return { ok: false, error: "App is not running (no socket, no HTTP)", transport: "offline" };
}

/**
 * tRPC IPC Bridge — wires the appRouterImpl to Electron's ipcMain.
 *
 * Protocol:
 *   channel : 'trpc'
 *   message : { path: string, type: 'query' | 'mutation', input?: unknown }
 *   response: { ok: true, value: unknown } | { ok: false, error: IpcError }
 *
 * Errors never propagate as raw exceptions (spec §9).
 */

import { ipcMain } from "electron";
import { appRouterImpl } from "./app-router-impl.js";
import { getVaultManager, setVaultManager } from "./services/service-registry.js";
import type { VaultManager } from "./services/vault-manager.js";
import { logger } from "./logger.js";

interface IpcMessage {
  path: string;
  type: "query" | "mutation";
  input?: unknown;
}

interface IpcOk {
  ok: true;
  value: unknown;
}

interface IpcErr {
  ok: false;
  error: { code: string; message: string; details?: unknown };
}

type IpcResponse = IpcOk | IpcErr;

export function registerTrpcBridge(vaultManager: VaultManager): void {
  setVaultManager(vaultManager);

  ipcMain.handle("trpc", async (_event, msg: IpcMessage): Promise<IpcResponse> => {
    const { path, type, input } = msg;
    logger.debug("tRPC IPC call", { path, type });

    try {
      const vm = getVaultManager();
      const ctx = { vaultPath: vm.getCurrentVault()?.path ?? null };
      const caller = appRouterImpl.createCaller(ctx);
      const value = await resolveProcedure(caller, path, input);
      return { ok: true, value };
    } catch (err: unknown) {
      const error = toIpcError(err);
      logger.warn("tRPC error", { path, code: error.code, message: error.message });
      return { ok: false, error };
    }
  });

  logger.info("tRPC IPC bridge registered");
}

function toIpcError(err: unknown): { code: string; message: string; details?: unknown } {
  if (err && typeof err === "object" && "code" in err && "message" in err) {
    const e = err as { code: string; message: string; cause?: unknown };
    return { code: e.code, message: e.message, details: e.cause };
  }
  return { code: "INTERNAL_SERVER_ERROR", message: String(err) };
}

async function resolveProcedure(
  caller: ReturnType<typeof appRouterImpl.createCaller>,
  path: string,
  input: unknown,
): Promise<unknown> {
  const segments = path.split(".");
  let current: unknown = caller;

  for (const seg of segments) {
    if (typeof current !== "object" || current === null || !(seg in (current as object))) {
      throw { code: "NOT_FOUND", message: `Procedure '${path}' not found` };
    }
    current = (current as Record<string, unknown>)[seg];
  }

  if (typeof current !== "function") {
    throw { code: "NOT_FOUND", message: `'${path}' is not callable` };
  }

  return (current as (input: unknown) => Promise<unknown>)(input);
}

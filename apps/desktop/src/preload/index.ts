/**
 * Preload script — runs in an isolated context with Node.js access.
 *
 * Exposes `window.__supernoteIPC` via contextBridge for the renderer to
 * send tRPC-over-IPC messages to the main process.
 *
 * Security: contextIsolation=true, nodeIntegration=false, sandbox=true.
 * Only the explicit API surface below is reachable from the renderer.
 */

import { contextBridge, ipcRenderer } from "electron";

export interface SupernoteIPC {
  /**
   * Invoke a tRPC procedure via IPC.
   *
   * @param path   Dot-separated procedure path, e.g. "vault.open"
   * @param type   "query" or "mutation"
   * @param input  Procedure input (will be JSON-serialized)
   */
  invoke: (
    path: string,
    type: "query" | "mutation",
    input?: unknown,
  ) => Promise<IpcResponse>;
}

export interface IpcOk {
  ok: true;
  value: unknown;
}

export interface IpcErr {
  ok: false;
  error: { code: string; message: string; details?: unknown };
}

export type IpcResponse = IpcOk | IpcErr;

const supernoteIPC: SupernoteIPC = {
  invoke: (path, type, input) =>
    ipcRenderer.invoke("trpc", { path, type, input }) as Promise<IpcResponse>,
};

contextBridge.exposeInMainWorld("__supernoteIPC", supernoteIPC);

// ── Global type augmentation (used by the renderer) ───────────────────────
// Declare the type in global.d.ts next to this file.

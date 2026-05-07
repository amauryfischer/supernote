/**
 * Preload script — runs in an isolated context with Node.js access.
 *
 * Exposes `window.__supernoteIPC` via contextBridge for the renderer to
 * send tRPC-over-IPC messages to the main process.
 *
 * Security: contextIsolation=true, nodeIntegration=false, sandbox=true.
 * Only the explicit API surface below is reachable from the renderer.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

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

// ── Auto-updater bridge ────────────────────────────────────────────────────

export interface UpdaterAPI {
  /** Register a listener called when an update is available. */
  onUpdateAvailable: (cb: (info: unknown) => void) => () => void;
  /** Register a listener called when an update has been downloaded. */
  onUpdateDownloaded: (cb: (info: unknown) => void) => () => void;
  /** Trigger immediate download of an available update. */
  downloadUpdate: () => Promise<void>;
  /** Quit and install a downloaded update immediately. */
  quitAndInstall: () => void;
}

const updaterAPI: UpdaterAPI = {
  onUpdateAvailable: (cb) => {
    const handler = (_event: IpcRendererEvent, info: unknown) => cb(info);
    ipcRenderer.on("update-available", handler);
    return () => ipcRenderer.removeListener("update-available", handler);
  },
  onUpdateDownloaded: (cb) => {
    const handler = (_event: IpcRendererEvent, info: unknown) => cb(info);
    ipcRenderer.on("update-downloaded", handler);
    return () => ipcRenderer.removeListener("update-downloaded", handler);
  },
  downloadUpdate: () => ipcRenderer.invoke("updater:download") as Promise<void>,
  quitAndInstall: () => ipcRenderer.send("updater:quit-and-install"),
};

contextBridge.exposeInMainWorld("__supernoteUpdater", updaterAPI);

// ── Global type augmentation (used by the renderer) ───────────────────────
// Declare the type in global.d.ts next to this file.

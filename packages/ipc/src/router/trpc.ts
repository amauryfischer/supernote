import { initTRPC } from "@trpc/server";
import { notImplemented } from "../errors/index.js";

/**
 * tRPC context for the IPC bridge.
 *
 * Bridge design decision: we use a **custom IPC bridge** (not electron-trpc)
 * for the following reasons:
 *
 * 1. This package has zero dependency on Electron — it only defines contracts.
 *    The bridge adapters (`ipcMain.handle` / `ipcRenderer.invoke`) live in
 *    `apps/desktop`, which depends on this package and on Electron.
 * 2. `electron-trpc` v0.7.1 targets tRPC v10 and has not been validated for
 *    tRPC v11's updated link/adapter API. A custom bridge is safer and simpler.
 * 3. The custom bridge gives full control over serialization (JSON with
 *    Result<T,E> wrapping) and error mapping per spec §9.
 *
 * Bridge contract (for apps/desktop to implement):
 *   - Main process: for each procedure call arriving via `ipcMain.handle`,
 *     deserialize input, call the tRPC caller, serialize output.
 *   - Renderer preload: expose `window.__ipc.query(path, input)` via
 *     `contextBridge.exposeInMainWorld`, wrapping `ipcRenderer.invoke`.
 *   - Renderer client: create a `createTRPCClient` with a custom link that
 *     delegates to `window.__ipc`.
 */
export interface IpcContext {
  /** Absolute path of the currently open vault, or null if none. */
  vaultPath: string | null;
}

const t = initTRPC.context<IpcContext>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const mergeRouters = t.mergeRouters;

/** Stub procedure factory — all unimplemented procedures use this. */
export function stubProcedure(name: string) {
  return publicProcedure.query(() => {
    throw notImplemented(name);
  });
}

/**
 * Type declarations for the contextBridge-exposed API.
 * Referenced in the renderer's tsconfig "include" or via triple-slash reference.
 */

import type { SupernoteIPC, UpdaterAPI } from "./index.js";

declare global {
  interface Window {
    /** tRPC-over-IPC bridge exposed by the preload script. */
    __supernoteIPC: SupernoteIPC;
    /** Auto-updater bridge exposed by the preload script. */
    __supernoteUpdater: UpdaterAPI;
  }
}

export {};

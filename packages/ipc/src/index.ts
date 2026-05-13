/**
 * @supernote/ipc
 *
 * tRPC contract definitions for the Supernote renderer ↔ main process IPC bridge.
 *
 * ## Bridge architecture
 *
 * This package is **pure TypeScript** with no dependency on Electron.
 * The IPC wiring lives in apps/desktop:
 *
 * - `apps/desktop/src/main/ipc-handler.ts`
 *   Registers `ipcMain.handle('trpc', ...)` and calls `appRouter.createCaller(ctx)`.
 *
 * - `apps/desktop/src/preload/ipc-bridge.ts`
 *   Exposes `window.__ipc.query(path, input)` via `contextBridge`.
 *
 * - `apps/web/src/lib/trpc.ts`
 *   Creates `createTRPCClient` with a custom `ipcLink` that delegates to
 *   `window.__ipc`.
 *
 * This pattern (no electron-trpc) was chosen for:
 * 1. Zero Electron coupling in this package.
 * 2. No tRPC v10 vs v11 compatibility risk.
 * 3. Full control over serialization and Result<T,E> wrapping (spec §9).
 */

// ── Router ────────────────────────────────────────────────────────────────────
export { appRouter, type AppRouter } from "./router/index.js";
export { router, publicProcedure, type IpcContext } from "./router/trpc.js";

// ── Sub-routers ───────────────────────────────────────────────────────────────
export { vaultRouter, type VaultRouter } from "./router/vault.router.js";
export { foldersRouter, type FoldersRouter } from "./router/folders.router.js";
export { entitiesRouter, type EntitiesRouter } from "./router/entities.router.js";
export { schemasRouter, type SchemasRouter } from "./router/schemas.router.js";
export { viewsRouter, type ViewsRouter } from "./router/views.router.js";
export { relationsRouter, type RelationsRouter } from "./router/relations.router.js";
export { tagsRouter, type TagsRouter } from "./router/tags.router.js";
export {
  automationsRouter,
  routinesRouter,
  type AutomationsRouter,
  type RoutinesRouter,
} from "./router/automations.router.js";
export { templatesRouter, type TemplatesRouter } from "./router/templates.router.js";
export { gitRouter, type GitRouter } from "./router/git.router.js";
export { searchRouter, type SearchRouter } from "./router/search.router.js";
export { systemRouter, type SystemRouter } from "./router/system.router.js";

// ── Errors ────────────────────────────────────────────────────────────────────
export {
  type IpcError,
  type IpcErrorCode,
  type IpcErrorPayload,
  toTRPCError,
  notImplemented,
  ipcError,
} from "./errors/index.js";

// ── Result ────────────────────────────────────────────────────────────────────
export {
  type IpcResult,
  type IpcOk,
  type IpcErr,
  ipcOk,
  ipcErr,
  isIpcOk,
  isIpcErr,
} from "./result/index.js";

// ── Zod schemas & inferred types ──────────────────────────────────────────────
export * from "./schemas/vault.js";
export * from "./schemas/folders.js";
export * from "./schemas/entities.js";
export * from "./schemas/schemas.js";
export * from "./schemas/relations.js";
export * from "./schemas/tags.js";
export * from "./schemas/views.js";
export * from "./schemas/automations.js";
export * from "./schemas/templates.js";
export * from "./schemas/git.js";
export * from "./schemas/search.js";
export * from "./schemas/system.js";

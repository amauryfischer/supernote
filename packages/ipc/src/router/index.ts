import { router } from "./trpc.js";
import { vaultRouter } from "./vault.router.js";
import { entitiesRouter } from "./entities.router.js";
import { schemasRouter } from "./schemas.router.js";
import { relationsRouter } from "./relations.router.js";
import { tagsRouter } from "./tags.router.js";
import { viewsRouter } from "./views.router.js";
import { automationsRouter, routinesRouter } from "./automations.router.js";
import { gitRouter } from "./git.router.js";
import { searchRouter } from "./search.router.js";
import { systemRouter } from "./system.router.js";

/**
 * Root tRPC router for the Supernote IPC bridge.
 *
 * All sub-routers are stubs — procedures throw NOT_IMPLEMENTED until the main
 * process registers concrete implementations by replacing the caller in
 * apps/desktop.
 */
export const appRouter = router({
  vault: vaultRouter,
  entities: entitiesRouter,
  schemas: schemasRouter,
  relations: relationsRouter,
  tags: tagsRouter,
  views: viewsRouter,
  automations: automationsRouter,
  routines: routinesRouter,
  git: gitRouter,
  search: searchRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;

export { router, type IpcContext } from "./trpc.js";
export { vaultRouter, type VaultRouter } from "./vault.router.js";
export { entitiesRouter, type EntitiesRouter } from "./entities.router.js";
export { schemasRouter, type SchemasRouter } from "./schemas.router.js";
export { relationsRouter, type RelationsRouter } from "./relations.router.js";
export { tagsRouter, type TagsRouter } from "./tags.router.js";
export { viewsRouter, type ViewsRouter } from "./views.router.js";
export { automationsRouter, routinesRouter, type AutomationsRouter, type RoutinesRouter } from "./automations.router.js";
export { gitRouter, type GitRouter } from "./git.router.js";
export { searchRouter, type SearchRouter } from "./search.router.js";
export { systemRouter, type SystemRouter } from "./system.router.js";

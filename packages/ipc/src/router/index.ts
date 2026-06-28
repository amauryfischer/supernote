import { router } from "./trpc.js";
import { aiRouter } from "./ai.router.js";
import { vaultRouter } from "./vault.router.js";
import { entitiesRouter } from "./entities.router.js";
import { schemasRouter } from "./schemas.router.js";
import { relationsRouter } from "./relations.router.js";
import { tagsRouter } from "./tags.router.js";
import { automationsRouter, routinesRouter } from "./automations.router.js";
import { variablesRouter } from "./variables.router.js";
import { formulasRouter } from "./formulas.router.js";
import { templatesRouter } from "./templates.router.js";
import { gitRouter } from "./git.router.js";
import { syncRouter } from "./sync.router.js";
import { searchRouter } from "./search.router.js";
import { systemRouter } from "./system.router.js";
import { viewsRouter } from "./views.router.js";
import { mailRouter } from "./mail.router.js";

/**
 * Root tRPC router for the Supernote IPC bridge.
 *
 * All sub-routers are stubs — procedures throw NOT_IMPLEMENTED until the main
 * process registers concrete implementations by replacing the caller in
 * apps/desktop.
 */
export const appRouter = router({
  ai: aiRouter,
  vault: vaultRouter,
  entities: entitiesRouter,
  schemas: schemasRouter,
  views: viewsRouter,
  relations: relationsRouter,
  tags: tagsRouter,
  automations: automationsRouter,
  routines: routinesRouter,
  variables: variablesRouter,
  formulas: formulasRouter,
  templates: templatesRouter,
  git: gitRouter,
  sync: syncRouter,
  search: searchRouter,
  system: systemRouter,
  mail: mailRouter,
});

export type AppRouter = typeof appRouter;

export { aiRouter, type AIRouter } from "./ai.router.js";
export { router, type IpcContext } from "./trpc.js";
export { vaultRouter, type VaultRouter } from "./vault.router.js";
export { foldersRouter, type FoldersRouter } from "./folders.router.js";
export { entitiesRouter, type EntitiesRouter } from "./entities.router.js";
export { schemasRouter, type SchemasRouter } from "./schemas.router.js";
export { viewsRouter, type ViewsRouter } from "./views.router.js";
export { relationsRouter, type RelationsRouter } from "./relations.router.js";
export { tagsRouter, type TagsRouter } from "./tags.router.js";
export { automationsRouter, routinesRouter, type AutomationsRouter, type RoutinesRouter } from "./automations.router.js";
export { variablesRouter, type VariablesRouter } from "./variables.router.js";
export { formulasRouter, type FormulasRouter } from "./formulas.router.js";
export { templatesRouter, type TemplatesRouter } from "./templates.router.js";
export { gitRouter, type GitRouter } from "./git.router.js";
export { syncRouter, type SyncRouter } from "./sync.router.js";
export { searchRouter, type SearchRouter } from "./search.router.js";
export { systemRouter, type SystemRouter } from "./system.router.js";
export { mailRouter, type MailRouter } from "./mail.router.js";

// ============================================================
// Client — SupernoteAPI implementation (postMessage wrappers)
// ============================================================

import type { ClientTransport } from "./transport.js";
import type {
  SupernoteAPI,
  EntitiesAPI,
  SchemasAPI,
  SearchAPI,
  UiAPI,
  StorageAPI,
  HooksAPI,
  EntityFilter,
  EntityCreateInput,
  EntityUpdateInput,
  NotificationOptions,
  HookHandler,
} from "./types.js";
import type {
  BlockContribution,
  SlashItem,
  CommandContribution,
  SidebarPanel,
  PluginHook,
} from "../manifest/types.js";

function makeEntitiesAPI(transport: ClientTransport): EntitiesAPI {
  return {
    list: (filter?: EntityFilter) =>
      transport.call("entities.list", filter ?? {}),
    get: (id: string) => transport.call("entities.get", { id }),
    create: (data: EntityCreateInput) => transport.call("entities.create", data),
    update: (id: string, data: EntityUpdateInput) =>
      transport.call("entities.update", { id, data }),
    delete: (id: string) => transport.call("entities.delete", { id }),
  };
}

function makeSchemasAPI(transport: ClientTransport): SchemasAPI {
  return {
    list: () => transport.call("schemas.list", {}),
    get: (id: string) => transport.call("schemas.get", { id }),
  };
}

function makeSearchAPI(transport: ClientTransport): SearchAPI {
  return {
    query: (q: string) => transport.call("search.query", { q }),
  };
}

function makeUiAPI(transport: ClientTransport): UiAPI {
  return {
    registerBlock: (definition: BlockContribution) => {
      void transport.call("ui.registerBlock", definition);
    },
    registerSlashItem: (item: SlashItem) => {
      void transport.call("ui.registerSlashItem", item);
    },
    registerCommand: (cmd: CommandContribution) => {
      void transport.call("ui.registerCommand", cmd);
    },
    showNotification: (opts: NotificationOptions) => {
      void transport.call("ui.showNotification", opts);
    },
    addSidebarPanel: (panel: SidebarPanel) => {
      void transport.call("ui.addSidebarPanel", panel);
    },
  };
}

function makeStorageAPI(transport: ClientTransport): StorageAPI {
  return {
    get: (key: string) => transport.call("storage.get", { key }),
    set: (key: string, value: unknown) =>
      transport.call("storage.set", { key, value }),
  };
}

function makeHooksAPI(transport: ClientTransport): HooksAPI {
  return {
    on: (event: PluginHook, handler: HookHandler) => {
      transport.onEvent(event, handler as (data: unknown) => void);
      void transport.call("hooks.on", { event });
    },
  };
}

function makeFetchWrapper(transport: ClientTransport): typeof globalThis.fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return transport
      .call<{ status: number; body: string; headers: Record<string, string> }>(
        "network.fetch",
        { url, opts: init }
      )
      .then(({ status, body, headers }) => {
        return new Response(body, { status, headers });
      });
  };
}

/**
 * Creates the SupernoteAPI object bound to a given transport.
 * Optionally includes the fetch API if network:fetch permission is granted.
 */
export function createSupernoteAPI(
  transport: ClientTransport,
  permissions: string[]
): SupernoteAPI {
  const api: SupernoteAPI = {
    entities: makeEntitiesAPI(transport),
    schemas: makeSchemasAPI(transport),
    search: makeSearchAPI(transport),
    ui: makeUiAPI(transport),
    storage: makeStorageAPI(transport),
    hooks: makeHooksAPI(transport),
  };

  if (permissions.includes("network:fetch")) {
    return { ...api, fetch: makeFetchWrapper(transport) };
  }

  return api;
}

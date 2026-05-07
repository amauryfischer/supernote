// ============================================================
// Client — SupernoteAPI types exposed to plugin developers
// ============================================================

import type { Entity, EntityType } from "@supernote/core/types";
import type {
  BlockContribution,
  SlashItem,
  CommandContribution,
  SidebarPanel,
  PluginHook,
} from "../manifest/types.js";

// ------ Entities API ----------------------------------------

export interface EntitiesAPI {
  list(filter?: EntityFilter): Promise<Entity[]>;
  get(id: string): Promise<Entity | null>;
  create(data: EntityCreateInput): Promise<Entity>;
  update(id: string, data: EntityUpdateInput): Promise<Entity>;
  delete(id: string): Promise<void>;
}

export interface EntityFilter {
  readonly typeId?: string;
  readonly tags?: string[];
  readonly limit?: number;
  readonly offset?: number;
}

export interface EntityCreateInput {
  readonly typeId: string;
  readonly fields?: Record<string, unknown>;
  readonly body?: string;
  readonly tags?: string[];
}

export interface EntityUpdateInput {
  readonly fields?: Record<string, unknown>;
  readonly body?: string;
  readonly tags?: string[];
}

// ------ Schemas API -----------------------------------------

export interface SchemasAPI {
  list(): Promise<EntityType[]>;
  get(id: string): Promise<EntityType | null>;
}

// ------ Search API ------------------------------------------

export interface SearchResult {
  readonly entityId: string;
  readonly score: number;
  readonly snippet?: string;
}

export interface SearchAPI {
  query(q: string): Promise<SearchResult[]>;
}

// ------ UI API ----------------------------------------------

export interface NotificationOptions {
  readonly title: string;
  readonly body: string;
  readonly level?: "info" | "success" | "warning" | "error";
}

export interface UiAPI {
  registerBlock(definition: BlockContribution): void;
  registerSlashItem(item: SlashItem): void;
  registerCommand(cmd: CommandContribution): void;
  showNotification(opts: NotificationOptions): void;
  addSidebarPanel(panel: SidebarPanel): void;
}

// ------ Storage API -----------------------------------------

export interface StorageAPI {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

// ------ Hooks API -------------------------------------------

export type HookHandler<T = unknown> = (payload: T) => void | Promise<void>;

export interface HooksAPI {
  on(event: PluginHook, handler: HookHandler): void;
}

// ------ Root API --------------------------------------------

export interface SupernoteAPI {
  readonly entities: EntitiesAPI;
  readonly schemas: SchemasAPI;
  readonly search: SearchAPI;
  readonly ui: UiAPI;
  readonly storage: StorageAPI;
  readonly hooks: HooksAPI;
  /** Only present if 'network:fetch' permission is granted */
  readonly fetch?: typeof globalThis.fetch;
}

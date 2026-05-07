// ============================================================
// Plugin Manifest — types and Zod schema
// ============================================================

import { z } from "zod";

// ------ Permission ------------------------------------------

export const PLUGIN_PERMISSIONS = [
  "entities:read",
  "entities:write",
  "fs:read",
  "fs:write",
  "network:fetch",
  "notifications:show",
  "commands:register",
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

// ------ Contributions ---------------------------------------

export interface BlockContribution {
  readonly type: string;
  readonly label: string;
  readonly icon?: string;
  readonly description?: string;
}

export interface SlashItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string;
  readonly keywords?: string[];
}

export interface CommandContribution {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly keybinding?: string;
}

export interface SidebarPanel {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly order?: number;
}

export interface ViewContribution {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
}

// ------ Manifest --------------------------------------------

export type PluginHook = "beforeSave" | "afterSave" | "onCreate" | "onDelete";

export interface PluginManifest {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly author?: {
    readonly name: string;
    readonly url?: string;
  };
  readonly description?: string;
  readonly entry: string;
  readonly permissions: PluginPermission[];
  readonly contributes?: {
    readonly blocks?: BlockContribution[];
    readonly slashItems?: SlashItem[];
    readonly commands?: CommandContribution[];
    readonly sidebarPanels?: SidebarPanel[];
    readonly views?: ViewContribution[];
  };
  readonly hooks?: PluginHook[];
}

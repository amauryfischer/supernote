// ============================================================
// Plugin Manifest — Zod runtime validation
// ============================================================

import { z } from "zod";
import { PLUGIN_PERMISSIONS } from "./types.js";

const blockContributionSchema = z.object({
  type: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  description: z.string().optional(),
});

const slashItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  keywords: z.array(z.string()).optional(),
});

const commandContributionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  keybinding: z.string().optional(),
});

const sidebarPanelSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  order: z.number().optional(),
});

const viewContributionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
});

/** Zod schema for PluginManifest runtime validation */
export const pluginManifestSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(
      /^[a-z0-9]+(\.[a-z0-9]+)+$/,
      "Plugin ID must be reverse-domain notation, e.g. com.example.myplugin"
    ),
  name: z.string().min(1).max(128),
  version: z
    .string()
    .regex(
      /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/,
      "Version must be valid semver"
    ),
  author: z
    .object({
      name: z.string().min(1),
      url: z.string().url().optional(),
    })
    .optional(),
  description: z.string().max(512).optional(),
  entry: z.string().min(1),
  permissions: z.array(z.enum(PLUGIN_PERMISSIONS)),
  contributes: z
    .object({
      blocks: z.array(blockContributionSchema).optional(),
      slashItems: z.array(slashItemSchema).optional(),
      commands: z.array(commandContributionSchema).optional(),
      sidebarPanels: z.array(sidebarPanelSchema).optional(),
      views: z.array(viewContributionSchema).optional(),
    })
    .optional(),
  hooks: z
    .array(z.enum(["beforeSave", "afterSave", "onCreate", "onDelete"]))
    .optional(),
});

export type ValidatedPluginManifest = z.infer<typeof pluginManifestSchema>;

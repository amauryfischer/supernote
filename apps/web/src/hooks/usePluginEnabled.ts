"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Built-in feature plugins are toggled via localStorage flags. The key
 * convention is `supernote.plugins.{slug}` and the stored value is the
 * literal string "true" or "false". Anything else falls back to the
 * provided `defaultOn` so a fresh install picks up sensible defaults
 * without writing to storage on first read.
 */
export const PLUGIN_STORAGE_PREFIX = "supernote.plugins.";

export function pluginStorageKey(slug: string): string {
  return `${PLUGIN_STORAGE_PREFIX}${slug}`;
}

function readFlag(slug: string, defaultOn: boolean): boolean {
  if (typeof window === "undefined") return defaultOn;
  try {
    const raw = window.localStorage.getItem(pluginStorageKey(slug));
    if (raw === "true") return true;
    if (raw === "false") return false;
    return defaultOn;
  } catch {
    return defaultOn;
  }
}

/**
 * Reactively read a plugin's enabled flag from localStorage.
 *
 * - SSR-safe: returns `defaultOn` until the client effect runs, avoiding
 *   hydration mismatches when the sidebar is rendered on the server.
 * - Cross-tab sync: subscribes to the native `storage` event so toggling
 *   a plugin from Settings updates every open tab.
 * - Same-tab sync: also listens for a custom `supernote:plugins-changed`
 *   event dispatched by `setPluginEnabled` since `storage` events do not
 *   fire in the tab that performed the write.
 */
export function usePluginEnabled(slug: string, defaultOn: boolean): boolean {
  const [enabled, setEnabled] = useState<boolean>(defaultOn);

  useEffect(() => {
    setEnabled(readFlag(slug, defaultOn));

    const key = pluginStorageKey(slug);
    function handleStorage(e: StorageEvent) {
      if (e.key !== key) return;
      setEnabled(readFlag(slug, defaultOn));
    }
    function handleCustom(e: Event) {
      const detail = (e as CustomEvent<{ slug?: string }>).detail;
      if (!detail || detail.slug === slug) {
        setEnabled(readFlag(slug, defaultOn));
      }
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener("supernote:plugins-changed", handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("supernote:plugins-changed", handleCustom);
    };
  }, [slug, defaultOn]);

  return enabled;
}

/**
 * Persist a plugin's enabled flag and notify same-tab subscribers.
 * Returns the value that was written so callers can update local UI
 * state synchronously without re-reading from storage.
 */
export function setPluginEnabled(slug: string, enabled: boolean): boolean {
  if (typeof window === "undefined") return enabled;
  try {
    window.localStorage.setItem(pluginStorageKey(slug), enabled ? "true" : "false");
    window.dispatchEvent(
      new CustomEvent("supernote:plugins-changed", { detail: { slug, enabled } }),
    );
  } catch {
    /* ignore quota / privacy-mode errors — UI state still updates */
  }
  return enabled;
}

/**
 * Imperative read for non-React callers (e.g. route guards).
 */
export function getPluginEnabled(slug: string, defaultOn: boolean): boolean {
  return readFlag(slug, defaultOn);
}

export interface BuiltInPlugin {
  slug: string;
  /** Default state for users who have never toggled this plugin. */
  defaultOn: boolean;
  /** Display name (French — matches the rest of the settings UI). */
  name: string;
  description: string;
}

/**
 * Catalogue of built-in features that can be toggled from Settings → Plugins.
 * All default on; preserved for power users who want to hide them.
 */
export const BUILT_IN_PLUGINS: BuiltInPlugin[] = [
  {
    slug: "routines",
    defaultOn: true,
    name: "Routines",
    description: "Automatisations et workflows récurrents.",
  },
];

/**
 * Map plugin slug → sidebar `href` so the sidebar can dynamically hide
 * disabled entries without hard-coding the relationship in two places.
 * The const-assertion + explicit shape lets TypeScript narrow each
 * member to a string literal (no `string | undefined`).
 */
export const PLUGIN_HREF_BY_SLUG = {
  routines: "/routines",
} as const satisfies Record<string, string>;

export type PluginSlug = keyof typeof PLUGIN_HREF_BY_SLUG;

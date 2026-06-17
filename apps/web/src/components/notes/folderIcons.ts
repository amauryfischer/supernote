/**
 * Folder icon catalogue — the full Phosphor set (~1500 glyphs), one lazy
 * chunk per glyph.
 *
 * `import.meta.glob` turns every `dist/csr/*.es.js` icon module into an
 * on-demand loader. The icon NAMES are available synchronously (inlined at
 * build time), so the picker can list and search them immediately; only the
 * component for a glyph that's actually rendered (a visible picker cell, or a
 * folder's assigned icon) is fetched. Crucially the full set never lands in
 * the eagerly-preloaded vendor chunk — the few dozen icons the app shell
 * statically imports stay there (~104 kB gzip), everything else is a separate
 * lazy chunk.
 *
 * Stored keys are the bare glyph name (e.g. `Folder`, `MapTrifold`), matching
 * the csr filenames.
 */

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";

// Keys from the old curated registry whose name never matched a csr filename
// (the picker labelled `MapTrifold` as "Map"). Map them forward so folders
// saved before the full-set migration keep their icon.
const LEGACY_ALIASES: Record<string, string> = { Map: "MapTrifold" };

const modules = import.meta.glob<Record<string, PhosphorIcon>>(
  "../../../node_modules/@phosphor-icons/react/dist/csr/*.es.js",
);

function iconNameFromPath(path: string): string {
  const match = path.match(/\/([^/]+)\.es\.js$/);
  return match ? match[1]! : path;
}

const loaderByName: Record<string, () => Promise<Record<string, PhosphorIcon>>> =
  {};
for (const [path, loader] of Object.entries(modules)) {
  loaderByName[iconNameFromPath(path)] = loader;
}

/** Every glyph name, sorted — synchronously available for the picker list. */
export const ALL_FOLDER_ICON_NAMES: ReadonlyArray<string> = Object.keys(
  loaderByName,
).sort((a, b) => a.localeCompare(b));

const cache = new Map<string, PhosphorIcon>();

// Each csr module exports the glyph under its bare name plus an `…Icon` alias
// (and occasionally extra aliases); the bare name matches the filename.
function pickComponent(
  mod: Record<string, PhosphorIcon>,
  name: string,
): PhosphorIcon | undefined {
  return mod[name] ?? mod[`${name}Icon`] ?? Object.values(mod)[0];
}

/** The component if its chunk is already in memory, else `null`. */
export function loadedFolderIcon(name: string): PhosphorIcon | null {
  return cache.get(name) ?? null;
}

/** Fetch a single glyph's chunk (once) and return its component. */
export async function loadFolderIcon(
  name: string,
): Promise<PhosphorIcon | null> {
  const cached = cache.get(name);
  if (cached) return cached;
  const key = loaderByName[name] ? name : LEGACY_ALIASES[name];
  const loader = key ? loaderByName[key] : undefined;
  if (!key || !loader) return null;
  const mod = await loader();
  const Icon = pickComponent(mod, key);
  if (!Icon) return null;
  cache.set(name, Icon);
  return Icon;
}

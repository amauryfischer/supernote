/**
 * Utilities for computing scoped CSS-variable overrides when a folder has a
 * custom hex color. The override is applied as inline `style` on a wrapper
 * element — never on `:root` — so only the editor pane / selected tree row
 * picks up the tint.
 */

import type { Folder } from "@/components/notes/fixtures";
import { nameToHue } from "@/components/contacts/utils";

/**
 * Parse "#rrggbb" or "#rgb" hex strings into the canonical 7-char form
 * (#rrggbb). Used to build the subtle overlay hex.
 */
function normalizeHex(hex: string): string | null {
  const clean = hex.replace(/^#/, "");
  if (clean.length === 3) {
    return `#${clean[0]!}${clean[0]!}${clean[1]!}${clean[1]!}${clean[2]!}${clean[2]!}`;
  }
  if (clean.length === 6) {
    return `#${clean}`;
  }
  return null;
}

export interface FolderAccentVars {
  "--accent": string;
  "--accent-hover": string;
  "--accent-subtle": string;
  "--accent-foreground": string;
}

/**
 * Derive the accent CSS-variable overrides from a folder hex color.
 * Returns `null` when the color is falsy or unparseable (no override needed).
 */
export function folderAccentVars(color: string | undefined | null): FolderAccentVars | null {
  if (!color) return null;
  const norm = normalizeHex(color);
  if (!norm) return null;
  return {
    "--accent": norm,
    "--accent-hover": norm,
    "--accent-subtle": `${norm}1f`,
    "--accent-foreground": "oklch(0.995 0 0)",
  };
}

/**
 * Given the active folder path and the full folder tree, resolve the color
 * to apply. Walks the active path from the exact match up to the root and
 * returns the first ancestor with a custom color — so a sub-folder without
 * its own color inherits the closest parent's tint. The exact folder always
 * wins over any ancestor when both have a color.
 */
export function folderColorFromTree(
  folderPath: string | null,
  folders: Folder[],
): string | null {
  if (!folderPath) return null;
  const colorByPath = new Map<string, string>();
  collectColors(folders, colorByPath);

  const segments = folderPath.split("/");
  while (segments.length > 0) {
    const color = colorByPath.get(segments.join("/"));
    if (color) return color;
    segments.pop();
  }
  return null;
}

const DOMAIN_HUES = [25, 55, 95, 145, 180, 215, 245, 275, 305, 340];

/** Teinte dérivée du nom d'un dossier racine ; Inbox reste neutre. La luminance vit dans les tokens `--sn-domain-l/c` (clair/sombre). */
export function derivedDomainColor(rootName: string): string | null {
  if (!rootName || rootName === "Inbox") return null;
  return `oklch(var(--sn-domain-l) var(--sn-domain-c) ${DOMAIN_HUES[Math.floor(nameToHue(rootName) / 36)]})`;
}

/** `--sn-domain` d'une note ou d'un dossier : couleur posée sur lui ou un ancêtre, sinon teinte de sa racine. */
export function folderDomainVars(folderPath: string | null, folders: Folder[]): Record<string, string> {
  const color = folderColorFromTree(folderPath, folders) ?? derivedDomainColor(folderPath?.split("/")[0] ?? "");
  return color ? { "--sn-domain": color, "--sn-domain-tint": color } : {};
}

function collectColors(nodes: Folder[], out: Map<string, string>): void {
  for (const node of nodes) {
    if (node.color) out.set(node.path, node.color);
    if (node.children) collectColors(node.children, out);
  }
}

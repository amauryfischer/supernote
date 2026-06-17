/**
 * Renders a folder's custom Phosphor glyph, lazy-loading just that glyph's
 * chunk. Until it arrives we render the eager `Folder` fallback (already in the
 * main bundle); if the chunk is already cached (picker showed it, or a sibling
 * folder uses it) the real glyph renders synchronously with no flash.
 */

import { useEffect, useState } from "react";
import { Folder } from "@phosphor-icons/react";
import type { Icon as PhosphorIcon, IconWeight } from "@phosphor-icons/react";
import { loadedFolderIcon, loadFolderIcon } from "./folderIcons";

interface CustomFolderGlyphProps {
  name: string;
  size?: number;
  color?: string;
  weight?: IconWeight;
}

export function CustomFolderGlyph({
  name,
  size = 14,
  color,
  weight = "regular",
}: CustomFolderGlyphProps) {
  const [Icon, setIcon] = useState<PhosphorIcon>(
    () => loadedFolderIcon(name) ?? Folder,
  );

  useEffect(() => {
    let alive = true;
    const cached = loadedFolderIcon(name);
    if (cached) {
      setIcon(() => cached);
      return;
    }
    // Name changed to an unloaded glyph — show the fallback until it arrives.
    setIcon(() => Folder);
    void loadFolderIcon(name).then((loaded) => {
      if (alive && loaded) setIcon(() => loaded);
    });
    return () => {
      alive = false;
    };
  }, [name]);

  return <Icon size={size} color={color} weight={weight} />;
}

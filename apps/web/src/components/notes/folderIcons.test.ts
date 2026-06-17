import { describe, expect, it } from "vitest";
import {
  ALL_FOLDER_ICON_NAMES,
  loadedFolderIcon,
  loadFolderIcon,
} from "./folderIcons";
import { Folder, FolderOpen, MapTrifold } from "@phosphor-icons/react";

describe("folderIcons", () => {
  it("lists the full glyph catalogue, sorted and unique", () => {
    expect(ALL_FOLDER_ICON_NAMES.length).toBeGreaterThan(1400);
    expect(new Set(ALL_FOLDER_ICON_NAMES).size).toBe(
      ALL_FOLDER_ICON_NAMES.length,
    );
    expect(ALL_FOLDER_ICON_NAMES).toContain("Folder");
    const sorted = [...ALL_FOLDER_ICON_NAMES].sort((a, b) =>
      a.localeCompare(b),
    );
    expect(ALL_FOLDER_ICON_NAMES).toEqual(sorted);
  });

  it("lazy-loads a glyph to its component", async () => {
    expect(loadedFolderIcon("Folder")).toBeNull();
    expect(await loadFolderIcon("Folder")).toBe(Folder);
    expect(await loadFolderIcon("FolderOpen")).toBe(FolderOpen);
  });

  it("caches a glyph after first load", async () => {
    await loadFolderIcon("Folder");
    expect(loadedFolderIcon("Folder")).toBe(Folder);
  });

  it("maps the legacy 'Map' key to MapTrifold", async () => {
    expect(await loadFolderIcon("Map")).toBe(MapTrifold);
  });

  it("returns null for unknown names", async () => {
    expect(await loadFolderIcon("NotARealIcon")).toBeNull();
  });
});

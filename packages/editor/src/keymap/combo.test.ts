import { describe, it, expect } from "vitest";
import { canonicalToTiptap } from "./combo";

describe("canonicalToTiptap", () => {
  it("met en forme Tiptap (modificateurs capitalisés, '+'→'-')", () => {
    expect(canonicalToTiptap("mod+b")).toBe("Mod-b");
    expect(canonicalToTiptap("mod+shift+s")).toBe("Mod-Shift-s");
    expect(canonicalToTiptap("alt+up")).toBe("Alt-ArrowUp");
    expect(canonicalToTiptap("alt+shift+down")).toBe("Alt-Shift-ArrowDown");
    expect(canonicalToTiptap("mod+alt+1")).toBe("Mod-Alt-1");
  });
  it("renvoie '' pour un combo vide", () => {
    expect(canonicalToTiptap("")).toBe("");
  });
});

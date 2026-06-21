import { describe, it, expect } from "vitest";
import { resolveBindings, type ResolverActionMeta } from "./resolve";

const META: ResolverActionMeta[] = [
  { id: "format.bold", defaultCombo: "mod+b" },
  { id: "format.link", defaultCombo: "mod+k" },
  { id: "edition.undo", defaultCombo: "mod+z", reserved: true },
];

describe("resolveBindings", () => {
  it("utilise les défauts quand pas d'override", () => {
    const r = resolveBindings(META, {});
    expect(r.byAction["format.bold"]).toBe("mod+b");
    expect(r.bindings["mod+b"]).toBe("format.bold");
    expect(r.conflicts).toHaveLength(0);
  });

  it("applique un override", () => {
    const r = resolveBindings(META, { "format.bold": "mod+shift+b" });
    expect(r.byAction["format.bold"]).toBe("mod+shift+b");
    expect(r.bindings["mod+shift+b"]).toBe("format.bold");
    expect(r.bindings["mod+b"]).toBeUndefined();
  });

  it("signale un doublon (deux actions, même combo)", () => {
    const r = resolveBindings(META, { "format.link": "mod+b" });
    const dup = r.conflicts.find((c) => c.kind === "duplicate");
    expect(dup?.combo).toBe("mod+b");
    expect(dup?.actionIds.sort()).toEqual(["format.bold", "format.link"]);
  });

  it("signale un combo réservé écrasé", () => {
    const r = resolveBindings(META, { "format.bold": "mod+c" });
    expect(r.conflicts.some((c) => c.kind === "reserved" && c.combo === "mod+c")).toBe(true);
  });

  it("signale l'écrasement d'une nav OS native", () => {
    const r = resolveBindings(META, { "format.bold": "alt+left" });
    expect(r.conflicts.some((c) => c.kind === "native")).toBe(true);
  });
});

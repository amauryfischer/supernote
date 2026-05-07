import { describe, it, expect } from "vitest";
import { slugify, vaultRelative, entityFilePath } from "./index.js";
import type { Entity, EntityType } from "../types/index.js";

describe("slugify", () => {
  it("lowercases and replaces spaces with dashes", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("removes diacritics", () => {
    expect(slugify("Résumé Ångström")).toBe("resume-angstrom");
  });

  it("removes special characters", () => {
    expect(slugify("foo/bar!?@")).toBe("foobar");
  });

  it("collapses multiple dashes", () => {
    expect(slugify("foo   bar")).toBe("foo-bar");
  });

  it("trims leading/trailing dashes", () => {
    expect(slugify("  hello  ")).toBe("hello");
  });
});

describe("vaultRelative", () => {
  it("returns relative path from vault root", () => {
    expect(vaultRelative("/vault/Notes/foo.md", "/vault")).toBe("Notes/foo.md");
  });

  it("passes through non-absolute paths unchanged", () => {
    expect(vaultRelative("relative/path.md", "/vault")).toBe("relative/path.md");
  });
});

describe("entityFilePath", () => {
  const entity: Entity = {
    id: "01HX2KABCDEFGHIJKLMNOPQR",
    typeId: "note",
    filePath: "",
    fields: { name: "My First Note" },
    body: "",
    createdAt: new Date("2026-05-07T12:00:00Z"),
    updatedAt: new Date("2026-05-07T12:00:00Z"),
    tags: [],
  };

  const entityType: EntityType = {
    id: "note",
    name: "Note",
    plural: "Notes",
    fields: [],
    defaultPath: "Notes",
    fileNamePattern: "{slug}",
  };

  it("generates path with slug from name", () => {
    const p = entityFilePath(entity, entityType, "/vault");
    expect(p).toBe("/vault/Notes/my-first-note.md");
  });

  it("generates path with id pattern", () => {
    const t: EntityType = { ...entityType, fileNamePattern: "{id}" };
    const p = entityFilePath(entity, t, "/vault");
    expect(p).toContain(entity.id);
    expect(p.endsWith(".md")).toBe(true);
  });

  it("generates path with date pattern", () => {
    const t: EntityType = { ...entityType, defaultPath: "Daily", fileNamePattern: "{date}" };
    const p = entityFilePath(entity, t, "/vault");
    expect(p).toBe("/vault/Daily/2026-05-07.md");
  });
});

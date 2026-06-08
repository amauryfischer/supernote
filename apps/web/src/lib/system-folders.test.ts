import { describe, it, expect } from "vitest";
import { isSystemFolder, SYSTEM_FOLDER_ROOTS } from "./system-folders";

describe("isSystemFolder", () => {
  it("flags every typed-entity root so it stays out of /notes", () => {
    for (const root of SYSTEM_FOLDER_ROOTS) {
      expect(isSystemFolder(root)).toBe(true);
      expect(isSystemFolder(`${root}/nested/thing`)).toBe(true);
    }
  });

  it("hides Habitudes — managed by /habits like Todos by /todos", () => {
    expect(isSystemFolder("Habitudes")).toBe(true);
    expect(isSystemFolder("Habitudes/2026")).toBe(true);
  });

  it("leaves regular note folders visible", () => {
    expect(isSystemFolder("Inbox")).toBe(false);
    expect(isSystemFolder("Projets")).toBe(false);
    // A user folder that merely starts with a system name's letters is fine.
    expect(isSystemFolder("Todolist")).toBe(false);
    expect(isSystemFolder("Habitudes-perso")).toBe(false);
  });
});

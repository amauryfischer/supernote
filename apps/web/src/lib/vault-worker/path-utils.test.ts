import { describe, it, expect } from "vitest";
import {
  stripPathSlashes,
  sanitizePath,
  sanitizeFolderPath,
  derivePath,
} from "./path-utils";

describe("stripPathSlashes", () => {
  it("strips a leading slash", () => {
    expect(stripPathSlashes("/Inbox")).toBe("Inbox");
  });

  it("strips a trailing slash", () => {
    expect(stripPathSlashes("Inbox/")).toBe("Inbox");
  });

  it("strips both leading and trailing slashes", () => {
    expect(stripPathSlashes("/Inbox/")).toBe("Inbox");
  });

  it("strips repeated edge slashes", () => {
    expect(stripPathSlashes("///a/b///")).toBe("a/b");
  });

  it("leaves interior slashes intact", () => {
    expect(stripPathSlashes("a/b/c")).toBe("a/b/c");
  });

  it("collapses a string of only slashes to empty", () => {
    expect(stripPathSlashes("///")).toBe("");
  });

  it("passes through an already-clean path", () => {
    expect(stripPathSlashes("Maison/Notes")).toBe("Maison/Notes");
  });
});

describe("sanitizePath", () => {
  it("removes parent-dir escapes", () => {
    expect(sanitizePath("../secret")).toBe("secret");
  });

  it("removes every occurrence of `..`", () => {
    expect(sanitizePath("a/../../b")).toBe("a///b");
  });

  it("strips leading and trailing slashes", () => {
    expect(sanitizePath("/a/b/")).toBe("a/b");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizePath("  Inbox/note.md  ")).toBe("Inbox/note.md");
  });

  it("matches the original inline transform order (strip dotdot then edge slashes then trim)", () => {
    // Regression lock: the original code chained
    // `.replace(/\.\./g,"").replace(/^\/+|\/+$/g,"").trim()`. Order is
    // load-bearing — trim runs LAST, so a slash adjacent to outer whitespace
    // is NOT stripped. We assert against the exact replayed chain.
    const input = "  /../Inbox/sub/note.md/ ";
    const expected = input
      .replace(/\.\./g, "")
      .replace(/^\/+|\/+$/g, "")
      .trim();
    expect(sanitizePath(input)).toBe(expected);
    // No outer whitespace → edge slashes ARE stripped.
    expect(sanitizePath("/../Inbox/sub/note.md/")).toBe("Inbox/sub/note.md");
  });

  it("returns empty for a path that's only escapes and slashes", () => {
    expect(sanitizePath("/../")).toBe("");
  });

  it("preserves a clean relative path verbatim", () => {
    expect(sanitizePath("Inbox/nouvelle-note.md")).toBe("Inbox/nouvelle-note.md");
  });
});

describe("sanitizeFolderPath", () => {
  it("drops empty interior segments", () => {
    expect(sanitizeFolderPath("a//b")).toBe("a/b");
  });

  it("drops `..` segments entirely", () => {
    expect(sanitizeFolderPath("a/../b")).toBe("a/b");
  });

  it("strips leading and trailing slashes", () => {
    expect(sanitizeFolderPath("/Maison/Notes/")).toBe("Maison/Notes");
  });

  it("combines escapes, empties and edge slashes", () => {
    expect(sanitizeFolderPath("/Maison/../Inbox//Sub/")).toBe("Maison/Inbox/Sub");
  });

  it("returns empty for an all-`..` path", () => {
    expect(sanitizeFolderPath("../../..")).toBe("");
  });

  it("passes through a clean folder path", () => {
    expect(sanitizeFolderPath("Maison/Notes")).toBe("Maison/Notes");
  });

  it("matches the original inline closure transform", () => {
    const input = "/work//projects/../q3/";
    const expected = input
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter((seg) => seg && seg !== "..")
      .join("/");
    expect(sanitizeFolderPath(input)).toBe(expected);
    expect(sanitizeFolderPath(input)).toBe("work/projects/q3");
  });
});

describe("derivePath", () => {
  it("returns empty string for null", () => {
    expect(derivePath(null)).toBe("");
  });

  it("returns empty string for empty input", () => {
    expect(derivePath("")).toBe("");
  });

  it("strips the .md extension (case-insensitive)", () => {
    expect(derivePath("note.MD")).toBe("note");
  });

  it("joins path segments with spaces for FTS tokenization", () => {
    expect(derivePath("Maison VLM/Courses Leroy Merlin/note.md")).toBe(
      "Maison VLM Courses Leroy Merlin note",
    );
  });

  it("only strips a trailing .md, not interior ones", () => {
    expect(derivePath("a.md/b.md")).toBe("a.md b");
  });

  it("handles a bare filename", () => {
    expect(derivePath("note.md")).toBe("note");
  });
});

import { describe, it, expect } from "vitest";
import { decodeTagPaths, TAG_PATH_SEPARATOR } from "./tag-paths";

/**
 * Encode tag paths exactly like the SQL `GROUP_CONCAT(t.path, char(31))` does,
 * so the test exercises the real round-trip the sync snapshot relies on.
 */
function encodeTagPaths(paths: string[]): string {
  return paths.join(TAG_PATH_SEPARATOR);
}

describe("tag-paths decodeTagPaths", () => {
  it("round-trips multi-segment paths through the US separator", () => {
    const paths = ["work/projects/q3", "perso/santé", "idées"];
    const encoded = encodeTagPaths(paths);
    expect(decodeTagPaths(encoded)).toEqual(paths);
  });

  it("preserves a single multi-segment path intact (regression: split('') exploded it into chars)", () => {
    const path = "work/projects/q3";
    const decoded = decodeTagPaths(encodeTagPaths([path]));
    expect(decoded).toEqual([path]);
    // The old bug split on the empty string and returned one entry per char.
    expect(decoded).not.toEqual(path.split(""));
    expect(decoded[0]).toBe(path);
  });

  it("keeps punctuation that would break a comma-joined encoding", () => {
    // A tag path may legitimately contain commas, quotes, slashes — none of
    // which collide with the non-printable US separator.
    const paths = ["a,b", 'quote"d', "with/slash"];
    expect(decodeTagPaths(encodeTagPaths(paths))).toEqual(paths);
  });

  it("returns an empty array for NULL (no tags) and empty string", () => {
    expect(decodeTagPaths(null)).toEqual([]);
    expect(decodeTagPaths(undefined)).toEqual([]);
    expect(decodeTagPaths("")).toEqual([]);
  });

  it("drops phantom empty segments from stray separators", () => {
    expect(decodeTagPaths(`a${TAG_PATH_SEPARATOR}${TAG_PATH_SEPARATOR}b`)).toEqual(["a", "b"]);
    expect(decodeTagPaths(`${TAG_PATH_SEPARATOR}solo`)).toEqual(["solo"]);
  });

  it("ignores non-string cell values defensively", () => {
    expect(decodeTagPaths(42)).toEqual([]);
    expect(decodeTagPaths({})).toEqual([]);
  });
});

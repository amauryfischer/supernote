import { describe, it, expect } from "vitest";
import {
  canvasToFileBridge,
  parseExcalidrawFileContent,
  excalidrawSiblingPath,
} from "../../src/excalidraw/file-bridge.js";
import { toExcalidraw } from "../../src/excalidraw/to-excalidraw.js";
import { fromExcalidraw } from "../../src/excalidraw/from-excalidraw.js";
import type { CanvasDocument } from "../../src/types/canvas.js";

describe("excalidrawSiblingPath", () => {
  it("replaces .md extension with .excalidraw", () => {
    expect(excalidrawSiblingPath("Canvas/MonCanvas.md")).toBe(
      "Canvas/MonCanvas.excalidraw",
    );
    expect(excalidrawSiblingPath("notes/2026/sub.md")).toBe(
      "notes/2026/sub.excalidraw",
    );
  });

  it("returns null for non-.md paths", () => {
    expect(excalidrawSiblingPath("file.txt")).toBeNull();
    expect(excalidrawSiblingPath("nofext")).toBeNull();
  });
});

describe("canvasToFileBridge", () => {
  it("emits an excalidraw file content + frontmatter pointer", () => {
    const result = canvasToFileBridge({
      mdPath: "Inbox/note.md",
      doc: { nodes: [], edges: [] },
    });
    expect(result).not.toBeNull();
    expect(result!.excalidrawPath).toBe("Inbox/note.excalidraw");
    expect(result!.canvasFileFrontmatter).toBe("note.excalidraw");
    const parsed = JSON.parse(result!.excalidrawContent);
    expect(parsed.type).toBe("excalidraw");
    expect(parsed.version).toBe(2);
    expect(parsed.source).toBe("supernote");
    expect(parsed.elements).toEqual([]);
  });

  it("returns null when path is not a .md", () => {
    expect(
      canvasToFileBridge({ mdPath: "weird", doc: { nodes: [], edges: [] } }),
    ).toBeNull();
  });

  it("includes excalidrawElements in the output", () => {
    const result = canvasToFileBridge({
      mdPath: "x.md",
      doc: {
        nodes: [],
        edges: [],
        excalidrawElements: [
          { id: "a", type: "rectangle", x: 0, y: 0, width: 10, height: 10 },
        ],
      },
    });
    const parsed = JSON.parse(result!.excalidrawContent);
    expect(parsed.elements).toHaveLength(1);
    expect(parsed.elements[0].id).toBe("a");
  });
});

describe("parseExcalidrawFileContent", () => {
  it("parses a valid excalidraw file back into a CanvasDocument", () => {
    const content = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: "supernote",
      elements: [],
    });
    const doc = parseExcalidrawFileContent(content);
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
  });

  it("returns empty doc on malformed JSON", () => {
    expect(parseExcalidrawFileContent("{not json")).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("preserves excalidrawElements through the bridge", () => {
    const original: CanvasDocument = {
      nodes: [],
      edges: [],
      excalidrawElements: [
        { id: "r1", type: "rectangle", x: 10, y: 20, width: 100, height: 50 },
        {
          id: "r2",
          type: "rectangle",
          customData: { kind: "entity-ref", entityId: "e1", entityName: "X", entityType: "contact" },
        },
      ],
    };
    const content = JSON.stringify(toExcalidraw(original));
    const back = parseExcalidrawFileContent(content);
    expect(back.excalidrawElements).toEqual(original.excalidrawElements);
  });
});

describe("toExcalidraw/fromExcalidraw round-trip", () => {
  const FIXTURES: { name: string; doc: CanvasDocument }[] = [
    { name: "empty", doc: { nodes: [], edges: [] } },
    {
      name: "single rectangle",
      doc: {
        nodes: [],
        edges: [],
        excalidrawElements: [
          { id: "r1", type: "rectangle", x: 0, y: 0, width: 100, height: 50 },
        ],
      },
    },
    {
      name: "entity-ref rectangle with link + customData",
      doc: {
        nodes: [],
        edges: [],
        excalidrawElements: [
          {
            id: "er-1",
            type: "rectangle",
            x: 10,
            y: 10,
            width: 200,
            height: 80,
            link: "supernote-entity://entity-1?type=contact",
            customData: {
              kind: "entity-ref",
              entityId: "entity-1",
              entityName: "Pierre",
              entityType: "contact",
            },
          },
        ],
      },
    },
    {
      name: "freedraw + text mix",
      doc: {
        nodes: [],
        edges: [],
        excalidrawElements: [
          { id: "fd", type: "freedraw", x: 0, y: 0, width: 10, height: 10, points: [[0, 0], [10, 10]] },
          { id: "t1", type: "text", x: 5, y: 5, width: 100, height: 30, text: "Hello" },
        ],
      },
    },
  ];

  for (const { name, doc } of FIXTURES) {
    it(`preserves: ${name}`, () => {
      const back = fromExcalidraw(toExcalidraw(doc));
      expect(back.nodes).toEqual([]);
      expect(back.edges).toEqual([]);
      expect(back.excalidrawElements ?? []).toEqual(
        doc.excalidrawElements ?? [],
      );
    });
  }

  it("returns empty doc on garbage input without throwing", () => {
    expect(fromExcalidraw(null)).toEqual({ nodes: [], edges: [] });
    expect(fromExcalidraw({ elements: "no" })).toEqual({ nodes: [], edges: [] });
    expect(fromExcalidraw(undefined)).toEqual({ nodes: [], edges: [] });
  });
});

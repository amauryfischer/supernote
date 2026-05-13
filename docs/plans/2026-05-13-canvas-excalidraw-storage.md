# Canvas Excalidraw Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tout canvas Supernote (autonome ou vue canvas d'une note) est aussi écrit comme fichier `.excalidraw` standard côte à côte dans le vault, ouvrable sur excalidraw.com.

**Architecture :** Nouvelle bibliothèque de conversion `CanvasDocument ↔ ExcalidrawFile` dans `packages/canvas`, branchée dans le vault-worker autour des points de lecture/écriture des entités. Les nodes typés Supernote (crm, query, file, link, group) deviennent des rectangles + texte Excalidraw porteurs d'un `customData.supernote` qui permet la reconversion. Migration one-shot au boot pour les canvas existants.

**Tech Stack :** TypeScript, Vitest, FSA (File System Access API), tRPC, SQLite (sql.js dans le worker).

**Spec :** `docs/specs/2026-05-13-canvas-excalidraw-storage-design.md`

---

## File Structure

```
packages/canvas/src/
  excalidraw/
    types.ts                    # ExcalidrawFile, ExcalidrawElement (subset)
    custom-data.ts              # schema + parsers customData.supernote
    to-excalidraw.ts            # CanvasDocument → ExcalidrawFile
    from-excalidraw.ts          # ExcalidrawFile → CanvasDocument
    file-bridge.ts              # bridge orchestration (pure, testable)
    index.ts                    # exports publics
  serializer/
    index.ts                    # FIX: ajouter excalidrawElements

packages/canvas/__tests__/excalidraw/
  to-excalidraw.test.ts
  from-excalidraw.test.ts
  round-trip.test.ts
  file-bridge.test.ts

apps/web/src/lib/vault-worker/
  canvas-excalidraw-io.ts       # NEW: FSA read/write d'un .excalidraw frère
  migration-canvas-excalidraw.ts # NEW: migration idempotente
  worker-router.ts              # MODIFY: hook dans entitiesCreate / Update / load
```

**Responsabilités par fichier :**

- `types.ts` : types stricts du format `.excalidraw` v2 (sous-ensemble — on n'a pas besoin de tout Excalidraw, juste `id`, `type`, `x`, `y`, `width`, `height`, `text`, `customData`, `groupIds`, `startBinding`, `endBinding`).
- `custom-data.ts` : `SupernoteCustomData` discriminated union (node / edge), `encodeNodeCustom`, `encodeEdgeCustom`, `decodeCustom` qui retourne `null` si pas le bon shape.
- `to-excalidraw.ts` : fonction pure, pas d'IO.
- `from-excalidraw.ts` : idem, fonction pure inverse.
- `file-bridge.ts` : orchestration des conversions et des décisions de chemin (basename `.md` → basename `.excalidraw`). Fonction pure prenant `{ mdPath, canvasJson }` et renvoyant `{ excalidrawPath, excalidrawContent, frontmatterCanvasFile }`. **Pas de FSA dedans** — testable sans navigateur.
- `canvas-excalidraw-io.ts` : seule couche IO. Branche `file-bridge` sur `writeVaultFile` / `readVaultFile`.
- `migration-canvas-excalidraw.ts` : itération sur la table `entity`, appel du bridge, write fichiers.

---

## Task 1: Fix bug — serializer omits `excalidrawElements`

**Files:**
- Modify: `packages/canvas/src/serializer/index.ts`
- Test: `packages/canvas/__tests__/serializer.test.ts`

Le sérialiseur actuel n'écrit pas le calque libre — il serait perdu à la sauvegarde si on appelait `serializeCanvas`. Doit être corrigé avant tout pour éviter une migration partielle.

- [ ] **Step 1: Add failing test for excalidrawElements round-trip**

Append to `packages/canvas/__tests__/serializer.test.ts`:

```ts
describe("excalidrawElements round-trip", () => {
  it("preserves excalidrawElements through serialize → parse", () => {
    const doc: CanvasDocument = {
      nodes: [],
      edges: [],
      excalidrawElements: [
        { id: "el-1", type: "freedraw", points: [[0, 0], [10, 10]] },
      ],
    };
    const json = serializeCanvas(doc);
    const parsed = parseCanvas(json);
    expect(parsed.excalidrawElements).toEqual(doc.excalidrawElements);
  });
});
```

Add `excalidrawElements` import if needed; `CanvasDocument` already exports the field.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/canvas && pnpm test -- serializer`
Expected: FAIL — `parsed.excalidrawElements` is `undefined`.

- [ ] **Step 3: Add parsing in parseCanvas**

In `packages/canvas/src/serializer/index.ts`, inside `parseCanvas` after the `metadata` block (around line 200), and before the early returns, add the excalidrawElements branch:

Modify the final return in `parseCanvas`:

```ts
const rawExcali = Array.isArray((raw as RawDocument & { excalidrawElements?: unknown })["excalidrawElements"])
  ? ((raw as { excalidrawElements: unknown[] }).excalidrawElements)
  : null;

const excalidrawElements = rawExcali
  ? rawExcali.filter(
      (e): e is { id: string; type: string; [k: string]: unknown } =>
        typeof e === "object" && e !== null &&
        typeof (e as Record<string, unknown>)["id"] === "string" &&
        typeof (e as Record<string, unknown>)["type"] === "string",
    )
  : undefined;

const doc: CanvasDocument = {
  nodes,
  edges,
  ...(excalidrawElements && { excalidrawElements }),
};
```

(replace the existing `const doc: CanvasDocument = { nodes, edges };` line and adapt the `metadata` block to spread `doc`).

- [ ] **Step 4: Add serialization in serializeCanvas**

Replace the body of `serializeCanvas`:

```ts
export function serializeCanvas(doc: CanvasDocument): string {
  return JSON.stringify(
    {
      nodes: doc.nodes,
      edges: doc.edges,
      ...(doc.excalidrawElements && { excalidrawElements: doc.excalidrawElements }),
      ...(doc.metadata && { metadata: doc.metadata }),
    },
    null,
    2,
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/canvas && pnpm test -- serializer`
Expected: PASS, including the new test and all existing ones.

- [ ] **Step 6: Commit**

```bash
git add packages/canvas/src/serializer/index.ts packages/canvas/__tests__/serializer.test.ts
git commit -m "fix(canvas): serializer drops excalidrawElements on round-trip"
```

---

## Task 2: Excalidraw types module

**Files:**
- Create: `packages/canvas/src/excalidraw/types.ts`

Strictly-typed subset of the Excalidraw v2 file format. Only what we actually emit/read — keep small.

- [ ] **Step 1: Create types module**

Create `packages/canvas/src/excalidraw/types.ts`:

```ts
// ============================================================
// Excalidraw v2 file format — subset used by Supernote.
// Reference: https://docs.excalidraw.com/docs/codebase/json-schema
// ============================================================

export type ExcalidrawElementType =
  | "rectangle"
  | "ellipse"
  | "diamond"
  | "text"
  | "arrow"
  | "line"
  | "freedraw"
  | "image"
  | string; // forward-compat: unknown types survive

export interface ExcalidrawBinding {
  readonly elementId: string;
  readonly focus?: number;
  readonly gap?: number;
}

/**
 * Excalidraw element. We type only what we set; everything else passes
 * through as `[key: string]: unknown` so external-edits survive.
 */
export interface ExcalidrawElement {
  readonly id: string;
  readonly type: ExcalidrawElementType;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly groupIds?: readonly string[];
  readonly text?: string;
  readonly customData?: Record<string, unknown>;
  readonly startBinding?: ExcalidrawBinding | null;
  readonly endBinding?: ExcalidrawBinding | null;
  readonly [key: string]: unknown;
}

export interface ExcalidrawAppState {
  readonly viewBackgroundColor?: string;
  readonly gridSize?: number | null;
  readonly [key: string]: unknown;
}

export interface ExcalidrawFile {
  readonly type: "excalidraw";
  readonly version: 2;
  readonly source: string;
  readonly elements: readonly ExcalidrawElement[];
  readonly appState?: ExcalidrawAppState;
  readonly files?: Record<string, unknown>;
}

export const EXCALIDRAW_SOURCE = "supernote";
```

- [ ] **Step 2: Commit**

```bash
git add packages/canvas/src/excalidraw/types.ts
git commit -m "feat(canvas): excalidraw v2 types subset"
```

---

## Task 3: `customData.supernote` schema and codec

**Files:**
- Create: `packages/canvas/src/excalidraw/custom-data.ts`
- Test: `packages/canvas/__tests__/excalidraw/custom-data.test.ts`

Discriminated union describing how a Supernote node/edge is encoded inside an Excalidraw element's `customData`. The decoder must be defensive: random user-edited objects must not crash it.

- [ ] **Step 1: Write failing tests**

Create `packages/canvas/__tests__/excalidraw/custom-data.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  encodeNodeCustom,
  encodeEdgeCustom,
  decodeCustom,
  type SupernoteCustomData,
} from "../../src/excalidraw/custom-data.js";

describe("encodeNodeCustom", () => {
  it("encodes a text node payload", () => {
    const c = encodeNodeCustom({
      kind: "node",
      nodeType: "text",
      nodeId: "n1",
      text: "Hello",
    });
    expect(c.supernote).toEqual({
      kind: "node",
      nodeType: "text",
      nodeId: "n1",
      text: "Hello",
    });
  });

  it("encodes a crm node payload", () => {
    const c = encodeNodeCustom({
      kind: "node",
      nodeType: "crm",
      nodeId: "n2",
      entityId: "e1",
      display: "card",
    });
    expect(c.supernote.entityId).toBe("e1");
  });
});

describe("encodeEdgeCustom", () => {
  it("encodes an edge payload", () => {
    const c = encodeEdgeCustom({
      kind: "edge",
      edgeId: "edge-1",
      fromNode: "a",
      toNode: "b",
    });
    expect(c.supernote.kind).toBe("edge");
  });
});

describe("decodeCustom", () => {
  it("returns null for missing customData", () => {
    expect(decodeCustom(undefined)).toBeNull();
    expect(decodeCustom({})).toBeNull();
  });

  it("returns null for malformed payloads", () => {
    expect(decodeCustom({ supernote: "not-an-object" })).toBeNull();
    expect(decodeCustom({ supernote: { kind: "unknown" } })).toBeNull();
    expect(decodeCustom({ supernote: { kind: "node" } })).toBeNull(); // missing nodeType
  });

  it("round-trips a node payload", () => {
    const original: SupernoteCustomData = {
      kind: "node",
      nodeType: "query",
      nodeId: "n3",
      query: "tag:projet",
      viewMode: "list",
    };
    const encoded = encodeNodeCustom(original);
    const decoded = decodeCustom(encoded);
    expect(decoded).toEqual(original);
  });

  it("round-trips an edge payload", () => {
    const original: SupernoteCustomData = {
      kind: "edge",
      edgeId: "e1",
      fromNode: "a",
      toNode: "b",
      label: "depends",
    };
    const encoded = encodeEdgeCustom(original);
    expect(decodeCustom(encoded)).toEqual(original);
  });

  it("preserves unknown sibling keys in customData", () => {
    const encoded = { supernote: { kind: "node", nodeType: "text", nodeId: "x", text: "hi" }, otherTool: { foo: 1 } };
    const decoded = decodeCustom(encoded);
    expect(decoded?.kind).toBe("node");
  });
});
```

- [ ] **Step 2: Run test to verify it fails (module missing)**

Run: `cd packages/canvas && pnpm test -- custom-data`
Expected: FAIL — cannot find module `custom-data`.

- [ ] **Step 3: Implement custom-data.ts**

Create `packages/canvas/src/excalidraw/custom-data.ts`:

```ts
import type { CanvasNodeSide } from "../types/canvas.js";

// ----- Discriminated union -------------------------------------------

export type SupernoteNodeKind =
  | "text"
  | "file"
  | "link"
  | "group"
  | "crm"
  | "query";

export interface SupernoteNodeCustomBase {
  readonly kind: "node";
  readonly nodeType: SupernoteNodeKind;
  readonly nodeId: string;
}

export interface SupernoteTextNodeCustom extends SupernoteNodeCustomBase {
  readonly nodeType: "text";
  readonly text: string;
}
export interface SupernoteFileNodeCustom extends SupernoteNodeCustomBase {
  readonly nodeType: "file";
  readonly file: string;
  readonly subpath?: string;
}
export interface SupernoteLinkNodeCustom extends SupernoteNodeCustomBase {
  readonly nodeType: "link";
  readonly url: string;
}
export interface SupernoteGroupNodeCustom extends SupernoteNodeCustomBase {
  readonly nodeType: "group";
  readonly label?: string;
  readonly background?: string;
}
export interface SupernoteCrmNodeCustom extends SupernoteNodeCustomBase {
  readonly nodeType: "crm";
  readonly entityId: string;
  readonly display?: "card" | "compact";
}
export interface SupernoteQueryNodeCustom extends SupernoteNodeCustomBase {
  readonly nodeType: "query";
  readonly query: string;
  readonly viewMode: "list" | "table";
}

export type SupernoteNodeCustom =
  | SupernoteTextNodeCustom
  | SupernoteFileNodeCustom
  | SupernoteLinkNodeCustom
  | SupernoteGroupNodeCustom
  | SupernoteCrmNodeCustom
  | SupernoteQueryNodeCustom;

export interface SupernoteEdgeCustom {
  readonly kind: "edge";
  readonly edgeId: string;
  readonly fromNode: string;
  readonly toNode: string;
  readonly fromSide?: CanvasNodeSide;
  readonly toSide?: CanvasNodeSide;
  readonly label?: string;
  readonly color?: string;
  readonly relationTypeId?: string;
}

export type SupernoteCustomData = SupernoteNodeCustom | SupernoteEdgeCustom;

// ----- Encoders ------------------------------------------------------

export function encodeNodeCustom(
  data: SupernoteNodeCustom,
): { supernote: SupernoteNodeCustom } {
  return { supernote: data };
}

export function encodeEdgeCustom(
  data: SupernoteEdgeCustom,
): { supernote: SupernoteEdgeCustom } {
  return { supernote: data };
}

// ----- Decoder (defensive) -------------------------------------------

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function isSide(v: unknown): v is CanvasNodeSide {
  return v === "top" || v === "right" || v === "bottom" || v === "left";
}

export function decodeCustom(
  customData: Record<string, unknown> | undefined,
): SupernoteCustomData | null {
  if (!customData || typeof customData !== "object") return null;
  const sn = customData["supernote"];
  if (!sn || typeof sn !== "object") return null;
  const obj = sn as Record<string, unknown>;
  const kind = obj["kind"];

  if (kind === "node") {
    const nodeType = obj["nodeType"];
    const nodeId = obj["nodeId"];
    if (!isStr(nodeId)) return null;
    switch (nodeType) {
      case "text":
        if (!isStr(obj["text"])) return null;
        return { kind: "node", nodeType: "text", nodeId, text: obj["text"] };
      case "file":
        if (!isStr(obj["file"])) return null;
        return {
          kind: "node",
          nodeType: "file",
          nodeId,
          file: obj["file"],
          ...(isStr(obj["subpath"]) ? { subpath: obj["subpath"] } : {}),
        };
      case "link":
        if (!isStr(obj["url"])) return null;
        return { kind: "node", nodeType: "link", nodeId, url: obj["url"] };
      case "group":
        return {
          kind: "node",
          nodeType: "group",
          nodeId,
          ...(isStr(obj["label"]) ? { label: obj["label"] } : {}),
          ...(isStr(obj["background"]) ? { background: obj["background"] } : {}),
        };
      case "crm":
        if (!isStr(obj["entityId"])) return null;
        return {
          kind: "node",
          nodeType: "crm",
          nodeId,
          entityId: obj["entityId"],
          ...(obj["display"] === "card" || obj["display"] === "compact"
            ? { display: obj["display"] as "card" | "compact" }
            : {}),
        };
      case "query":
        if (!isStr(obj["query"])) return null;
        return {
          kind: "node",
          nodeType: "query",
          nodeId,
          query: obj["query"],
          viewMode: obj["viewMode"] === "table" ? "table" : "list",
        };
      default:
        return null;
    }
  }

  if (kind === "edge") {
    const edgeId = obj["edgeId"];
    const fromNode = obj["fromNode"];
    const toNode = obj["toNode"];
    if (!isStr(edgeId) || !isStr(fromNode) || !isStr(toNode)) return null;
    return {
      kind: "edge",
      edgeId,
      fromNode,
      toNode,
      ...(isSide(obj["fromSide"]) ? { fromSide: obj["fromSide"] } : {}),
      ...(isSide(obj["toSide"]) ? { toSide: obj["toSide"] } : {}),
      ...(isStr(obj["label"]) ? { label: obj["label"] } : {}),
      ...(isStr(obj["color"]) ? { color: obj["color"] } : {}),
      ...(isStr(obj["relationTypeId"]) ? { relationTypeId: obj["relationTypeId"] } : {}),
    };
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/canvas && pnpm test -- custom-data`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/canvas/src/excalidraw/custom-data.ts packages/canvas/__tests__/excalidraw/custom-data.test.ts
git commit -m "feat(canvas): supernote customData codec for excalidraw round-trip"
```

---

## Task 4: `toExcalidraw` — CanvasDocument → ExcalidrawFile

**Files:**
- Create: `packages/canvas/src/excalidraw/to-excalidraw.ts`
- Test: `packages/canvas/__tests__/excalidraw/to-excalidraw.test.ts`

Converts a CanvasDocument to a valid `.excalidraw` v2 file. Each Supernote node → a group of one `rectangle` + (optionally) one `text`. Each edge → one `arrow` with bindings. Free-layer `excalidrawElements` pass through as-is.

- [ ] **Step 1: Write failing tests**

Create `packages/canvas/__tests__/excalidraw/to-excalidraw.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toExcalidraw } from "../../src/excalidraw/to-excalidraw.js";
import type { CanvasDocument } from "../../src/types/canvas.js";

describe("toExcalidraw", () => {
  it("produces a valid file shell for an empty document", () => {
    const file = toExcalidraw({ nodes: [], edges: [] });
    expect(file.type).toBe("excalidraw");
    expect(file.version).toBe(2);
    expect(file.source).toBe("supernote");
    expect(file.elements).toEqual([]);
  });

  it("encodes a text node as a rectangle+text group with customData", () => {
    const doc: CanvasDocument = {
      nodes: [{
        id: "n1", type: "text", x: 10, y: 20, width: 200, height: 80, text: "Hello",
      }],
      edges: [],
    };
    const file = toExcalidraw(doc);
    expect(file.elements).toHaveLength(2);
    const [rect, text] = file.elements;
    expect(rect?.type).toBe("rectangle");
    expect(rect?.x).toBe(10);
    expect(rect?.width).toBe(200);
    expect(rect?.customData?.supernote).toMatchObject({
      kind: "node", nodeType: "text", nodeId: "n1",
    });
    expect(text?.type).toBe("text");
    expect(text?.text).toBe("Hello");
    expect(rect?.groupIds?.[0]).toBeTruthy();
    expect(text?.groupIds?.[0]).toBe(rect?.groupIds?.[0]);
  });

  it("encodes a crm node carrying entityId in customData", () => {
    const doc: CanvasDocument = {
      nodes: [{
        id: "n2", type: "crm", x: 0, y: 0, width: 220, height: 120,
        entityId: "entity-99", display: "card",
      }],
      edges: [],
    };
    const file = toExcalidraw(doc);
    const rect = file.elements[0];
    expect(rect?.customData?.supernote).toMatchObject({
      kind: "node", nodeType: "crm", entityId: "entity-99", display: "card",
    });
  });

  it("encodes an edge as an arrow with bindings", () => {
    const doc: CanvasDocument = {
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, text: "A" },
        { id: "b", type: "text", x: 200, y: 0, width: 100, height: 50, text: "B" },
      ],
      edges: [{ id: "e1", fromNode: "a", toNode: "b", label: "rel" }],
    };
    const file = toExcalidraw(doc);
    const arrow = file.elements.find((e) => e.type === "arrow");
    expect(arrow).toBeDefined();
    expect(arrow?.customData?.supernote).toMatchObject({
      kind: "edge", edgeId: "e1", fromNode: "a", toNode: "b", label: "rel",
    });
    expect(arrow?.startBinding).toBeDefined();
    expect(arrow?.endBinding).toBeDefined();
  });

  it("passes free-layer excalidrawElements through unchanged", () => {
    const doc: CanvasDocument = {
      nodes: [],
      edges: [],
      excalidrawElements: [
        { id: "freedraw-1", type: "freedraw", x: 5, y: 5, width: 10, height: 10 },
      ],
    };
    const file = toExcalidraw(doc);
    const fd = file.elements.find((e) => e.id === "freedraw-1");
    expect(fd).toBeDefined();
    expect(fd?.type).toBe("freedraw");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/canvas && pnpm test -- to-excalidraw`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement to-excalidraw.ts**

Create `packages/canvas/src/excalidraw/to-excalidraw.ts`:

```ts
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasNode,
} from "../types/canvas.js";
import {
  EXCALIDRAW_SOURCE,
  type ExcalidrawElement,
  type ExcalidrawFile,
} from "./types.js";
import {
  encodeEdgeCustom,
  encodeNodeCustom,
  type SupernoteNodeCustom,
} from "./custom-data.js";

// Map an internal element ID prefix to keep them unique without
// touching the CanvasNode.id (which we preserve in customData).
const RECT_PREFIX = "sn-rect-";
const TEXT_PREFIX = "sn-text-";
const ARROW_PREFIX = "sn-arrow-";
const GROUP_PREFIX = "sn-grp-";

function nodeToCustom(node: CanvasNode): SupernoteNodeCustom {
  switch (node.type) {
    case "text":
      return { kind: "node", nodeType: "text", nodeId: node.id, text: node.text };
    case "file":
      return {
        kind: "node", nodeType: "file", nodeId: node.id, file: node.file,
        ...(node.subpath !== undefined && { subpath: node.subpath }),
      };
    case "link":
      return { kind: "node", nodeType: "link", nodeId: node.id, url: node.url };
    case "group":
      return {
        kind: "node", nodeType: "group", nodeId: node.id,
        ...(node.label !== undefined && { label: node.label }),
        ...(node.background !== undefined && { background: node.background }),
      };
    case "crm":
      return {
        kind: "node", nodeType: "crm", nodeId: node.id, entityId: node.entityId,
        ...(node.display !== undefined && { display: node.display }),
      };
    case "query":
      return {
        kind: "node", nodeType: "query", nodeId: node.id, query: node.query, viewMode: node.viewMode,
      };
  }
}

/** Human-readable label drawn inside the rectangle. */
function nodeDisplayText(node: CanvasNode): string {
  switch (node.type) {
    case "text":  return node.text;
    case "file":  return `📄 ${node.file}`;
    case "link":  return `🔗 ${node.url}`;
    case "group": return node.label ?? "";
    case "crm":   return `[entity ${node.entityId}]`;
    case "query": return `[query] ${node.query}`;
  }
}

function nodeToElements(node: CanvasNode): ExcalidrawElement[] {
  const groupId = `${GROUP_PREFIX}${node.id}`;
  const rectId = `${RECT_PREFIX}${node.id}`;
  const custom = encodeNodeCustom(nodeToCustom(node));

  const rect: ExcalidrawElement = {
    id: rectId,
    type: "rectangle",
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    groupIds: [groupId],
    customData: custom,
  };

  const label = nodeDisplayText(node);
  if (!label) return [rect];

  const text: ExcalidrawElement = {
    id: `${TEXT_PREFIX}${node.id}`,
    type: "text",
    x: node.x + 8,
    y: node.y + 8,
    width: Math.max(node.width - 16, 20),
    height: Math.max(node.height - 16, 20),
    groupIds: [groupId],
    text: label,
  };
  return [rect, text];
}

function edgeToArrow(edge: CanvasEdge): ExcalidrawElement {
  return {
    id: `${ARROW_PREFIX}${edge.id}`,
    type: "arrow",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    startBinding: { elementId: `${RECT_PREFIX}${edge.fromNode}` },
    endBinding: { elementId: `${RECT_PREFIX}${edge.toNode}` },
    customData: encodeEdgeCustom({
      kind: "edge",
      edgeId: edge.id,
      fromNode: edge.fromNode,
      toNode: edge.toNode,
      ...(edge.fromSide !== undefined && { fromSide: edge.fromSide }),
      ...(edge.toSide !== undefined && { toSide: edge.toSide }),
      ...(edge.label !== undefined && { label: edge.label }),
      ...(edge.color !== undefined && { color: edge.color }),
      ...(edge.relationTypeId !== undefined && { relationTypeId: edge.relationTypeId }),
    }),
  };
}

/**
 * Convert a Supernote CanvasDocument into a valid Excalidraw v2 file.
 *
 * - Each typed node becomes a {rectangle, text} group carrying a
 *   `customData.supernote` payload so `fromExcalidraw` can rebuild it.
 * - Each edge becomes an arrow with start/end bindings on the rects.
 * - `excalidrawElements` (free-draw layer) pass through verbatim.
 */
export function toExcalidraw(doc: CanvasDocument): ExcalidrawFile {
  const nodeElements = doc.nodes.flatMap(nodeToElements);
  const edgeElements = doc.edges.map(edgeToArrow);
  const free = (doc.excalidrawElements ?? []) as ExcalidrawElement[];

  return {
    type: "excalidraw",
    version: 2,
    source: EXCALIDRAW_SOURCE,
    elements: [...nodeElements, ...edgeElements, ...free],
    appState: { viewBackgroundColor: "#ffffff", gridSize: null },
    files: {},
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/canvas && pnpm test -- to-excalidraw`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/canvas/src/excalidraw/to-excalidraw.ts packages/canvas/__tests__/excalidraw/to-excalidraw.test.ts
git commit -m "feat(canvas): toExcalidraw — CanvasDocument → Excalidraw v2 file"
```

---

## Task 5: `fromExcalidraw` — ExcalidrawFile → CanvasDocument

**Files:**
- Create: `packages/canvas/src/excalidraw/from-excalidraw.ts`
- Test: `packages/canvas/__tests__/excalidraw/from-excalidraw.test.ts`

Inverse conversion. Elements with `customData.supernote.kind === "node"` rebuild typed nodes (using the matching rectangle's geometry as the source of position/size). Elements with `kind === "edge"` rebuild edges. All other elements fall into `excalidrawElements`. Orphan `text` elements that share a groupId with a recognized rect are dropped (the rect already carries the typed text).

- [ ] **Step 1: Write failing tests**

Create `packages/canvas/__tests__/excalidraw/from-excalidraw.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fromExcalidraw } from "../../src/excalidraw/from-excalidraw.js";
import { toExcalidraw } from "../../src/excalidraw/to-excalidraw.js";
import type { CanvasDocument } from "../../src/types/canvas.js";
import type { ExcalidrawFile } from "../../src/excalidraw/types.js";

describe("fromExcalidraw", () => {
  it("returns an empty document for an empty file", () => {
    const doc = fromExcalidraw({
      type: "excalidraw", version: 2, source: "x", elements: [],
    });
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
  });

  it("rebuilds typed nodes from rectangles carrying customData", () => {
    const original: CanvasDocument = {
      nodes: [{
        id: "n1", type: "text", x: 5, y: 7, width: 150, height: 80, text: "Bonjour",
      }],
      edges: [],
    };
    const doc = fromExcalidraw(toExcalidraw(original));
    expect(doc.nodes).toEqual(original.nodes);
  });

  it("rebuilds edges from arrows carrying customData", () => {
    const original: CanvasDocument = {
      nodes: [
        { id: "a", type: "text", x: 0, y: 0, width: 100, height: 50, text: "A" },
        { id: "b", type: "text", x: 200, y: 0, width: 100, height: 50, text: "B" },
      ],
      edges: [{ id: "e1", fromNode: "a", toNode: "b", label: "rel" }],
    };
    const doc = fromExcalidraw(toExcalidraw(original));
    expect(doc.edges).toEqual(original.edges);
  });

  it("drops paired text element when its rect is a recognized node", () => {
    const original: CanvasDocument = {
      nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "Hi" }],
      edges: [],
    };
    const doc = fromExcalidraw(toExcalidraw(original));
    expect(doc.excalidrawElements ?? []).toEqual([]);
  });

  it("treats elements without supernote customData as free layer", () => {
    const file: ExcalidrawFile = {
      type: "excalidraw", version: 2, source: "x",
      elements: [
        { id: "fd-1", type: "freedraw", x: 0, y: 0, width: 10, height: 10 },
      ],
    };
    const doc = fromExcalidraw(file);
    expect(doc.excalidrawElements).toEqual(file.elements);
  });

  it("returns empty doc on null/garbage input without throwing", () => {
    // @ts-expect-error testing runtime defense
    expect(fromExcalidraw(null)).toEqual({ nodes: [], edges: [] });
    // @ts-expect-error testing runtime defense
    expect(fromExcalidraw({ elements: "no" })).toEqual({ nodes: [], edges: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/canvas && pnpm test -- from-excalidraw`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement from-excalidraw.ts**

Create `packages/canvas/src/excalidraw/from-excalidraw.ts`:

```ts
import type {
  CanvasDocument,
  CanvasEdge,
  CanvasExcalidrawElement,
  CanvasNode,
} from "../types/canvas.js";
import type { ExcalidrawElement, ExcalidrawFile } from "./types.js";
import {
  decodeCustom,
  type SupernoteNodeCustom,
} from "./custom-data.js";

function nodeFromCustom(
  custom: SupernoteNodeCustom,
  geom: { x: number; y: number; width: number; height: number },
): CanvasNode {
  const base = { id: custom.nodeId, x: geom.x, y: geom.y, width: geom.width, height: geom.height };
  switch (custom.nodeType) {
    case "text":
      return { ...base, type: "text", text: custom.text };
    case "file":
      return {
        ...base, type: "file", file: custom.file,
        ...(custom.subpath !== undefined && { subpath: custom.subpath }),
      };
    case "link":
      return { ...base, type: "link", url: custom.url };
    case "group":
      return {
        ...base, type: "group",
        ...(custom.label !== undefined && { label: custom.label }),
        ...(custom.background !== undefined && { background: custom.background }),
      };
    case "crm":
      return {
        ...base, type: "crm", entityId: custom.entityId,
        ...(custom.display !== undefined && { display: custom.display }),
      };
    case "query":
      return { ...base, type: "query", query: custom.query, viewMode: custom.viewMode };
  }
}

function safeCustom(el: ExcalidrawElement): Record<string, unknown> | undefined {
  return el.customData as Record<string, unknown> | undefined;
}

/**
 * Convert an Excalidraw v2 file back into a CanvasDocument.
 *
 * - rectangles with customData.supernote.kind === "node" rebuild typed nodes
 * - arrows with kind === "edge" rebuild edges
 * - text elements belonging to a group already represented by a recognized
 *   rect are dropped (their content lives in the typed node)
 * - everything else (freedraw, unrecognized rects, orphan text, …) falls
 *   into excalidrawElements
 *
 * Defensive against malformed input — returns an empty document rather
 * than throwing.
 */
export function fromExcalidraw(file: ExcalidrawFile | unknown): CanvasDocument {
  if (!file || typeof file !== "object") return { nodes: [], edges: [] };
  const elements = (file as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return { nodes: [], edges: [] };

  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const free: CanvasExcalidrawElement[] = [];
  const groupsClaimedByNode = new Set<string>();

  // Pass 1: nodes (rectangles with kind=node)
  for (const el of elements as ExcalidrawElement[]) {
    const decoded = decodeCustom(safeCustom(el));
    if (decoded?.kind === "node" && el.type === "rectangle") {
      nodes.push(nodeFromCustom(decoded, {
        x: el.x, y: el.y, width: el.width, height: el.height,
      }));
      for (const g of el.groupIds ?? []) groupsClaimedByNode.add(g);
    }
  }

  // Pass 2: edges + free layer
  for (const el of elements as ExcalidrawElement[]) {
    const decoded = decodeCustom(safeCustom(el));

    if (decoded?.kind === "edge") {
      edges.push({
        id: decoded.edgeId,
        fromNode: decoded.fromNode,
        toNode: decoded.toNode,
        ...(decoded.fromSide !== undefined && { fromSide: decoded.fromSide }),
        ...(decoded.toSide !== undefined && { toSide: decoded.toSide }),
        ...(decoded.label !== undefined && { label: decoded.label }),
        ...(decoded.color !== undefined && { color: decoded.color }),
        ...(decoded.relationTypeId !== undefined && { relationTypeId: decoded.relationTypeId }),
      });
      continue;
    }

    if (decoded?.kind === "node" && el.type === "rectangle") continue; // already handled

    // Text companion of a recognized node: drop
    if (el.type === "text" && (el.groupIds ?? []).some((g) => groupsClaimedByNode.has(g))) {
      continue;
    }

    free.push(el as CanvasExcalidrawElement);
  }

  return {
    nodes,
    edges,
    ...(free.length ? { excalidrawElements: free } : {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/canvas && pnpm test -- from-excalidraw`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/canvas/src/excalidraw/from-excalidraw.ts packages/canvas/__tests__/excalidraw/from-excalidraw.test.ts
git commit -m "feat(canvas): fromExcalidraw — Excalidraw v2 file → CanvasDocument"
```

---

## Task 6: Round-trip property test

**Files:**
- Test: `packages/canvas/__tests__/excalidraw/round-trip.test.ts`

Property: `fromExcalidraw(toExcalidraw(doc)) ≡ doc` for a corpus of representative CanvasDocuments. This catches drift between Tasks 4 and 5.

- [ ] **Step 1: Write the round-trip test**

Create `packages/canvas/__tests__/excalidraw/round-trip.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toExcalidraw } from "../../src/excalidraw/to-excalidraw.js";
import { fromExcalidraw } from "../../src/excalidraw/from-excalidraw.js";
import type { CanvasDocument } from "../../src/types/canvas.js";

const FIXTURES: { name: string; doc: CanvasDocument }[] = [
  { name: "empty", doc: { nodes: [], edges: [] } },
  {
    name: "single text node",
    doc: {
      nodes: [{ id: "n1", type: "text", x: 0, y: 0, width: 100, height: 50, text: "hi" }],
      edges: [],
    },
  },
  {
    name: "mixed nodes and edges",
    doc: {
      nodes: [
        { id: "n1", type: "crm", x: 0, y: 0, width: 220, height: 120, entityId: "e1", display: "card" },
        { id: "n2", type: "query", x: 300, y: 0, width: 220, height: 120, query: "tag:x", viewMode: "table" },
        { id: "n3", type: "link", x: 0, y: 200, width: 200, height: 60, url: "https://example.com" },
      ],
      edges: [
        { id: "e1", fromNode: "n1", toNode: "n2", label: "uses", fromSide: "right", toSide: "left" },
      ],
    },
  },
  {
    name: "with free layer",
    doc: {
      nodes: [],
      edges: [],
      excalidrawElements: [
        { id: "fd1", type: "freedraw", x: 5, y: 5, width: 10, height: 10 },
      ],
    },
  },
];

describe("round-trip", () => {
  for (const { name, doc } of FIXTURES) {
    it(`preserves: ${name}`, () => {
      const back = fromExcalidraw(toExcalidraw(doc));
      expect(back.nodes).toEqual(doc.nodes);
      expect(back.edges).toEqual(doc.edges);
      expect(back.excalidrawElements ?? []).toEqual(doc.excalidrawElements ?? []);
    });
  }
});
```

- [ ] **Step 2: Run test**

Run: `cd packages/canvas && pnpm test -- round-trip`
Expected: PASS, 4 tests.

- [ ] **Step 3: Commit**

```bash
git add packages/canvas/__tests__/excalidraw/round-trip.test.ts
git commit -m "test(canvas): round-trip property for excalidraw conversion"
```

---

## Task 7: file-bridge (pure orchestration)

**Files:**
- Create: `packages/canvas/src/excalidraw/file-bridge.ts`
- Create: `packages/canvas/src/excalidraw/index.ts`
- Modify: `packages/canvas/src/index.ts`
- Test: `packages/canvas/__tests__/excalidraw/file-bridge.test.ts`

Pure function that turns "I have a `.md` path and a `CanvasDocument`" into "here is the path + content for the `.excalidraw` sibling, and here is the value to put in `canvasFile` frontmatter". The inverse is also exposed. No FSA, no DB — pure data in/out, fully testable.

- [ ] **Step 1: Write failing tests**

Create `packages/canvas/__tests__/excalidraw/file-bridge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  canvasToFileBridge,
  parseExcalidrawFileContent,
  excalidrawSiblingPath,
} from "../../src/excalidraw/file-bridge.js";

describe("excalidrawSiblingPath", () => {
  it("replaces .md extension with .excalidraw", () => {
    expect(excalidrawSiblingPath("Canvas/MonCanvas.md")).toBe("Canvas/MonCanvas.excalidraw");
    expect(excalidrawSiblingPath("notes/2026/sub.md")).toBe("notes/2026/sub.excalidraw");
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
    expect(result.excalidrawPath).toBe("Inbox/note.excalidraw");
    expect(result.canvasFileFrontmatter).toBe("note.excalidraw");
    const parsed = JSON.parse(result.excalidrawContent);
    expect(parsed.type).toBe("excalidraw");
  });

  it("returns null when path is invalid", () => {
    expect(canvasToFileBridge({ mdPath: "weird", doc: { nodes: [], edges: [] } })).toBeNull();
  });
});

describe("parseExcalidrawFileContent", () => {
  it("parses a valid excalidraw file back into a CanvasDocument", () => {
    const content = JSON.stringify({
      type: "excalidraw", version: 2, source: "supernote",
      elements: [],
    });
    const doc = parseExcalidrawFileContent(content);
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
  });

  it("returns empty doc on malformed JSON", () => {
    expect(parseExcalidrawFileContent("{not json")).toEqual({ nodes: [], edges: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/canvas && pnpm test -- file-bridge`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement file-bridge.ts**

Create `packages/canvas/src/excalidraw/file-bridge.ts`:

```ts
import type { CanvasDocument } from "../types/canvas.js";
import { toExcalidraw } from "./to-excalidraw.js";
import { fromExcalidraw } from "./from-excalidraw.js";

/**
 * Given a vault-relative `.md` path, returns the path of its `.excalidraw`
 * sibling (same directory, same basename). Returns null when the input is
 * not a `.md` path.
 */
export function excalidrawSiblingPath(mdPath: string): string | null {
  if (!mdPath.endsWith(".md")) return null;
  return `${mdPath.slice(0, -3)}.excalidraw`;
}

/** Basename component of a path (after the last "/"). */
function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

export interface FileBridgeOutput {
  /** Full vault-relative path of the .excalidraw file to write. */
  readonly excalidrawPath: string;
  /** JSON-serialized Excalidraw v2 file content. */
  readonly excalidrawContent: string;
  /** Value to store in the .md frontmatter `canvasFile` field. */
  readonly canvasFileFrontmatter: string;
}

/**
 * Compute everything needed to persist a CanvasDocument as an `.excalidraw`
 * sibling of an existing `.md` file. Pure: caller is responsible for the
 * actual FSA write.
 */
export function canvasToFileBridge(args: {
  mdPath: string;
  doc: CanvasDocument;
}): FileBridgeOutput | null {
  const excalidrawPath = excalidrawSiblingPath(args.mdPath);
  if (!excalidrawPath) return null;
  const file = toExcalidraw(args.doc);
  return {
    excalidrawPath,
    excalidrawContent: JSON.stringify(file, null, 2),
    canvasFileFrontmatter: basename(excalidrawPath),
  };
}

/**
 * Parse the raw text of an `.excalidraw` file into a CanvasDocument.
 * Defensive: returns an empty document on malformed JSON.
 */
export function parseExcalidrawFileContent(content: string): CanvasDocument {
  try {
    const parsed = JSON.parse(content);
    return fromExcalidraw(parsed);
  } catch {
    return { nodes: [], edges: [] };
  }
}
```

- [ ] **Step 4: Create excalidraw module barrel**

Create `packages/canvas/src/excalidraw/index.ts`:

```ts
export * from "./types.js";
export * from "./custom-data.js";
export * from "./to-excalidraw.js";
export * from "./from-excalidraw.js";
export * from "./file-bridge.js";
```

- [ ] **Step 5: Re-export from package root**

Append to `packages/canvas/src/index.ts`:

```ts
export * from "./excalidraw/index.js";
```

(Add it after the existing exports — open the file first to confirm where.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/canvas && pnpm test`
Expected: PASS — all suites including the new ones.

- [ ] **Step 7: Verify package typechecks**

Run: `cd packages/canvas && pnpm build`
Expected: success, no TS errors.

- [ ] **Step 8: Commit**

```bash
git add packages/canvas/src/excalidraw packages/canvas/src/index.ts packages/canvas/__tests__/excalidraw/file-bridge.test.ts
git commit -m "feat(canvas): file-bridge — pure orchestration for .excalidraw sibling files"
```

---

## Task 8: vault-worker IO layer

**Files:**
- Create: `apps/web/src/lib/vault-worker/canvas-excalidraw-io.ts`

Thin FSA wrapper on top of `file-bridge`. Reads/writes the `.excalidraw` sibling. The only file in `apps/web` that touches both FSA and the canvas conversion library.

- [ ] **Step 1: Create the IO module**

Create `apps/web/src/lib/vault-worker/canvas-excalidraw-io.ts`:

```ts
import {
  canvasToFileBridge,
  excalidrawSiblingPath,
  parseExcalidrawFileContent,
} from "@supernote/canvas";
import type { CanvasDocument } from "@supernote/canvas";
import { readVaultFile, writeVaultFile, deleteVaultFile } from "./fsa-file-io.js";

/**
 * Write a `.excalidraw` sibling next to `mdPath` for the given document.
 * Returns the basename to store in the `.md` frontmatter `canvasFile` field,
 * or `null` if the path is invalid (non-.md).
 */
export async function writeExcalidrawSibling(
  vaultHandle: FileSystemDirectoryHandle,
  mdPath: string,
  doc: CanvasDocument,
): Promise<string | null> {
  const bridge = canvasToFileBridge({ mdPath, doc });
  if (!bridge) return null;
  await writeVaultFile(
    vaultHandle,
    bridge.excalidrawPath.split("/"),
    bridge.excalidrawContent,
  );
  return bridge.canvasFileFrontmatter;
}

/**
 * Read the `.excalidraw` sibling of `mdPath` and parse it into a
 * CanvasDocument. Returns null when the sibling is missing or malformed.
 */
export async function readExcalidrawSibling(
  vaultHandle: FileSystemDirectoryHandle,
  mdPath: string,
): Promise<CanvasDocument | null> {
  const siblingPath = excalidrawSiblingPath(mdPath);
  if (!siblingPath) return null;
  try {
    const content = await readVaultFile(vaultHandle, siblingPath.split("/"));
    return parseExcalidrawFileContent(content);
  } catch {
    return null;
  }
}

/**
 * Delete the `.excalidraw` sibling if present. No-op on missing file.
 */
export async function deleteExcalidrawSibling(
  vaultHandle: FileSystemDirectoryHandle,
  mdPath: string,
): Promise<void> {
  const siblingPath = excalidrawSiblingPath(mdPath);
  if (!siblingPath) return;
  try {
    await deleteVaultFile(vaultHandle, siblingPath.split("/"));
  } catch {
    // best-effort: missing sibling is OK
  }
}
```

- [ ] **Step 2: Run typecheck on apps/web**

Run: `cd apps/web && pnpm typecheck`
Expected: success — the new file imports cleanly from `@supernote/canvas`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/vault-worker/canvas-excalidraw-io.ts
git commit -m "feat(vault-worker): IO helpers for .excalidraw sibling files"
```

---

## Task 9: Hook into `entitiesCreate`

**Files:**
- Modify: `apps/web/src/lib/vault-worker/worker-router.ts`

When creating an entity whose `fields` include a `data` (canvas standalone) or `canvas` (note canvas view) JSON string, also write the `.excalidraw` sibling and strip the JSON from the frontmatter, replacing it with `canvasFile: <basename>.excalidraw`.

- [ ] **Step 1: Identify the field to extract**

In `worker-router.ts:660-723` (the `entitiesCreate` block in this plan's context), after `relativePath` is finalized (around line 712) and before `frontmatter` is built (line 721), insert the bridge call.

Open `apps/web/src/lib/vault-worker/worker-router.ts` and find the existing `entitiesCreate` function. Identify the two fields by entity type:
- `canvas` type → JSON in `fields.data`
- `note` type → JSON in `fields.canvas`

Confirm with: `grep -n "fields\.data\|fields\.canvas\|note_canvas\|canvas_data" apps/web/src/lib/vault-worker/seed-default-types.ts`

- [ ] **Step 2: Add imports**

At the top of `worker-router.ts`, alongside the existing `fsa-file-io` import block:

```ts
import { writeExcalidrawSibling } from "./canvas-excalidraw-io.js";
```

- [ ] **Step 3: Add a helper at module scope**

Add this helper above the function block that contains `entitiesCreate` (search for `const entitiesCreate = async` and place the helper above it):

```ts
/**
 * The two field names that carry a serialized CanvasDocument:
 *  - canvas standalone entities use `data`
 *  - notes with a canvas view use `canvas`
 *
 * Returns { fieldName, json } if a non-empty canvas blob is present.
 */
function extractCanvasField(
  fields: Record<string, unknown>,
): { fieldName: "data" | "canvas"; json: string } | null {
  for (const name of ["data", "canvas"] as const) {
    const v = fields[name];
    if (typeof v === "string" && v.trim().length > 0 && v.trim().startsWith("{")) {
      return { fieldName: name, json: v };
    }
  }
  return null;
}
```

- [ ] **Step 4: Extract → write `.excalidraw` → mutate fields before writing `.md`**

In `entitiesCreate`, between the `relativePath` collision suffix block and the `frontmatter` construction (currently around lines 712-721), insert:

```ts
// Canvas split: if fields contain a serialized CanvasDocument, write it
// to a sibling .excalidraw file and replace the in-frontmatter blob with
// a `canvasFile` pointer. Leaves entities without a canvas blob untouched.
const canvasField = extractCanvasField(fields);
if (canvasField) {
  try {
    const parsed = JSON.parse(canvasField.json) as Partial<{ nodes: unknown; edges: unknown; excalidrawElements: unknown }>;
    const doc = {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      ...(Array.isArray(parsed.excalidrawElements) ? { excalidrawElements: parsed.excalidrawElements } : {}),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const canvasFile = await writeExcalidrawSibling(vaultHandle, relativePath, doc as any);
    if (canvasFile) {
      delete fields[canvasField.fieldName];
      fields["canvasFile"] = canvasFile;
    }
  } catch (err) {
    console.warn("[canvas-excalidraw] create: bridge skipped, leaving JSON in frontmatter", err);
  }
}
```

(`vaultHandle` is already in scope in this function — confirm by reading nearby lines.)

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: success.

- [ ] **Step 6: Manual smoke test (no automated test framework in apps/web)**

Run: `cd apps/web && pnpm dev`

Then in the browser:
1. Open the app, pick or create a vault
2. Create a new canvas via the Canvas tab
3. Drag a few shapes
4. Save / wait debounce
5. Inspect the vault folder (in OS file explorer): expect `Canvas/<name>.md` AND `Canvas/<name>.excalidraw` both present
6. Open the `.md`: confirm `canvasFile:` is in frontmatter, no `data:` field
7. Open the `.excalidraw` on excalidraw.com: shapes appear

Record outcome in commit message.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/vault-worker/worker-router.ts
git commit -m "feat(vault-worker): split canvas JSON into .excalidraw sibling on create

Smoke-tested: new canvas writes both .md (frontmatter with canvasFile)
and .excalidraw side-by-side; .excalidraw opens on excalidraw.com."
```

---

## Task 10: Hook into `entitiesUpdate`

**Files:**
- Modify: `apps/web/src/lib/vault-worker/worker-router.ts`

Same logic but on update. Plus: when the entity is renamed (move), the `.excalidraw` sibling must move too.

- [ ] **Step 1: Add update hook**

In `worker-router.ts`, inside `entitiesUpdate` (search for `const entitiesUpdate = async`), after `newFields` is computed and `effectivePath` is finalized but before `serializeFrontmatter` is called (around line 786 in this plan's reference):

```ts
// Canvas split on update: mirrors entitiesCreate.
const canvasField = extractCanvasField(newFields);
if (canvasField) {
  try {
    const parsed = JSON.parse(canvasField.json) as Partial<{ nodes: unknown; edges: unknown; excalidrawElements: unknown }>;
    const doc = {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      ...(Array.isArray(parsed.excalidrawElements) ? { excalidrawElements: parsed.excalidrawElements } : {}),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const canvasFile = await writeExcalidrawSibling(vaultHandle, effectivePath, doc as any);
    if (canvasFile) {
      delete newFields[canvasField.fieldName];
      newFields["canvasFile"] = canvasFile;
    }
  } catch (err) {
    console.warn("[canvas-excalidraw] update: bridge skipped", err);
  }
}
```

- [ ] **Step 2: Handle rename — move the .excalidraw sibling**

Still in `entitiesUpdate`, find the block that handles `isMove` (it renames the `.md` from `oldPath` to `effectivePath`). Right after the `.md` rename but before the DB update, add:

```ts
if (isMove) {
  // Move the .excalidraw sibling alongside the .md.
  // Best-effort: missing sibling means the entity simply doesn't have a canvas yet.
  const { excalidrawSiblingPath } = await import("@supernote/canvas");
  const oldSib = excalidrawSiblingPath(oldPath);
  const newSib = excalidrawSiblingPath(effectivePath);
  if (oldSib && newSib && oldSib !== newSib) {
    try {
      const { readVaultFile, writeVaultFile, deleteVaultFile } =
        await import("./fsa-file-io.js");
      const content = await readVaultFile(vaultHandle, oldSib.split("/"));
      await writeVaultFile(vaultHandle, newSib.split("/"), content);
      await deleteVaultFile(vaultHandle, oldSib.split("/"));
    } catch (err) {
      // No sibling to move — fine.
    }
  }
}
```

(Use static imports at the top of the file if the existing style prefers that; the dynamic imports above keep the diff small.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: success.

- [ ] **Step 4: Manual smoke test**

1. Open the canvas created in Task 9
2. Modify it (move a shape, add a node)
3. Wait for debounced save
4. Check both `.md` and `.excalidraw` updated on disk (mtimes change)
5. Rename the canvas (toolbar title edit)
6. Verify both files renamed in lockstep

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/vault-worker/worker-router.ts
git commit -m "feat(vault-worker): mirror canvas updates and renames into .excalidraw sibling"
```

---

## Task 11: Read path — reconstitute `fields.data` / `fields.canvas` from sibling

**Files:**
- Modify: `apps/web/src/lib/vault-worker/worker-router.ts`

When `entitiesGet` (or any reader) returns an entity whose frontmatter carries `canvasFile`, transparently read the sibling and inject the reconstituted JSON back into `fields.data` or `fields.canvas` so the UI doesn't have to know about the split.

- [ ] **Step 1: Find the entitiesGet read site**

Run: `grep -n "entitiesGet\|fields:.*JSON.parse" apps/web/src/lib/vault-worker/worker-router.ts | head`

Locate the function (or inline block) that serializes an entity row for return to the client. Identify where `fields` are parsed from the DB blob into the response object.

- [ ] **Step 2: Add a hydration helper at module scope**

Above the read function, add:

```ts
import { readExcalidrawSibling } from "./canvas-excalidraw-io.js";

/**
 * If `fields.canvasFile` is set, read the sibling .excalidraw and inject
 * its reconstituted CanvasDocument JSON into the appropriate field
 * (`canvas` for notes, `data` for canvas-type entities). The UI continues
 * to consume the same field as before.
 */
async function hydrateCanvasFromSibling(
  vaultHandle: FileSystemDirectoryHandle,
  filePath: string,
  typeName: string,
  fields: Record<string, unknown>,
): Promise<void> {
  if (typeof fields["canvasFile"] !== "string") return;
  const doc = await readExcalidrawSibling(vaultHandle, filePath);
  if (!doc) return;
  const targetField = typeName === "canvas" ? "data" : "canvas";
  fields[targetField] = JSON.stringify(doc);
}
```

- [ ] **Step 3: Call hydration in `entitiesGet`**

In the read function, after `fields` are parsed and `typeName` resolved, before returning the row, add:

```ts
await hydrateCanvasFromSibling(vaultHandle, filePath, typeName, fields);
```

If the function isn't currently `async`, make it `async` and update its single caller (the tRPC router binding).

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: success.

- [ ] **Step 5: Manual smoke test**

1. Close + reopen the canvas created in Task 9
2. Confirm the shapes/nodes load identically
3. Edit the `.excalidraw` externally (open on excalidraw.com, drag-drop, modify a shape, export back, replace the file in the vault)
4. Force a reload of the Supernote tab
5. Verify the external edit is visible in Supernote

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/vault-worker/worker-router.ts
git commit -m "feat(vault-worker): hydrate canvas fields from .excalidraw sibling on read"
```

---

## Task 12: Migration of existing canvases

**Files:**
- Create: `apps/web/src/lib/vault-worker/migration-canvas-excalidraw.ts`
- Modify: `apps/web/src/lib/vault-worker/worker-router.ts`

One-shot, idempotent migration at vault-worker boot. Walks `entity` rows whose `fields.data` or `fields.canvas` carries a JSON blob and whose `fields.canvasFile` is absent — writes the sibling, updates the `.md` frontmatter, updates the DB row.

- [ ] **Step 1: Create the migration module**

Create `apps/web/src/lib/vault-worker/migration-canvas-excalidraw.ts`:

```ts
import {
  canvasToFileBridge,
  excalidrawSiblingPath,
} from "@supernote/canvas";
import {
  parseFrontmatter,
  serializeFrontmatter,
  readVaultFile,
  writeVaultFile,
} from "./fsa-file-io.js";
import type { Database } from "sql.js";

interface Row {
  id: string;
  filePath: string;
  fields: string;
}

function rows(result: ReturnType<Database["exec"]>): Row[] {
  if (result.length === 0) return [];
  const [r] = result;
  if (!r) return [];
  const cols = r.columns;
  return r.values.map((v) => {
    const obj: Record<string, unknown> = {};
    cols.forEach((c, i) => (obj[c] = v[i]));
    return obj as unknown as Row;
  });
}

/**
 * Migrate pre-split canvases to the .excalidraw sibling format.
 *
 * Idempotent: re-running is a no-op once all rows carry `canvasFile`.
 * Non-destructive: on any per-row failure we log and continue without
 * mutating the row.
 *
 * Returns the number of entities successfully migrated.
 */
export async function migrateCanvasesToExcalidraw(args: {
  db: Database;
  vaultHandle: FileSystemDirectoryHandle;
  vaultId: string;
}): Promise<number> {
  const { db, vaultHandle, vaultId } = args;
  const candidates = rows(db.exec(
    `SELECT id, filePath, fields FROM entity WHERE vaultId = ?`,
    [vaultId],
  ));

  let migrated = 0;
  for (const r of candidates) {
    let fields: Record<string, unknown>;
    try {
      fields = JSON.parse(r.fields || "{}");
    } catch {
      continue;
    }
    if (typeof fields["canvasFile"] === "string") continue;

    let fieldName: "data" | "canvas" | null = null;
    let json: string | null = null;
    for (const n of ["data", "canvas"] as const) {
      const v = fields[n];
      if (typeof v === "string" && v.trim().startsWith("{")) {
        fieldName = n;
        json = v;
        break;
      }
    }
    if (!fieldName || !json) continue;

    let parsed: { nodes?: unknown; edges?: unknown; excalidrawElements?: unknown };
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      console.warn("[migrate] skip — JSON parse failed", r.filePath, err);
      continue;
    }
    const doc = {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      ...(Array.isArray(parsed.excalidrawElements) ? { excalidrawElements: parsed.excalidrawElements } : {}),
    };

    const sibling = excalidrawSiblingPath(r.filePath);
    if (!sibling) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bridge = canvasToFileBridge({ mdPath: r.filePath, doc: doc as any });
    if (!bridge) continue;

    // Conflict check: if the sibling already exists with different content,
    // skip — don't overwrite user data.
    try {
      const existing = await readVaultFile(vaultHandle, sibling.split("/"));
      if (existing && existing.trim() !== bridge.excalidrawContent.trim()) {
        console.warn("[migrate] skip — sibling exists with different content", r.filePath);
        continue;
      }
    } catch {
      // Missing sibling — proceed.
    }

    try {
      await writeVaultFile(vaultHandle, sibling.split("/"), bridge.excalidrawContent);

      // Rewrite the .md: strip the JSON field, add canvasFile.
      const mdContent = await readVaultFile(vaultHandle, r.filePath.split("/"));
      const { frontmatter, body } = parseFrontmatter(mdContent);
      delete (frontmatter as Record<string, unknown>)[fieldName];
      (frontmatter as Record<string, unknown>)["canvasFile"] = bridge.canvasFileFrontmatter;
      await writeVaultFile(
        vaultHandle,
        r.filePath.split("/"),
        serializeFrontmatter(frontmatter as Record<string, unknown>, body),
      );

      // Update DB row.
      delete fields[fieldName];
      fields["canvasFile"] = bridge.canvasFileFrontmatter;
      db.run(
        `UPDATE entity SET fields = ? WHERE id = ?`,
        [JSON.stringify(fields), r.id],
      );
      migrated += 1;
    } catch (err) {
      console.error("[migrate] failed for", r.filePath, err);
    }
  }

  return migrated;
}
```

- [ ] **Step 2: Wire the migration into vault boot**

Find the vault-worker init / `openVault` block in `worker-router.ts` (search `grep -n "openVault\|setVault" apps/web/src/lib/vault-worker/worker-router.ts`). After the DB is loaded and indexing is complete but before the `ok` reply, add:

```ts
import { migrateCanvasesToExcalidraw } from "./migration-canvas-excalidraw.js";

// …inside openVault, after indexing:
try {
  const n = await migrateCanvasesToExcalidraw({ db, vaultHandle, vaultId });
  if (n > 0) console.info(`[vault] migrated ${n} canvas(es) to .excalidraw sibling`);
} catch (err) {
  console.error("[vault] canvas migration failed", err);
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: success.

- [ ] **Step 4: Manual migration test**

1. Use a vault that has at least one pre-existing canvas created **before** Task 9 (or check out the previous commit on a copy of the vault to seed one).
2. Open it in the latest build.
3. Console: expect `[vault] migrated N canvas(es) to .excalidraw sibling`.
4. Inspect the vault on disk: the canvas now has both files; `.md` frontmatter no longer has the JSON blob.
5. Reopen the same vault: console should NOT log a second migration (idempotent).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/vault-worker/migration-canvas-excalidraw.ts apps/web/src/lib/vault-worker/worker-router.ts
git commit -m "feat(vault-worker): idempotent migration of legacy canvases to .excalidraw sibling"
```

---

## Task 13: UI surface — toolbar hint

**Files:**
- Modify: `apps/web/src/components/canvas-page/CanvasEditorToolbar.tsx` (verify exact path first via `grep -rn "CanvasEditorToolbar" apps/web/src`)

Replace the unimplemented "Export PNG" button with a small affordance: a label/icon showing the `.excalidraw` filename, with tooltip "Aussi disponible comme `<file>.excalidraw` dans votre vault — ouvrable sur excalidraw.com".

- [ ] **Step 1: Find the toolbar component**

Run: `grep -rn "CanvasEditorToolbar\|Export PNG\|onExportPng" apps/web/src`

Identify the file and the JSX node rendering the Export PNG button.

- [ ] **Step 2: Remove the Export PNG button and add the hint**

Replace the `onExportPng` button with an inline read-only label. The basename comes from the entity's `fields.canvasFile` — pass it as a new prop `excalidrawFileName?: string` to the toolbar, sourced from `entityQuery.data?.fields?.canvasFile` in the page component.

In the toolbar component:

```tsx
{excalidrawFileName && (
  <div
    className="hidden md:flex items-center gap-1 text-xs"
    style={{ color: "var(--text-muted)" }}
    title={`Aussi disponible comme ${excalidrawFileName} dans votre vault — ouvrable sur excalidraw.com`}
  >
    <FileIcon className="h-3 w-3" />
    <span>{excalidrawFileName}</span>
  </div>
)}
```

(Use whichever icon component the file already imports.)

In `apps/web/src/app/canvas/[id]/page.tsx`, around line 270 where `<CanvasEditorToolbar>` is rendered, derive and pass the prop:

```tsx
const excalidrawFileName = useMemo(() => {
  const fields = (entityQuery.data as { fields?: Record<string, unknown> } | undefined)?.fields;
  return typeof fields?.["canvasFile"] === "string" ? (fields["canvasFile"] as string) : undefined;
}, [entityQuery.data]);
```

Then add `excalidrawFileName={excalidrawFileName}` to the toolbar JSX. Remove the `onExportPng` prop and `handleExportPng` callback (lines 230-232).

- [ ] **Step 3: Remove the toolbar's onExportPng prop**

Drop `onExportPng` from the toolbar component's props and from the type interface. Remove the unused `handleExportPng` from the page.

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && pnpm typecheck`
Expected: success.

- [ ] **Step 5: Manual visual check**

1. `pnpm dev`
2. Open a canvas
3. Confirm: no Export PNG button; the filename appears in the toolbar with the explanatory tooltip on hover (desktop).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/canvas-page apps/web/src/app/canvas/[id]/page.tsx
git commit -m "feat(canvas-page): show .excalidraw filename in toolbar, drop unused Export PNG"
```

---

## Task 14: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Full automated test pass**

Run: `pnpm -r test`
Expected: all suites pass (canvas package newly extended).

- [ ] **Step 2: Full typecheck**

Run: `pnpm -r typecheck` (or per-package if no root script exists).
Expected: 0 errors.

- [ ] **Step 3: External round-trip on excalidraw.com**

1. Open a Supernote canvas
2. Locate the `.excalidraw` file in the vault on disk
3. Drag-drop it onto excalidraw.com — confirm shapes, text, arrows render
4. Edit on excalidraw.com (move shapes, add freedraw)
5. File → Save → choose "Save as Excalidraw file" → save back over the original
6. Reload the Supernote tab
7. Confirm changes are visible AND the typed nodes (crm, query if present) still behave as Supernote nodes

- [ ] **Step 4: Manual cleanup if anything broke**

If a typed node loses its identity after external edit, inspect the `.excalidraw` file: `customData.supernote` on its rectangle should still be present. If Excalidraw stripped it, file a follow-up note in the spec — this would be a stability regression in Excalidraw's `customData` handling, not in our code.

- [ ] **Step 5: Final commit if no code changes were needed**

```bash
# No-op if Step 4 didn't surface anything.
```

Otherwise, fix forward with a follow-up commit.

---

## Self-Review Notes

- **Spec coverage:** Tasks 1-12 cover spec sections "Approche", "Composants", "Flux de données", "Migration". Task 13 covers "UI". Task 14 covers "Tests / E2E manuel".
- **Bug fix** (serializer omitting `excalidrawElements`) is Task 1 — front-loaded as the spec requires.
- **No placeholders**: every code-changing step contains the actual code.
- **Type consistency**: `SupernoteCustomData`, `CanvasDocument`, `ExcalidrawFile` names are used identically across Tasks 2-7. `canvasFile` is the frontmatter field name throughout. `excalidrawSiblingPath`, `canvasToFileBridge`, `parseExcalidrawFileContent` keep stable names from Task 7 to 12.
- **TDD discipline**: Tasks 1, 3, 4, 5, 6, 7 use red-green-commit. Tasks 8-13 mix in manual smoke tests because `apps/web` has no test framework — they're scoped to thin glue around already-tested pure code.
- **Commits**: each task ends on a commit; failing intermediate states never persist.

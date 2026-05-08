// ============================================================
// Unified canvas store (Zustand)
//
// Single source of truth for the CanvasDocument. The Excalidraw layer
// writes free-drawing elements through `setDocument`; the consumer's
// `onChange` callback is fired on every meaningful mutation by the
// SupernoteCanvas component itself.
//
// The legacy "nodes" mode (React Flow) was removed — entity references
// are now Excalidraw rectangles with `customData.kind === "entity-ref"`.
// The CanvasNode/CanvasEdge mutators are kept for documents that still
// carry typed-node payloads on disk; they're not exercised by the UI but
// remain part of the store API so external callers (tests, future
// migrations, headless tooling) can manipulate documents the same way.
// ============================================================

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { CanvasDocument, CanvasEdge, CanvasNode } from "../types/canvas.js";

export interface CanvasState {
  // Document
  document: CanvasDocument;

  // Actions
  setDocument: (doc: CanvasDocument) => void;
  addNode: (node: CanvasNode) => void;
  updateNode: (id: string, patch: Partial<CanvasNode>) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: CanvasEdge) => void;
  updateEdge: (id: string, patch: Partial<CanvasEdge>) => void;
  removeEdge: (id: string) => void;
}

export const createCanvasStore = (initial?: CanvasDocument) =>
  create<CanvasState>()(
    subscribeWithSelector((set) => ({
      document: initial ?? { nodes: [], edges: [] },

      setDocument: (doc) => set({ document: doc }),

      addNode: (node) =>
        set((s) => ({
          document: { ...s.document, nodes: [...s.document.nodes, node] },
        })),

      updateNode: (id, patch) =>
        set((s) => ({
          document: {
            ...s.document,
            nodes: s.document.nodes.map((n) =>
              n.id === id ? ({ ...n, ...patch } as CanvasNode) : n
            ),
          },
        })),

      removeNode: (id) =>
        set((s) => ({
          document: {
            ...s.document,
            nodes: s.document.nodes.filter((n) => n.id !== id),
            // also clean up edges referencing this node
            edges: s.document.edges.filter(
              (e) => e.fromNode !== id && e.toNode !== id
            ),
          },
        })),

      addEdge: (edge) =>
        set((s) => ({
          document: { ...s.document, edges: [...s.document.edges, edge] },
        })),

      updateEdge: (id, patch) =>
        set((s) => ({
          document: {
            ...s.document,
            edges: s.document.edges.map((e) =>
              e.id === id ? ({ ...e, ...patch } as CanvasEdge) : e
            ),
          },
        })),

      removeEdge: (id) =>
        set((s) => ({
          document: {
            ...s.document,
            edges: s.document.edges.filter((e) => e.id !== id),
          },
        })),
    }))
  );

export type CanvasStore = ReturnType<typeof createCanvasStore>;

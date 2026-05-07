// ============================================================
// Unified canvas store (Zustand)
//
// Single source of truth for the CanvasDocument. Both the Excalidraw
// layer (draw mode) and the React Flow layer (nodes mode) write into
// this store. The consumer's `onChange` callback is fired on every
// meaningful mutation.
// ============================================================

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { CanvasDocument, CanvasEdge, CanvasNode } from "../types/canvas.js";
import type { CanvasMode } from "../types/props.js";

export interface CanvasState {
  // Document
  document: CanvasDocument;

  // UI state
  mode: CanvasMode;

  // Relation creation dialog
  pendingRelationSource: string | null;
  pendingRelationTarget: string | null;

  // Actions
  setDocument: (doc: CanvasDocument) => void;
  setMode: (mode: CanvasMode) => void;
  addNode: (node: CanvasNode) => void;
  updateNode: (id: string, patch: Partial<CanvasNode>) => void;
  removeNode: (id: string) => void;
  addEdge: (edge: CanvasEdge) => void;
  updateEdge: (id: string, patch: Partial<CanvasEdge>) => void;
  removeEdge: (id: string) => void;
  setPendingRelation: (sourceId: string | null, targetId: string | null) => void;
  clearPendingRelation: () => void;
}

export const createCanvasStore = (initial?: CanvasDocument) =>
  create<CanvasState>()(
    subscribeWithSelector((set) => ({
      document: initial ?? { nodes: [], edges: [] },
      mode: "nodes" as CanvasMode,
      pendingRelationSource: null,
      pendingRelationTarget: null,

      setDocument: (doc) => set({ document: doc }),

      setMode: (mode) => set({ mode }),

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

      setPendingRelation: (sourceId, targetId) =>
        set({ pendingRelationSource: sourceId, pendingRelationTarget: targetId }),

      clearPendingRelation: () =>
        set({ pendingRelationSource: null, pendingRelationTarget: null }),
    }))
  );

export type CanvasStore = ReturnType<typeof createCanvasStore>;

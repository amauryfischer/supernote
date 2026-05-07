// ============================================================
// SupernoteCanvas — main canvas component
//
// Architecture: Option B (Toggle mode)
//
// DESIGN DECISION: We chose a mode-toggle approach over a true overlay:
//
// Option A (overlay) problems we avoided:
//   1. EVENT ROUTING: Excalidraw captures all pointer events at the window
//      level. Making React Flow interactive underneath would require
//      intercepting and re-dispatching pointer events — fragile and
//      version-sensitive.
//   2. VIEWPORT SYNC: Excalidraw uses its own canvas-based coordinate system
//      (scrollX/scrollY + zoom). React Flow uses CSS transforms on a
//      positioned div. Keeping both in sync requires a `requestAnimationFrame`
//      loop that introduces 1-frame lag and potential drift.
//   3. Z-ORDER: Deciding which layer receives a click (empty space = draw
//      layer; node area = React Flow layer) requires hit-testing that
//      duplicates both libraries' internal hit-testing logic.
//   4. DOUBLE RENDER: Two full-screen GPU-accelerated canvases consume 2×
//      the GPU memory and trigger 2× paint on every frame.
//
// Option B benefits:
//   - Clean separation of concerns: one active canvas at a time.
//   - Node positions are kept in CanvasDocument world coordinates, identical
//     for both layers, so switching modes preserves positions perfectly.
//   - Excalidraw elements (free drawings) are stored in a parallel structure
//     inside the document metadata (`excalidrawElements`), not mixed with
//     typed nodes. This mirrors how Obsidian handles canvas vs. other data.
//   - Simple mental model for users: "Draw mode" for sketching, "Nodes mode"
//     for structured data.
//
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { Node as FlowNode } from "@xyflow/react";
import type { ExcalidrawElementLike } from "./DrawLayer.js";

import { createCanvasStore } from "../store/index.js";
import { useFlowAdapter, flowNodeToCanvasCoords } from "../hooks/useFlowAdapter.js";
import { ModeToggle } from "./ModeToggle.js";
import { RelationDialog } from "./RelationDialog.js";
import { DrawLayer } from "./DrawLayer.js";
import { NodesLayer } from "./NodesLayer.js";
import type { SupernoteCanvasProps } from "../types/props.js";
import type { CanvasNode } from "../types/canvas.js";

const CONTAINER_STYLE: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
  background: "var(--canvas-bg, #f8fafc)",
};

/** Main dual-mode canvas component */
export function SupernoteCanvas({
  initialData,
  onChange,
  onSave,
  resolveEntity,
  onCreateRelation,
  readOnly = false,
  className,
}: SupernoteCanvasProps) {
  // Store is created once per mount; we use a ref to avoid re-creation
  const storeRef = useRef(createCanvasStore(initialData));
  const store = storeRef.current;

  const [mode, setMode] = useState(store.getState().mode);
  const [doc, setDoc] = useState(store.getState().document);
  const [pendingSource, setPendingSource] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);

  // Excalidraw elements live outside the typed canvas document
  const [excalidrawElements, setExcalidrawElements] = useState<readonly ExcalidrawElementLike[]>([]);

  // Subscribe to store changes
  useEffect(() => {
    const unsub = store.subscribe((state) => {
      setDoc(state.document);
      setMode(state.mode);
      setPendingSource(state.pendingRelationSource);
      setPendingTarget(state.pendingRelationTarget);
    });
    return unsub;
  }, [store]);

  // Fire onChange when document changes
  useEffect(() => {
    onChange?.(doc);
  }, [doc, onChange]);

  // Keyboard shortcut: Cmd/Ctrl+S → onSave
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        onSave?.(store.getState().document);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [store, onSave]);

  const { flowNodes, flowEdges } = useFlowAdapter(doc, resolveEntity);

  // React Flow → CanvasDocument: when nodes are moved/resized
  const handleFlowNodesChange = useCallback(
    (updatedFlowNodes: FlowNode[]) => {
      updatedFlowNodes.forEach((flowNode) => {
        const original = doc.nodes.find((n) => n.id === flowNode.id);
        if (original) {
          const updated = flowNodeToCanvasCoords(flowNode, original);
          store.getState().updateNode(flowNode.id, updated as Partial<CanvasNode>);
        }
      });
    },
    [doc.nodes, store]
  );

  // React Flow connect: check if both nodes are CRM, open relation dialog
  const handleFlowConnect = useCallback(
    (connection: { source: string; target: string }) => {
      const sourceNode = doc.nodes.find((n) => n.id === connection.source);
      const targetNode = doc.nodes.find((n) => n.id === connection.target);

      if (sourceNode?.type === "crm" && targetNode?.type === "crm") {
        store.getState().setPendingRelation(connection.source, connection.target);
      } else {
        // For non-CRM connections, add a plain edge
        const newEdge = {
          id: `edge-${Date.now()}`,
          fromNode: connection.source,
          toNode: connection.target,
        };
        store.getState().addEdge(newEdge);
      }
    },
    [doc.nodes, store]
  );

  // Relation dialog confirm
  const handleRelationConfirm = useCallback(
    async (sourceId: string, targetId: string) => {
      if (!onCreateRelation) {
        store.getState().clearPendingRelation();
        return { success: true };
      }
      const result = await onCreateRelation(sourceId, targetId);
      if (result.success) {
        store.getState().addEdge({
          id: `edge-${Date.now()}`,
          fromNode: sourceId,
          toNode: targetId,
          relationTypeId: result.relationTypeId,
        });
        store.getState().clearPendingRelation();
      }
      return result;
    },
    [onCreateRelation, store]
  );

  const handleRelationCancel = useCallback(() => {
    store.getState().clearPendingRelation();
  }, [store]);

  const handleModeToggle = useCallback(
    (newMode: typeof mode) => {
      store.getState().setMode(newMode);
    },
    [store]
  );

  const handleExcalidrawChange = useCallback(
    (elements: readonly ExcalidrawElementLike[]) => {
      setExcalidrawElements(elements);
    },
    []
  );

  return (
    <div style={CONTAINER_STYLE} className={className}>
      {/* Mode toggle button — top right corner */}
      <ModeToggle mode={mode} onToggle={handleModeToggle} readOnly={readOnly} />

      {/* Draw mode: Excalidraw fills the full area */}
      {mode === "draw" && (
        <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
          <DrawLayer
            initialElements={excalidrawElements}
            onChange={handleExcalidrawChange}
            readOnly={readOnly}
          />
        </div>
      )}

      {/* Nodes mode: React Flow fills the full area */}
      {mode === "nodes" && (
        <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
          <NodesLayer
            initialNodes={flowNodes}
            initialEdges={flowEdges}
            onNodesChange={handleFlowNodesChange}
            onConnect={handleFlowConnect}
            readOnly={readOnly}
          />
        </div>
      )}

      {/* Relation creation dialog */}
      {pendingSource && pendingTarget && (
        <RelationDialog
          sourceId={pendingSource}
          targetId={pendingTarget}
          onConfirm={handleRelationConfirm}
          onCancel={handleRelationCancel}
        />
      )}
    </div>
  );
}

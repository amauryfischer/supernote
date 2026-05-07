// ============================================================
// DrawLayer — Excalidraw wrapper (free-drawing mode)
//
// This layer is shown when mode === "draw". It manages freehand drawings,
// shapes, arrows, and sticky notes. Excalidraw data is stored separately
// from the CanvasDocument (typed nodes) — the document is the source of
// truth for typed nodes; Excalidraw elements are embedded in the doc's
// metadata under `excalidrawElements` for persistence.
//
// We use dynamic import to avoid SSR issues and reduce initial bundle size.
// ============================================================

import React, { useCallback, useRef } from "react";

// Excalidraw's ExcalidrawElement and ExcalidrawImperativeAPI are internal types.
// We define a minimal interface for what we use, avoiding deep internal imports.
export interface ExcalidrawElementLike {
  readonly id: string;
  readonly type: string;
  [key: string]: unknown;
}

interface ExcalidrawImperativeLike {
  updateScene: (scene: { elements: ExcalidrawElementLike[] }) => void;
}

// Excalidraw is dynamically imported to handle its large bundle
const ExcalidrawComponent = React.lazy(() =>
  import("@excalidraw/excalidraw").then((mod) => ({
    default: mod.Excalidraw,
  }))
);

export interface DrawLayerProps {
  initialElements?: readonly ExcalidrawElementLike[];
  onChange?: (elements: readonly ExcalidrawElementLike[]) => void;
  readOnly?: boolean;
}

/** Full-screen Excalidraw layer for free-hand drawing */
export function DrawLayer({ initialElements, onChange, readOnly }: DrawLayerProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<ExcalidrawImperativeLike | null>(null);

  const handleChange = useCallback(
    // Excalidraw passes (elements, appState, files) to onChange
    (elements: unknown) => {
      onChange?.(elements as ExcalidrawElementLike[]);
    },
    [onChange]
  );

  return (
    <React.Suspense
      fallback={
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "var(--text-muted, #64748b)",
            fontSize: 14,
          }}
        >
          Loading drawing canvas…
        </div>
      }
    >
      <ExcalidrawComponent
        excalidrawAPI={(api: unknown) => {
          apiRef.current = api as ExcalidrawImperativeLike;
        }}
        onChange={handleChange as never}
        viewModeEnabled={readOnly}
        initialData={{
          elements: (initialElements ?? []) as never,
          scrollToContent: true,
        }}
        theme="light"
      />
    </React.Suspense>
  );
}

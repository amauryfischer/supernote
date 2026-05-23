// ============================================================
// SupernoteCanvas — main canvas component
//
// HISTORY: Started as a dual-mode toggle (Excalidraw "draw" vs React Flow
// "nodes"). In May 2026 we unified onto Excalidraw because the toggle
// fragmented the user experience: drawings and entity links lived in two
// disjoint surfaces, and switching modes hid one set of content from the
// other. Entity references are now first-class Excalidraw elements (see
// DrawLayer.tsx for the customData/link encoding).
//
// The legacy "nodes" mode (React Flow) was removed entirely — entity refs
// are now native Excalidraw rectangles. Loading a legacy CanvasDocument
// (with a populated `nodes` array) triggers a one-shot migration that
// transforms each typed node into an equivalent Excalidraw element so
// users don't lose their content. After migration `doc.nodes` and
// `doc.edges` are wiped so subsequent saves are pure-Excalidraw.
//
// Persistence: the CanvasDocument shape is unchanged on the wire — `nodes`
// and `edges` arrays still exist (empty for new docs) so the field type
// stays compatible.
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ExcalidrawElementLike,
  DrawLayerHandle,
  EntityRefCustomData,
} from "./DrawLayer.js";

import { createCanvasStore } from "../store/index.js";
import { DrawLayer } from "./DrawLayer.js";
import { entityRefLink } from "./DrawLayer.js";
import type { SupernoteCanvasProps } from "../types/props.js";
import type {
  CanvasDocument,
  CanvasExcalidrawElement,
  CanvasNode,
} from "../types/canvas.js";

const CONTAINER_STYLE: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
  background: "var(--canvas-bg, #f8fafc)",
};

// ----- Legacy nodes migration ---------------------------------------------
//
// Loading a CanvasDocument that still has typed nodes (from before the
// unification) needs to feel seamless: we transform each node into an
// equivalent Excalidraw element placed at the original coordinates so the
// user doesn't see content jump or vanish. CRM nodes become entity-ref
// rectangles (same encoding DrawLayer uses for live insertion); other types
// become a labelled rectangle so they remain visible and editable.
//
// We hand-write the Excalidraw element JSON instead of calling
// `convertToExcalidrawElements` because that helper is async-only via the
// dynamic import and we want migration to be synchronous on mount. The
// minimal shape (`id` + `type` + geometry + style fields) is restored by
// Excalidraw with sensible defaults for everything else (seed, version,
// versionNonce, index, …).

const ENTITY_FILL = "#ede9fe";
const ENTITY_STROKE = "#7c3aed";
const TEXT_STROKE = "#1e293b";
const GROUP_FILL = "rgba(200,200,200,0.10)";
const GROUP_STROKE = "#cbd5e1";

interface MigratedElement {
  readonly id: string;
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly [key: string]: unknown;
}

function legacyNodeToExcalidrawElements(node: CanvasNode): MigratedElement[] {
  const baseRect = {
    id: `migrated-${node.id}`,
    type: "rectangle",
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    angle: 0,
    strokeColor: TEXT_STROKE,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    roundness: { type: 3 },
  };

  switch (node.type) {
    case "crm": {
      const customData: EntityRefCustomData = {
        kind: "entity-ref",
        entityId: node.entityId,
        entityName: node.entityId,
        entityType: "",
      };
      return [
        {
          ...baseRect,
          backgroundColor: ENTITY_FILL,
          strokeColor: ENTITY_STROKE,
          link: entityRefLink(node.entityId, ""),
          customData,
        },
        {
          id: `migrated-${node.id}-label`,
          type: "text",
          x: node.x + 8,
          y: node.y + node.height / 2 - 12,
          width: Math.max(0, node.width - 16),
          height: 24,
          angle: 0,
          strokeColor: TEXT_STROKE,
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 1,
          opacity: 100,
          text: node.entityId,
          fontSize: 16,
          fontFamily: 5,
          textAlign: "center",
          verticalAlign: "middle",
        },
      ];
    }

    case "text":
      return [
        {
          id: `migrated-${node.id}`,
          type: "text",
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          angle: 0,
          strokeColor: TEXT_STROKE,
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 1,
          opacity: 100,
          text: node.text,
          fontSize: 16,
          fontFamily: 5,
          textAlign: "left",
          verticalAlign: "top",
        },
      ];

    case "link":
      return [
        {
          ...baseRect,
          backgroundColor: "#eff6ff",
          strokeColor: "#2563eb",
          link: node.url,
        },
        {
          id: `migrated-${node.id}-label`,
          type: "text",
          x: node.x + 8,
          y: node.y + node.height / 2 - 12,
          width: Math.max(0, node.width - 16),
          height: 24,
          angle: 0,
          strokeColor: "#2563eb",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 1,
          opacity: 100,
          text: node.url,
          fontSize: 14,
          fontFamily: 5,
          textAlign: "center",
          verticalAlign: "middle",
        },
      ];

    case "file":
      return [
        {
          ...baseRect,
          backgroundColor: "#f1f5f9",
        },
        {
          id: `migrated-${node.id}-label`,
          type: "text",
          x: node.x + 8,
          y: node.y + node.height / 2 - 12,
          width: Math.max(0, node.width - 16),
          height: 24,
          angle: 0,
          strokeColor: TEXT_STROKE,
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 1,
          opacity: 100,
          text: node.subpath ? `${node.file}${node.subpath}` : node.file,
          fontSize: 14,
          fontFamily: 5,
          textAlign: "center",
          verticalAlign: "middle",
        },
      ];

    case "group":
      return [
        {
          ...baseRect,
          backgroundColor: node.background ?? GROUP_FILL,
          strokeColor: GROUP_STROKE,
          strokeStyle: "dashed",
          ...(node.label
            ? {}
            : {}),
        },
        ...(node.label
          ? [
              {
                id: `migrated-${node.id}-label`,
                type: "text",
                x: node.x + 8,
                y: node.y + 6,
                width: Math.max(0, node.width - 16),
                height: 20,
                angle: 0,
                strokeColor: TEXT_STROKE,
                backgroundColor: "transparent",
                fillStyle: "solid",
                strokeWidth: 1,
                strokeStyle: "solid",
                roughness: 1,
                opacity: 100,
                text: node.label,
                fontSize: 14,
                fontFamily: 5,
                textAlign: "left",
                verticalAlign: "top",
              } satisfies MigratedElement,
            ]
          : []),
      ];

    case "query":
      return [
        {
          ...baseRect,
          backgroundColor: "#fef3c7",
          strokeColor: "#d97706",
        },
        {
          id: `migrated-${node.id}-label`,
          type: "text",
          x: node.x + 8,
          y: node.y + 6,
          width: Math.max(0, node.width - 16),
          height: 20,
          angle: 0,
          strokeColor: TEXT_STROKE,
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 1,
          opacity: 100,
          text: `Query: ${node.query}`,
          fontSize: 13,
          fontFamily: 5,
          textAlign: "left",
          verticalAlign: "top",
        },
      ];

    default: {
      // Exhaustiveness fallback — if a future CanvasNode variant is added we
      // still produce *something* visible rather than dropping silently.
      const _unhandled: never = node;
      void _unhandled;
      return [];
    }
  }
}

/**
 * Migrate a legacy CanvasDocument that still has typed nodes onto pure
 * Excalidraw elements. Returns the migrated `excalidrawElements` array
 * (existing draw elements first, then converted nodes).
 *
 * The legacy `edges` array is dropped: edges only made sense between typed
 * React Flow nodes. We could in theory render them as Excalidraw arrows,
 * but doing so reliably (with correct binding to migrated rectangles)
 * isn't worth the complexity given how rarely typed-node graphs were used
 * in practice.
 */
function migrateLegacyDoc(doc: CanvasDocument): {
  excalidrawElements: CanvasExcalidrawElement[];
  migrated: boolean;
} {
  if (!doc.nodes || doc.nodes.length === 0) {
    return {
      excalidrawElements: (doc.excalidrawElements ?? []) as CanvasExcalidrawElement[],
      migrated: false,
    };
  }
  const existing = (doc.excalidrawElements ?? []) as CanvasExcalidrawElement[];
  const migratedFromNodes: CanvasExcalidrawElement[] = doc.nodes.flatMap(
    (n) => legacyNodeToExcalidrawElements(n) as unknown as CanvasExcalidrawElement[]
  );
  return {
    excalidrawElements: [...existing, ...migratedFromNodes],
    migrated: true,
  };
}

/** Main unified canvas component */
export function SupernoteCanvas({
  initialData,
  onChange,
  onSave,
  resolveEntity,
  onLinkEntity,
  onEntityNavigate,
  readOnly = false,
  className,
}: SupernoteCanvasProps) {
  // One-shot legacy migration. Any typed nodes in the incoming doc are
  // converted to Excalidraw elements before the store is created, then the
  // store starts life with `nodes` + `edges` already wiped. The next
  // `onChange` will therefore propagate the migrated, pure-Excalidraw doc.
  const initialMigrated = useMemo(() => {
    if (!initialData) {
      return {
        document: { nodes: [], edges: [] } as CanvasDocument,
        excalidrawElements: [] as CanvasExcalidrawElement[],
        wasMigrated: false,
      };
    }
    const { excalidrawElements, migrated } = migrateLegacyDoc(initialData);
    const cleanedDoc: CanvasDocument = {
      ...initialData,
      nodes: [],
      edges: [],
      excalidrawElements,
    };
    return {
      document: cleanedDoc,
      excalidrawElements,
      wasMigrated: migrated,
    };
    // We intentionally only compute this on the first render — re-running on
    // every `initialData` change would re-migrate already-migrated content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Store is created once per mount; we use a ref to avoid re-creation
  const storeRef = useRef(createCanvasStore(initialMigrated.document));
  const store = storeRef.current;

  const [doc, setDoc] = useState(store.getState().document);

  // Imperative handle from the DrawLayer so we can insert entity-ref elements
  // without round-tripping through React state (which would lose the user's
  // viewport during the same render cycle).
  const drawLayerRef = useRef<DrawLayerHandle | null>(null);

  // Subscribe to store changes
  useEffect(() => {
    const unsub = store.subscribe((state) => {
      setDoc(state.document);
    });
    return unsub;
  }, [store]);

  // Hold the latest `doc` and `onChange` in refs so `handleExcalidrawChange`
  // — fired from inside Excalidraw — can read the current value without
  // forcing the parent component to re-render through the React state lane.
  //
  // Why not React state for the elements? Excalidraw MUTATES its elements
  // array in place during a drag/resize (the same array reference, with the
  // shape's width/height updated on the existing element object). If we feed
  // that into setExcalidrawElements, React's identity check sees no change
  // and skips the re-render — so the downstream effect never fires for the
  // updated dimensions, and our debounced save persists the pointer-DOWN
  // state (typically a 0×0 ghost rectangle). Cloning the array via
  // `[...elements]` does force a re-render, but then Excalidraw's own
  // internal effects observe the prop churn and re-fire onChange in a tight
  // loop → "Maximum update depth exceeded". Bypassing React state entirely
  // (call onChange directly on each Excalidraw fire) sidesteps both: every
  // tick of dimension growth reaches the parent, and we never trigger a
  // re-render that Excalidraw can echo back.
  const docRef = useRef(doc);
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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

  const handleExcalidrawChange = useCallback(
    (elements: readonly ExcalidrawElementLike[]) => {
      console.info(`[SupernoteCanvas] handleExcalidrawChange — elements=${elements.length}`);
      const fire = onChangeRef.current;
      if (!fire) return;
      // Snapshot the elements into a fresh array before handing them off:
      // Excalidraw is free to mutate its own array AFTER we return, which
      // would otherwise reach into the parent's debounced closures and
      // change the payload retroactively.
      fire({
        ...docRef.current,
        excalidrawElements: [...elements] as CanvasExcalidrawElement[],
      });
    },
    []
  );

  // The DrawLayer's own toolbar wires the entity picker directly so the
  // typed "Lier ..." buttons are always visible inside the unified canvas.
  // When the user clicks a typed button, DrawLayer passes its `typeFilter`
  // through to us — we forward it to the host so its picker can pre-filter
  // the search by entity type.
  const drawLayerOnLinkEntity = useMemo(() => {
    if (!onLinkEntity) return undefined;
    return (
      insert: (data: EntityRefCustomData) => void,
      typeFilter?: string,
    ) => {
      onLinkEntity((entityId) => {
        void (async () => {
          let entityName = entityId;
          let entityType = "";
          if (resolveEntity) {
            try {
              const ref = await resolveEntity(entityId);
              if (ref) {
                entityName = ref.name;
                entityType = ref.typeName;
              }
            } catch {
              /* keep defaults */
            }
          }
          insert({ kind: "entity-ref", entityId, entityName, entityType });
        })();
      }, typeFilter);
    };
  }, [onLinkEntity, resolveEntity]);

  return (
    <div style={CONTAINER_STYLE} className={className}>
      <div style={{ position: "absolute", inset: 0, zIndex: 1 }}>
        <DrawLayer
          ref={drawLayerRef}
          initialElements={initialMigrated.excalidrawElements as unknown as readonly ExcalidrawElementLike[]}
          onChange={handleExcalidrawChange}
          onLinkEntity={drawLayerOnLinkEntity}
          onEntityNavigate={onEntityNavigate}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}

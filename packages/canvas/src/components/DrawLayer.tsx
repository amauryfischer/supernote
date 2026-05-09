// ============================================================
// DrawLayer — Excalidraw wrapper, now unified canvas surface
//
// What changed (May 2026): the canvas is no longer a draw-OR-nodes toggle.
// Entity references are now first-class Excalidraw elements (a styled
// rectangle with a text label and `customData.kind === "entity-ref"`),
// so users can free-draw AND link entities on the SAME surface.
//
// How it works:
//
//   1. Toolbar overlay (top-left) exposes "+ Lier une entité". Clicking it
//      bubbles via `onLinkEntity(addEntityRef)` so the host can open its
//      tRPC-backed picker; once the user picks an entity the host calls back
//      our imperative `addEntityRef` which inserts the element into the
//      Excalidraw scene via `excalidrawAPI.updateScene`.
//
//   2. Each entity rectangle carries a `link` of the form
//      `supernote-entity://{entityId}?type={typeName}`. Excalidraw renders
//      its built-in link icon on the element when selected/hovered. Clicking
//      that icon fires `onLinkOpen`; we `preventDefault()` to suppress the
//      default open-in-new-tab and call `onEntityNavigate` so the host
//      router.push'es to the entity's detail page.
//
//   3. We register `validateEmbeddable` to accept the `supernote-entity://`
//      scheme so Excalidraw doesn't filter it out when persisted/restored.
//      (The validator is consulted for `link` validity, not just embeddable
//      elements — Excalidraw's restore code uses `normalizeLink` which
//      trims/sanitises but does not reject custom schemes; the explicit
//      validator is belt-and-braces for future versions.)
//
//   4. Drag/resize/delete on the entity rectangle are handled by Excalidraw
//      natively because it's a regular shape — no overlay sync gymnastics.
//
// Persistence: customData round-trips through JSON.stringify, so the entity
// reference survives reload via the existing `fields.canvas` longtext path.
//
// We use dynamic import to avoid SSR issues and reduce initial bundle size.
// ============================================================

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

// Excalidraw ships its stylesheet separately. Without this import the toolbar
// is invisible and pointer-events on the canvas surface are broken — drawing
// silently fails. The CSS export was renamed to /index.css in 0.18.x.
import "@excalidraw/excalidraw/index.css";

// Excalidraw's ExcalidrawElement and ExcalidrawImperativeAPI are internal types.
// We define a minimal interface for what we use, avoiding deep internal imports.
export interface ExcalidrawElementLike {
  readonly id: string;
  readonly type: string;
  readonly customData?: Record<string, unknown>;
  readonly link?: string | null;
  [key: string]: unknown;
}

interface ExcalidrawImperativeLike {
  updateScene: (scene: { elements: ExcalidrawElementLike[] }) => void;
  getSceneElements: () => readonly ExcalidrawElementLike[];
  getAppState: () => { width: number; height: number; scrollX: number; scrollY: number; zoom: { value: number } };
}

/** Custom data shape carried by entity-ref rectangles. */
export interface EntityRefCustomData {
  readonly kind: "entity-ref";
  readonly entityId: string;
  readonly entityName: string;
  readonly entityType: string;
}

/** URL scheme used as the rectangle's `link`; matched by `onLinkOpen`. */
export const ENTITY_LINK_SCHEME = "supernote-entity://";

/** Build the canonical link string for an entity reference element. */
export function entityRefLink(entityId: string, entityType: string): string {
  return `${ENTITY_LINK_SCHEME}${encodeURIComponent(entityId)}?type=${encodeURIComponent(entityType)}`;
}

/** Parse a `supernote-entity://...` link, returning null for unrelated URLs. */
export function parseEntityRefLink(link: string | null | undefined): { entityId: string; entityType: string } | null {
  if (!link || !link.startsWith(ENTITY_LINK_SCHEME)) return null;
  const rest = link.slice(ENTITY_LINK_SCHEME.length);
  const [rawId, rawQuery] = rest.split("?");
  const params = new URLSearchParams(rawQuery ?? "");
  const entityType = params.get("type") ?? "";
  if (!rawId) return null;
  try {
    return { entityId: decodeURIComponent(rawId), entityType: decodeURIComponent(entityType) };
  } catch {
    return null;
  }
}

// Excalidraw is dynamically imported to handle its large bundle. We pull both
// the component AND `convertToExcalidrawElements` so we can safely build new
// elements with all required defaults (seed, version, index, …).
const ExcalidrawModulePromise = import("@excalidraw/excalidraw");

const ExcalidrawComponent = React.lazy(() =>
  ExcalidrawModulePromise.then((mod) => ({ default: mod.Excalidraw }))
);

export interface DrawLayerHandle {
  /**
   * Insert an entity-reference rectangle near the current viewport center.
   * Returns the id of the newly inserted element so callers can select it.
   */
  addEntityRef: (data: EntityRefCustomData) => string | null;
}

export interface DrawLayerProps {
  initialElements?: readonly ExcalidrawElementLike[];
  onChange?: (elements: readonly ExcalidrawElementLike[]) => void;
  /**
   * When provided, shows a row of typed "Lier ..." buttons in the top-left
   * toolbar (Lier une note / un contact / un projet / …). The host owns the
   * picker UI; clicking calls back with the imperative inserter so the host
   * can run its own search flow — pre-filtered to `typeFilter` — then insert.
   *
   * `typeFilter` is the entity-type id (e.g. "personne", "note", "projet")
   * keyed off the button the user clicked. When `undefined` (e.g. legacy
   * callers or a future "any" button) the host should accept any type.
   */
  onLinkEntity?: (
    addEntityRef: (data: EntityRefCustomData) => void,
    typeFilter?: string,
  ) => void;
  /**
   * Called when the user clicks the link icon on an entity-ref element.
   * The host should navigate to the entity's detail page.
   */
  onEntityNavigate?: (entityId: string, entityType: string) => void;
  readOnly?: boolean;
}

const TOOLBAR_STYLE: React.CSSProperties = {
  position: "absolute",
  // Sit on the SAME row as Excalidraw's native shape toolbar, parked at
  // top-left. The toolbar renders icon-only (no labels — see
  // `iconOnly` in the render below), so its compact width never reaches
  // Excalidraw's centered toolbar even on narrow panes.
  top: 12,
  left: 52,
  width: "max-content",
  // Hard ceiling so even with all primary buttons visible we never push
  // past the rough left half of the canvas (Excalidraw's toolbar is
  // centered around 50%).
  maxWidth: "calc(50% - 12px)",
  zIndex: 20,
  display: "flex",
  flexWrap: "nowrap",
  alignItems: "center",
  gap: 2,
  padding: 4,
  background: "var(--surface, #fff)",
  border: "1px solid var(--border-subtle, #e2e8f0)",
  borderRadius: 8,
  boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
};

const TOOLBAR_BUTTON_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 500,
  background: "transparent",
  color: "var(--text-primary, #1e293b)",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  transition: "background 0.12s",
  whiteSpace: "nowrap",
};

const TOOLBAR_ICON_STYLE: React.CSSProperties = {
  flexShrink: 0,
  display: "inline-block",
};

// ---------------------------------------------------------------------------
// Typed entity-link buttons
//
// We inline minimal SVG icons (extracted from Phosphor's "regular" weight) so
// the canvas package keeps zero icon dependencies — the package is meant to
// stay portable, and pulling @phosphor-icons/react in just for six 16px
// glyphs would inflate the bundle for every canvas consumer.
//
// Icon paths come from phosphor-icons.com (regular weight, 256x256 viewBox).
// Each `typeId` corresponds to the entity-type ids defined in
// `apps/web/src/lib/vault-worker/seed-default-types.ts`.
// ---------------------------------------------------------------------------

interface EntityLinkButton {
  readonly typeId: string;
  readonly label: string;
  /** Phosphor-derived path data (regular weight, 256-unit viewBox). */
  readonly icon: React.ReactNode;
}

const PhosphorIcon = ({ children }: { children: React.ReactNode }) => (
  <svg
    width={14}
    height={14}
    viewBox="0 0 256 256"
    fill="currentColor"
    aria-hidden="true"
    style={TOOLBAR_ICON_STYLE}
  >
    {children}
  </svg>
);

// Phosphor "FileText" (regular)
const IconFileText = (
  <PhosphorIcon>
    <path d="M213.66,82.34l-56-56A8,8,0,0,0,152,24H56A16,16,0,0,0,40,40V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V88A8,8,0,0,0,213.66,82.34ZM160,51.31,188.69,80H160ZM200,216H56V40h88V88a8,8,0,0,0,8,8h48V216ZM152,144a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h56A8,8,0,0,1,152,144Zm16,32a8,8,0,0,1-8,8H88a8,8,0,0,1,0-16h72A8,8,0,0,1,168,176Z" />
  </PhosphorIcon>
);

// Phosphor "User" (regular)
const IconUser = (
  <PhosphorIcon>
    <path d="M230.93,220a8,8,0,0,1-6.93,4H32a8,8,0,0,1-6.92-12c15.23-26.33,38.7-45.21,66.09-54.16a72,72,0,1,1,73.66,0c27.39,8.95,50.86,27.83,66.09,54.16A8,8,0,0,1,230.93,220ZM128,152a56,56,0,1,0-56-56A56.06,56.06,0,0,0,128,152Z" />
  </PhosphorIcon>
);

// Phosphor "Stack" (regular)
const IconStack = (
  <PhosphorIcon>
    <path d="M228.24,130.24l-24-15-76-47.5a8,8,0,0,0-8.48,0l-100,62.5a8,8,0,0,0,0,13.52l24,15-24,15a8,8,0,0,0,0,13.52l100,62.5a8,8,0,0,0,8.48,0l100-62.5a8,8,0,0,0,0-13.52l-24-15,24-15A8,8,0,0,0,228.24,130.24ZM128,83.43,213,136.5l-85,53.07L43,136.5ZM128,222.07,43,169l16.85-10.53,63.91,39.94a8,8,0,0,0,8.48,0l63.91-39.94L213,169Z" />
  </PhosphorIcon>
);

// Phosphor "Buildings" (regular)
const IconBuildings = (
  <PhosphorIcon>
    <path d="M240,208H224V96a8,8,0,0,0-8-8H144V32a8,8,0,0,0-12-6.91L36,80.45A8,8,0,0,0,32,87.37V208H16a8,8,0,0,0,0,16H240a8,8,0,0,0,0-16ZM128,208H48V92.06l80-46.65Zm80,0H144V104h64ZM176,140v-8a8,8,0,0,1,16,0v8a8,8,0,0,1-16,0Zm0,40v-8a8,8,0,0,1,16,0v8a8,8,0,0,1-16,0Zm-72-92v8a8,8,0,0,1-16,0v-8a8,8,0,0,1,16,0Zm0,36v8a8,8,0,0,1-16,0v-8a8,8,0,0,1,16,0Zm0,40v8a8,8,0,0,1-16,0v-8a8,8,0,0,1,16,0Zm-32-76v8a8,8,0,0,1-16,0v-8a8,8,0,0,1,16,0Zm0,36v8a8,8,0,0,1-16,0v-8a8,8,0,0,1,16,0Zm0,40v8a8,8,0,0,1-16,0v-8a8,8,0,0,1,16,0Z" />
  </PhosphorIcon>
);

// Phosphor "MessageCircle" → "ChatCircle" (regular) — closer match
const IconChatCircle = (
  <PhosphorIcon>
    <path d="M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-6.54-.67L40,216,52.47,178.6a8,8,0,0,0-.66-6.54A88,88,0,1,1,128,216Z" />
  </PhosphorIcon>
);

// Phosphor "Wallet" (regular) — for `account`
const IconWallet = (
  <PhosphorIcon>
    <path d="M216,72H56a8,8,0,0,1,0-16H192a8,8,0,0,0,0-16H56A24,24,0,0,0,32,64V192a24,24,0,0,0,24,24H216a16,16,0,0,0,16-16V88A16,16,0,0,0,216,72Zm0,128H56a8,8,0,0,1-8-8V86.63A23.84,23.84,0,0,0,56,88H216Zm-48-60a12,12,0,1,1,12,12A12,12,0,0,1,168,140Z" />
  </PhosphorIcon>
);

// Phosphor "TrendingUp" → "TrendUp" (regular) — for `asset`
const IconTrendUp = (
  <PhosphorIcon>
    <path d="M232,56v64a8,8,0,0,1-16,0V75.31l-82.34,82.35a8,8,0,0,1-11.32,0L96,123.31,29.66,189.66a8,8,0,0,1-11.32-11.32l72-72a8,8,0,0,1,11.32,0L128,140.69,204.69,64H160a8,8,0,0,1,0-16h64A8,8,0,0,1,232,56Z" />
  </PhosphorIcon>
);

// Phosphor "Target" (regular) — for `goal`
const IconTarget = (
  <PhosphorIcon>
    <path d="M128,72a56,56,0,1,0,56,56A56.06,56.06,0,0,0,128,72Zm0,96a40,40,0,1,1,40-40A40,40,0,0,1,128,168Zm104-40A104,104,0,1,1,128,24,104.12,104.12,0,0,1,232,128Zm-16,0a87.62,87.62,0,0,0-22.24-58.43l-11.32,11.32a72,72,0,1,1-11.33-11.32l11.33-11.32A88,88,0,1,1,216,128Z" />
  </PhosphorIcon>
);

// Phosphor "CreditCard" (regular) — for `loan`
const IconCreditCard = (
  <PhosphorIcon>
    <path d="M224,48H32A16,16,0,0,0,16,64V192a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V64A16,16,0,0,0,224,48Zm0,16V88H32V64Zm0,128H32V104H224v88Zm-16-24a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h32A8,8,0,0,1,208,168Zm-64,0a8,8,0,0,1-8,8H120a8,8,0,0,1,0-16h16A8,8,0,0,1,144,168Z" />
  </PhosphorIcon>
);

// Phosphor "SquaresFour" (regular) — for `canvas`
const IconSquaresFour = (
  <PhosphorIcon>
    <path d="M104,40H48A16,16,0,0,0,32,56v56a16,16,0,0,0,16,16h56a16,16,0,0,0,16-16V56A16,16,0,0,0,104,40Zm0,72H48V56h56v56Zm104-72H152a16,16,0,0,0-16,16v56a16,16,0,0,0,16,16h56a16,16,0,0,0,16-16V56A16,16,0,0,0,208,40Zm0,72H152V56h56v56Zm-104,32H48a16,16,0,0,0-16,16v56a16,16,0,0,0,16,16h56a16,16,0,0,0,16-16V160A16,16,0,0,0,104,144Zm0,72H48V160h56v56Zm104-72H152a16,16,0,0,0-16,16v56a16,16,0,0,0,16,16h56a16,16,0,0,0,16-16V160A16,16,0,0,0,208,144Zm0,72H152V160h56v56Z" />
  </PhosphorIcon>
);

// Phosphor "CaretDown" (regular) — for the "Plus..." dropdown chevron
const IconCaretDown = (
  <PhosphorIcon>
    <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
  </PhosphorIcon>
);

const PRIMARY_BUTTONS: readonly EntityLinkButton[] = [
  { typeId: "note", label: "Lier une note", icon: IconFileText },
  { typeId: "personne", label: "Lier un contact", icon: IconUser },
  { typeId: "projet", label: "Lier un projet", icon: IconStack },
  { typeId: "organisation", label: "Lier une organisation", icon: IconBuildings },
  { typeId: "interaction", label: "Lier une interaction", icon: IconChatCircle },
];

const OVERFLOW_BUTTONS: readonly EntityLinkButton[] = [
  { typeId: "asset", label: "Lier un actif", icon: IconTrendUp },
  { typeId: "account", label: "Lier un compte", icon: IconWallet },
  { typeId: "goal", label: "Lier un objectif", icon: IconTarget },
  { typeId: "loan", label: "Lier un prêt", icon: IconCreditCard },
  { typeId: "canvas", label: "Lier un canvas", icon: IconSquaresFour },
];

const DROPDOWN_STYLE: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  right: 0,
  minWidth: 180,
  padding: 4,
  background: "var(--surface, #fff)",
  border: "1px solid var(--border-subtle, #e2e8f0)",
  borderRadius: 8,
  boxShadow: "0 4px 12px rgba(0,0,0,0.10)",
  display: "flex",
  flexDirection: "column",
  gap: 2,
  zIndex: 21,
};

const DROPDOWN_ITEM_STYLE: React.CSSProperties = {
  ...TOOLBAR_BUTTON_STYLE,
  width: "100%",
  padding: "6px 10px",
  textAlign: "left",
  justifyContent: "flex-start",
};

const ENTITY_RECT_DIMS = { width: 280, height: 80 } as const;

/** Excalidraw rejects ids with characters outside [A-Za-z0-9_-]; sanitise. */
function makeElementId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * Compute viewport-center scene coordinates so freshly-inserted entity rects
 * land where the user is currently looking, not at the origin.
 */
function viewportCenterSceneCoords(api: ExcalidrawImperativeLike): { x: number; y: number } {
  try {
    const { width, height, scrollX, scrollY, zoom } = api.getAppState();
    const z = zoom?.value ?? 1;
    return {
      x: -scrollX + width / 2 / z - ENTITY_RECT_DIMS.width / 2,
      y: -scrollY + height / 2 / z - ENTITY_RECT_DIMS.height / 2,
    };
  } catch {
    return { x: 80, y: 80 };
  }
}

/**
 * Excalidraw's `validateEmbeddable` is consulted both for the iframe `embeddable`
 * element AND for general link sanity. We accept the entity scheme + standard
 * web URLs so existing canvases (with http links) keep working.
 */
function validateEmbeddable(link: string): boolean | undefined {
  if (link.startsWith(ENTITY_LINK_SCHEME)) return true;
  // Returning `undefined` lets Excalidraw fall back to its built-in allowlist
  // for standard embed sources (YouTube, Vimeo, Figma, etc.).
  return undefined;
}

/**
 * Width thresholds that drive the toolbar's responsive collapse.
 * Below `COMPACT_BREAKPOINT` we drop the long French labels and show
 * icon-only buttons; below `MINIMAL_BREAKPOINT` we additionally collapse
 * everything but the first two primary buttons into the "Plus" menu.
 *
 * Numbers chosen empirically: the full toolbar (5 primary + "Plus") needs
 * ~720px to render comfortably. At 520px it starts wrapping; at 360px even
 * icons-only wraps. Picking the breakpoints just above each wrap point
 * gives a snap-free transition as the user resizes the editor pane.
 */
const TOOLBAR_COMPACT_BREAKPOINT = 720;
const TOOLBAR_MINIMAL_BREAKPOINT = 360;

/** Full-screen Excalidraw layer; entity refs live inside the same scene. */
export const DrawLayer = forwardRef<DrawLayerHandle, DrawLayerProps>(function DrawLayer(
  { initialElements, onChange, onLinkEntity, onEntityNavigate, readOnly },
  ref
) {
  const apiRef = useRef<ExcalidrawImperativeLike | null>(null);
  // Track the toolbar's offsetParent (the canvas wrapper) width so we can
  // collapse labels when the available room is tight. ResizeObserver keeps
  // the layout reactive as the user toggles focus mode / collapses columns.
  const toolbarWrapperRef = useRef<HTMLDivElement | null>(null);
  const [toolbarWidth, setToolbarWidth] = useState<number>(Number.POSITIVE_INFINITY);
  useEffect(() => {
    const node = toolbarWrapperRef.current;
    if (!node) return;
    // Observe the parent (the canvas pane). The toolbar itself has `right`
    // set, so its own width follows the parent — no point watching it.
    const target = node.offsetParent as HTMLElement | null ?? node;
    if (typeof ResizeObserver === "undefined") {
      setToolbarWidth(target.getBoundingClientRect().width);
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setToolbarWidth(entry.contentRect.width);
    });
    ro.observe(target);
    setToolbarWidth(target.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  // Always render icon-only — the toolbar lives on the canvas's top-left,
  // beside Excalidraw's centered shape toolbar, and labels would push it
  // wide enough to collide with the native row.
  const compact = true;
  const minimal = toolbarWidth < TOOLBAR_MINIMAL_BREAKPOINT;

  const handleChange = useCallback(
    // Excalidraw passes (elements, appState, files) to onChange
    (elements: unknown) => {
      onChange?.(elements as ExcalidrawElementLike[]);
    },
    [onChange]
  );

  // onLinkOpen fires when the user clicks the link icon on any element. We
  // intercept entity-ref links here so the host can navigate without losing
  // the canvas state to a tab swap.
  const handleLinkOpen = useCallback(
    (
      element: { link?: string | null; customData?: Record<string, unknown> | undefined },
      event: CustomEvent<{ nativeEvent: MouseEvent | React.PointerEvent<HTMLCanvasElement> }>
    ) => {
      const parsed = parseEntityRefLink(element.link ?? undefined);
      if (!parsed) return; // not ours — let Excalidraw open it normally
      // Suppress the default window.open(...) that Excalidraw would otherwise do.
      event.preventDefault();
      // Prefer customData when available (already includes the entity type as
      // the user wrote it, no decoding round-trip).
      const cd = element.customData as Partial<EntityRefCustomData> | undefined;
      const entityId = cd?.entityId ?? parsed.entityId;
      const entityType = cd?.entityType ?? parsed.entityType;
      onEntityNavigate?.(entityId, entityType);
    },
    [onEntityNavigate]
  );

  /**
   * Build and insert an entity-reference rectangle. We construct two elements:
   * a styled rectangle (the visual card) and a text label *bound* to the
   * rectangle (so it moves/resizes together). The rectangle carries the
   * customData and the link; the text inherits no link so clicks on the text
   * don't trigger navigation while editing.
   *
   * We bypass `convertToExcalidrawElements` and write the minimal shape
   * directly: convertToExcalidrawElements adds a generated id we'd then have
   * to read back to wire bindings, while a hand-written pair is simpler and
   * safer for our deterministic ids.
   */
  const insertEntityRef = useCallback(
    (data: EntityRefCustomData): string | null => {
      const api = apiRef.current;
      if (!api) return null;

      ExcalidrawModulePromise.then((mod) => {
        const api2 = apiRef.current;
        if (!api2) return;
        const { x, y } = viewportCenterSceneCoords(api2);
        const containerId = makeElementId("entity");
        const labelText = `${data.entityType ? data.entityType + " · " : ""}${data.entityName}`;

        // convertToExcalidrawElements normalises seed/version/index for us so
        // updateScene accepts the shapes without complaint.
        const skeleton = [
          {
            type: "rectangle" as const,
            id: containerId,
            x,
            y,
            width: ENTITY_RECT_DIMS.width,
            height: ENTITY_RECT_DIMS.height,
            backgroundColor: "#ede9fe",
            strokeColor: "#7c3aed",
            strokeWidth: 1,
            roundness: { type: 3 as const },
            fillStyle: "solid" as const,
            link: entityRefLink(data.entityId, data.entityType),
            customData: { ...data },
            label: {
              text: labelText,
              fontSize: 16,
              fontFamily: 5 as const, // Assistant — readable for entity names
              textAlign: "center" as const,
              verticalAlign: "middle" as const,
              strokeColor: "#1e293b",
            },
          },
        ];
        const built = mod.convertToExcalidrawElements(skeleton, {
          regenerateIds: false,
        }) as readonly ExcalidrawElementLike[];

        const current = api2.getSceneElements();
        api2.updateScene({
          elements: [...current, ...built] as ExcalidrawElementLike[],
        });
      });
      return null;
    },
    []
  );

  useImperativeHandle(ref, () => ({ addEntityRef: insertEntityRef }), [insertEntityRef]);

  const handleLinkEntityClick = useCallback(
    (typeFilter: string) => {
      onLinkEntity?.((data) => {
        insertEntityRef(data);
      }, typeFilter);
    },
    [onLinkEntity, insertEntityRef],
  );

  // Dropdown ("Plus...") open/close state. Closes on outside click and on
  // Escape so it doesn't trap the canvas focus.
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!overflowOpen) return;
    function onDocPointer(e: MouseEvent) {
      const wrap = overflowWrapRef.current;
      if (wrap && e.target instanceof Node && wrap.contains(e.target)) return;
      setOverflowOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOverflowOpen(false);
    }
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [overflowOpen]);

  // Shape the visible vs overflowed buttons by available width:
  //   - normal:  5 primary inline + "Plus..." dropdown of the rest
  //   - compact: same 5 primary, but icon-only (label hidden)
  //   - minimal: only the first 2 primary visible (icon-only); everything
  //              else moves into the dropdown to keep the row from wrapping
  //              into multiple lines on very narrow panes.
  const visiblePrimary = minimal ? PRIMARY_BUTTONS.slice(0, 2) : PRIMARY_BUTTONS;
  const overflowItems = minimal
    ? [...PRIMARY_BUTTONS.slice(2), ...OVERFLOW_BUTTONS]
    : OVERFLOW_BUTTONS;

  // In compact mode buttons collapse to icon-only, but we keep a min-width
  // so they don't dance around as the user hovers each one. The inline
  // toolbar button style is computed on-the-fly so the regular path keeps
  // its "padding: 4px 10px" feel while compact mode squeezes to "4px 8px".
  const compactBtnStyle: React.CSSProperties = compact
    ? { ...TOOLBAR_BUTTON_STYLE, padding: "4px 8px" }
    : TOOLBAR_BUTTON_STYLE;

  return (
    <>
      {!readOnly && onLinkEntity && (
        <div ref={toolbarWrapperRef} style={TOOLBAR_STYLE}>
          {visiblePrimary.map((btn) => (
            <button
              key={btn.typeId}
              type="button"
              style={compactBtnStyle}
              onClick={() => handleLinkEntityClick(btn.typeId)}
              // Title always carries the full label so the tooltip stays
              // helpful even when the visible label is hidden.
              title={btn.label}
              aria-label={btn.label}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-2, #f1f5f9)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {btn.icon}
              {!compact && <span>{btn.label}</span>}
            </button>
          ))}
          <div ref={overflowWrapRef} style={{ position: "relative" }}>
            <button
              type="button"
              style={compactBtnStyle}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              aria-label="Plus de types d'entités"
              onClick={() => setOverflowOpen((v) => !v)}
              title="Plus de types d'entités"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-2, #f1f5f9)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {!compact && <span>Plus</span>}
              {IconCaretDown}
            </button>
            {overflowOpen && (
              <div role="menu" style={DROPDOWN_STYLE}>
                {overflowItems.map((btn) => (
                  <button
                    key={btn.typeId}
                    type="button"
                    role="menuitem"
                    style={DROPDOWN_ITEM_STYLE}
                    onClick={() => {
                      setOverflowOpen(false);
                      handleLinkEntityClick(btn.typeId);
                    }}
                    title={btn.label}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--surface-2, #f1f5f9)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    {btn.icon}
                    {btn.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
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
          onLinkOpen={handleLinkOpen as never}
          validateEmbeddable={validateEmbeddable}
          viewModeEnabled={readOnly}
          initialData={{
            elements: (initialElements ?? []) as never,
            scrollToContent: true,
          }}
          theme="light"
        />
      </React.Suspense>
    </>
  );
});

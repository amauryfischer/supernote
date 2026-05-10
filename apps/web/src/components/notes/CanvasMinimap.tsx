"use client";

/**
 * CanvasMinimap — small SVG preview of a note's canvas content.
 *
 * Renders only when the note has real canvas data (excalidrawElements or
 * legacy nodes with coordinates). Clicking navigates to the canvas view.
 * Memoized so it never re-renders unless the raw canvas string changes.
 */

import { useMemo, memo } from "react";
import Link from "next/link";

// -----------------------------------------------------------------------
// Types for the subset of canvas data we care about
// -----------------------------------------------------------------------

interface ExcalidrawLike {
  id: string;
  type: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: Array<[number, number]>;
  isDeleted?: boolean;
}

interface CanvasLike {
  nodes?: Array<{ x?: number; y?: number; width?: number; height?: number }>;
  edges?: unknown[];
  excalidrawElements?: ExcalidrawLike[];
}

// -----------------------------------------------------------------------
// Pure helpers
// -----------------------------------------------------------------------

/** Parse the raw canvas field and return a typed object or null on failure. */
function parseCanvasRaw(raw: unknown): CanvasLike | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as CanvasLike;
  } catch {
    return null;
  }
}

/** Return true only when the canvas has content beyond the seed element. */
export function hasCanvasContent(raw: unknown): boolean {
  const doc = parseCanvasRaw(raw);
  if (!doc) return false;

  const ex = Array.isArray(doc.excalidrawElements) ? doc.excalidrawElements : [];
  // Seed elements added on first-open carry an "entity-seed-" prefix and are
  // not persisted — so a canvas with only those elements is effectively empty.
  const nonSeedEx = ex.filter(
    (e) => !e.id.startsWith("entity-seed-") && e.isDeleted !== true,
  );
  if (nonSeedEx.length > 0) return true;

  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  return nodes.length > 0;
}

// Bounding box of all renderable elements
interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function computeBBox(doc: CanvasLike): BBox | null {
  const elements: Array<{ x: number; y: number; w: number; h: number }> = [];

  const ex = Array.isArray(doc.excalidrawElements) ? doc.excalidrawElements : [];
  for (const el of ex) {
    if (el.isDeleted === true) continue;
    if (el.id.startsWith("entity-seed-")) continue;
    // For linear elements (arrows/lines) use the points array if present
    if (Array.isArray(el.points) && el.points.length > 0) {
      const baseX = typeof el.x === "number" ? el.x : 0;
      const baseY = typeof el.y === "number" ? el.y : 0;
      for (const [px, py] of el.points) {
        elements.push({ x: baseX + px, y: baseY + py, w: 1, h: 1 });
      }
    } else {
      const x = typeof el.x === "number" ? el.x : 0;
      const y = typeof el.y === "number" ? el.y : 0;
      const w = typeof el.width === "number" ? el.width : 40;
      const h = typeof el.height === "number" ? el.height : 20;
      elements.push({ x, y, w, h });
    }
  }

  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  for (const n of nodes) {
    const x = typeof n.x === "number" ? n.x : 0;
    const y = typeof n.y === "number" ? n.y : 0;
    const w = typeof n.width === "number" ? n.width : 120;
    const h = typeof n.height === "number" ? n.height : 60;
    elements.push({ x, y, w, h });
  }

  if (elements.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { x, y, w, h } of elements) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  }

  return { minX, minY, maxX, maxY };
}

const MINIMAP_W = 280; // px width of the minimap strip
const MINIMAP_H = 48;  // px height of the minimap strip
const PADDING = 6;     // canvas padding inside the viewbox

/** Build SVG rects and lines from the canvas document. */
function buildSvgShapes(doc: CanvasLike, bbox: BBox): React.ReactNode[] {
  const rangeX = Math.max(bbox.maxX - bbox.minX, 1);
  const rangeY = Math.max(bbox.maxY - bbox.minY, 1);
  const innerW = MINIMAP_W - PADDING * 2;
  const innerH = MINIMAP_H - PADDING * 2;

  const toSvgX = (x: number) => PADDING + ((x - bbox.minX) / rangeX) * innerW;
  const toSvgY = (y: number) => PADDING + ((y - bbox.minY) / rangeY) * innerH;
  const scaleW = (w: number) => Math.max(2, (w / rangeX) * innerW);
  const scaleH = (h: number) => Math.max(1, (h / rangeY) * innerH);

  const shapes: React.ReactNode[] = [];

  const ex = Array.isArray(doc.excalidrawElements) ? doc.excalidrawElements : [];
  for (const el of ex) {
    if (el.isDeleted === true) continue;
    if (el.id.startsWith("entity-seed-")) continue;

    if (el.type === "text" || el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") {
      const x = typeof el.x === "number" ? el.x : 0;
      const y = typeof el.y === "number" ? el.y : 0;
      const w = typeof el.width === "number" ? el.width : 40;
      const h = typeof el.height === "number" ? el.height : 20;
      shapes.push(
        <rect
          key={el.id}
          x={toSvgX(x)}
          y={toSvgY(y)}
          width={scaleW(w)}
          height={scaleH(h)}
          rx={el.type === "ellipse" ? scaleW(w) / 2 : 2}
          fill="var(--accent-subtle, #ede9fe)"
          stroke="var(--accent, #7c3aed)"
          strokeWidth={0.5}
          opacity={0.8}
        />,
      );
    } else if (el.type === "arrow" || el.type === "line") {
      if (Array.isArray(el.points) && el.points.length >= 2) {
        const baseX = typeof el.x === "number" ? el.x : 0;
        const baseY = typeof el.y === "number" ? el.y : 0;
        const pts = el.points
          .map(([px, py]: [number, number]) => `${toSvgX(baseX + px)},${toSvgY(baseY + py)}`)
          .join(" ");
        shapes.push(
          <polyline
            key={el.id}
            points={pts}
            fill="none"
            stroke="var(--text-muted, #888)"
            strokeWidth={0.7}
            opacity={0.7}
          />,
        );
      }
    }
  }

  // Legacy typed nodes
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [];
  nodes.forEach((n, i) => {
    const x = typeof n.x === "number" ? n.x : 0;
    const y = typeof n.y === "number" ? n.y : 0;
    const w = typeof n.width === "number" ? n.width : 120;
    const h = typeof n.height === "number" ? n.height : 60;
    shapes.push(
      <rect
        key={`node-${i}`}
        x={toSvgX(x)}
        y={toSvgY(y)}
        width={scaleW(w)}
        height={scaleH(h)}
        rx={2}
        fill="var(--surface-3, #f3f0ff)"
        stroke="var(--border, #ddd)"
        strokeWidth={0.5}
        opacity={0.85}
      />,
    );
  });

  return shapes;
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

interface CanvasMinimapProps {
  canvasRaw: unknown;
  canvasHref: string;
}

export const CanvasMinimap = memo(function CanvasMinimap({
  canvasRaw,
  canvasHref,
}: CanvasMinimapProps) {
  const svgContent = useMemo(() => {
    const doc = parseCanvasRaw(canvasRaw);
    if (!doc) return null;
    const bbox = computeBBox(doc);
    if (!bbox) return null;
    const shapes = buildSvgShapes(doc, bbox);
    if (shapes.length === 0) return null;
    return shapes;
  }, [canvasRaw]);

  if (!svgContent) return null;

  return (
    <Link
      href={canvasHref}
      aria-label="Ouvrir le canvas"
      onClick={(e) => e.stopPropagation()}
      className="mt-2 block overflow-hidden rounded-md border transition-colors hover:border-[var(--accent)]"
      style={{
        borderColor: "var(--border-subtle)",
        backgroundColor: "var(--surface-1)",
      }}
    >
      <svg
        width={MINIMAP_W}
        height={MINIMAP_H}
        viewBox={`0 0 ${MINIMAP_W} ${MINIMAP_H}`}
        xmlns="http://www.w3.org/2000/svg"
        style={{ display: "block", width: "100%", height: MINIMAP_H }}
      >
        {svgContent}
      </svg>
    </Link>
  );
});

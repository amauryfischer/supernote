"use client";

import { CanvasCard } from "./CanvasCard";
import type { CanvasMeta } from "./fixtures";

interface CanvasGridProps {
  canvases: CanvasMeta[];
  onOpen: (id: string) => void;
}

export function CanvasGrid({ canvases, onOpen }: CanvasGridProps) {
  if (canvases.length === 0) {
    return (
      <div
        className="flex h-64 flex-col items-center justify-center gap-2"
        style={{ color: "var(--text-muted)" }}
      >
        <p className="text-sm">Aucun canvas trouvé</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-6"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
      }}
    >
      {canvases.map((canvas) => (
        <CanvasCard key={canvas.id} canvas={canvas} onClick={onOpen} />
      ))}
    </div>
  );
}

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, SquaresFour } from "@phosphor-icons/react";
import { AppShell } from "@/components/shell";
import { CanvasGrid, CANVAS_LIST } from "@/components/canvas-page";
import type { CanvasMeta } from "@/components/canvas-page";
import { EmptyState, SkeletonCard } from "@supernote/ui";

export default function CanvasListPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [canvases, setCanvases] = useState<CanvasMeta[]>(CANVAS_LIST);

  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 250);
    return () => clearTimeout(t);
  }, []);

  function handleOpen(id: string) {
    router.push(`/canvas/${id}`);
  }

  function handleNewCanvas() {
    const newCanvas: CanvasMeta = {
      id: `c-${Date.now()}`,
      title: "Nouveau canvas",
      updatedAt: new Date().toISOString(),
      nodeCount: 0,
      edgeCount: 0,
      tags: [],
    };
    setCanvases((prev) => [newCanvas, ...prev]);
    router.push(`/canvas/${newCanvas.id}`);
  }

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Page header */}
        <div
          className="flex shrink-0 items-center justify-between border-b px-6 py-3"
          style={{
            borderColor: "var(--border-subtle)",
            backgroundColor: "var(--surface-0)",
          }}
        >
          <div className="flex items-center gap-3">
            <SquaresFour size={18} style={{ color: "var(--accent)" }} />
            <h1 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
              Canvas
            </h1>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: "var(--surface-3)",
                color: "var(--text-muted)",
              }}
            >
              {canvases.length}
            </span>
          </div>

          <button
            onClick={handleNewCanvas}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
            style={{
              backgroundColor: "var(--accent)",
              color: "var(--accent-foreground)",
            }}
          >
            <Plus size={13} />
            Nouveau canvas
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="grid gap-4 p-6" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
              {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : canvases.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={<SquaresFour size={28} />}
                title="Aucun canvas"
                description="Créez un canvas pour visualiser et connecter vos idées librement."
                action={{ label: "+ Nouveau canvas", onClick: handleNewCanvas }}
              />
            </div>
          ) : (
            <CanvasGrid canvases={canvases} onOpen={handleOpen} />
          )}
        </div>
      </div>
    </AppShell>
  );
}

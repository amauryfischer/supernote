"use client";

/**
 * /canvas — gallery of every NOTE that has a non-empty canvas view.
 *
 * Architectural shift: canvas is no longer a standalone entity type.
 * It's the spatial *view* of a note, persisted on `note.fields.canvas`.
 * This page surfaces the subset of notes that have actually been laid
 * out on a canvas, so the user can jump back into them at a glance.
 *
 * Each row deep-links into `/notes/{id}?view=canvas` so the toggle in
 * the note detail page opens straight onto the canvas.
 */

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { SquaresFour } from "@phosphor-icons/react";
import { AppShell, useMobileTitle } from "@/components/shell";
import { useIsMobile } from "@/hooks/useIsMobile";
import { CanvasGrid } from "@/components/canvas-page";
import type { CanvasMeta } from "@/components/canvas-page";
import { EmptyState, SkeletonCard } from "@supernote/ui";
import { trpc } from "@/lib/trpc/client";

interface NoteEntityRow {
  id: string;
  typeId: string;
  fields?: Record<string, unknown>;
  updatedAt?: string;
  filePath?: string;
}

/**
 * Heuristic: a note has a "canvas" only if `fields.canvas` parses to a
 * CanvasDocument with at least one node. We treat the auto-generated
 * default doc (a single block holding the note body) the same as a real
 * canvas — once the user toggles to canvas mode and we serialize
 * something, the note belongs in this gallery.
 *
 * Returns `null` when the note shouldn't appear here.
 */
function canvasMetaFromNote(row: NoteEntityRow): CanvasMeta | null {
  const fields = row.fields ?? {};
  const raw = fields["canvas"];
  if (typeof raw !== "string" || raw.length === 0) return null;
  let nodeCount = 0;
  let edgeCount = 0;
  try {
    const parsed = JSON.parse(raw) as { nodes?: unknown[]; edges?: unknown[] };
    nodeCount = Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
    edgeCount = Array.isArray(parsed.edges) ? parsed.edges.length : 0;
  } catch {
    return null;
  }
  if (nodeCount === 0) return null;

  const titleField = fields["title"];
  const title =
    (typeof titleField === "string" && titleField.length > 0
      ? titleField
      : row.filePath?.split("/").pop()?.replace(/\.md$/, "")) ?? "Sans titre";

  return {
    id: row.id,
    title,
    updatedAt: row.updatedAt ?? new Date().toISOString(),
    nodeCount,
    edgeCount,
    tags: [],
  };
}

export default function CanvasListPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

  // List notes — we filter client-side to those that have a non-empty
  // canvas payload. 500 is the same cap the notes list uses.
  const listQuery = trpc.entities.list.useQuery(
    { typeId: "note", limit: 500 },
    { retry: false },
  );

  const canvases: CanvasMeta[] = useMemo(() => {
    const items = (listQuery.data?.items ?? []) as NoteEntityRow[];
    return items
      .map(canvasMetaFromNote)
      .filter((c): c is CanvasMeta => c !== null);
  }, [listQuery.data]);

  const isLoading = listQuery.isLoading;

  // Open a note's canvas view directly — preserves the URL contract that
  // the note detail page expects (`?view=canvas`).
  const handleOpen = useCallback(
    (id: string) => {
      router.push(`/notes/${id}?view=canvas`);
    },
    [router],
  );

  // Creating a "new canvas" doesn't make sense as a top-level action
  // anymore — the canvas only exists alongside a note. We send the user
  // to the notes list so they can pick / create a note and toggle its
  // canvas view.
  const handleNewCanvas = useCallback(() => {
    router.push("/notes");
  }, [router]);

  // Mobile chrome — publish the page title to the top bar
  useMobileTitle(isMobile ? "Canvas" : null, isMobile ? `${canvases.length}` : null);

  return (
    <AppShell>
      <div className="flex h-full flex-col">
        {/* Page header — hidden on mobile (title lives in the top bar) */}
        <div
          className="hidden shrink-0 items-center justify-between border-b px-6 py-3 md:flex"
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
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="grid gap-4 p-3 md:p-6" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
              {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : canvases.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState
                icon={<SquaresFour size={28} />}
                title="Aucun canvas"
                description="Ouvrez une note et basculez sur la vue Canvas pour la disposer spatialement."
                action={{ label: "Voir mes notes", onClick: handleNewCanvas }}
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

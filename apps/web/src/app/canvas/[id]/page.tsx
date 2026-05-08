"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AppShell } from "@/components/shell";
import { useShellChrome } from "@/components/shell/shell-chrome-context";
import { CanvasEditorToolbar } from "@/components/canvas-page";
import { trpc } from "@/lib/trpc/client";
import type { EntityRef } from "@supernote/canvas";
import type { CanvasDocument } from "@supernote/canvas";

// Dynamic import — Excalidraw is browser-only
const SupernoteCanvas = dynamic(
  () => import("@supernote/canvas").then((m) => m.SupernoteCanvas),
  { ssr: false, loading: () => <CanvasLoadingSpinner /> }
);

// Mock entity fixtures for the resolver
const MOCK_ENTITIES: EntityRef[] = [
  {
    id: "entity-1",
    typeId: "contact",
    typeName: "Contact",
    typeIcon: "User",
    typeColor: "#6366F1",
    name: "Pierre Martin",
    fields: { email: "p.martin@example.com", company: "CapitalNord" },
  },
  {
    id: "entity-2",
    typeId: "organisation",
    typeName: "Organisation",
    typeIcon: "Buildings",
    typeColor: "#0EA5E9",
    name: "Numerisk",
    fields: { sector: "Tech", employees: 12 },
  },
  {
    id: "entity-3",
    typeId: "projet",
    typeName: "Projet",
    typeIcon: "Rocket",
    typeColor: "#F59E0B",
    name: "Supernote PKM",
    fields: { status: "En cours", deadline: "2026-12-31" },
  },
];

async function mockResolveEntity(id: string): Promise<EntityRef | null> {
  return MOCK_ENTITIES.find((e) => e.id === id) ?? null;
}

const EMPTY_DOC: CanvasDocument = { nodes: [], edges: [] };

/**
 * Parse the persisted `fields.data` string into a CanvasDocument.
 * Returns a defensive empty doc on missing/invalid input so a corrupt
 * payload never blocks the editor from mounting.
 */
function parseCanvasData(raw: unknown): CanvasDocument {
  if (typeof raw !== "string" || raw.length === 0) return EMPTY_DOC;
  try {
    const parsed = JSON.parse(raw) as Partial<CanvasDocument>;
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
      ...(parsed.metadata ? { metadata: parsed.metadata } : {}),
    };
  } catch {
    return EMPTY_DOC;
  }
}

function FullscreenCanvasEditor() {
  const params = useParams();
  const router = useRouter();
  const { setFocusMode } = useShellChrome();
  const id = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");

  const utils = trpc.useUtils();
  const entityQuery = trpc.entities.get.useQuery(
    { id },
    { enabled: !!id, retry: false, staleTime: Infinity },
  );

  const updateMutation = trpc.entities.update.useMutation();

  // Local title mirrors `fields.name`; we only push it back to the worker
  // on blur / save (debounced through the same path as the document).
  const initialTitle = useMemo(() => {
    const fields = (entityQuery.data as { fields?: Record<string, unknown> } | undefined)?.fields;
    return (typeof fields?.["name"] === "string" ? (fields["name"] as string) : "") || "Nouveau canvas";
  }, [entityQuery.data]);

  const [title, setTitle] = useState(initialTitle);
  const titleSyncedRef = useRef(false);
  // Sync title from server only on first successful load, so user edits
  // while typing are not clobbered by a background refetch.
  useEffect(() => {
    if (!titleSyncedRef.current && entityQuery.data) {
      setTitle(initialTitle);
      titleSyncedRef.current = true;
    }
  }, [entityQuery.data, initialTitle]);

  const initialDoc = useMemo<CanvasDocument>(() => {
    const fields = (entityQuery.data as { fields?: Record<string, unknown> } | undefined)?.fields;
    return parseCanvasData(fields?.["data"]);
  }, [entityQuery.data]);

  const [fullscreen, setFullscreen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSerializedRef = useRef<string>("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDocRef = useRef<CanvasDocument | null>(null);
  const pendingTitleRef = useRef<string | null>(null);

  // Enter focus mode when fullscreen
  useEffect(() => {
    setFocusMode(fullscreen);
    return () => setFocusMode(false);
  }, [fullscreen, setFocusMode]);

  const flushSave = useCallback(async () => {
    if (!id) return;
    const doc = pendingDocRef.current;
    const titleToSave = pendingTitleRef.current;
    if (!doc && !titleToSave) return;

    const fieldsUpdate: Record<string, string | number | boolean | string[] | null> = {};
    if (doc) {
      const serialized = JSON.stringify(doc);
      if (serialized === lastSerializedRef.current) {
        // No-op
      } else {
        fieldsUpdate["data"] = serialized;
        lastSerializedRef.current = serialized;
      }
    }
    if (titleToSave !== null) {
      fieldsUpdate["name"] = titleToSave;
    }
    pendingDocRef.current = null;
    pendingTitleRef.current = null;

    if (Object.keys(fieldsUpdate).length === 0) return;

    setSaveStatus("saving");
    try {
      await updateMutation.mutateAsync({ id, fields: fieldsUpdate });
      setSaveStatus("saved");
      // Refresh the cached query so we don't read stale `fields.data` on
      // a remount, but do not invalidate the list (would refetch on every
      // keystroke).
      void utils.entities.get.invalidate({ id });
    } catch (err) {
      console.error("[canvas] save failed", err);
      setSaveStatus("error");
    }
  }, [id, updateMutation, utils]);

  const scheduleSave = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    // 1s debounce: Excalidraw can fire onChange ~60×/sec while dragging.
    debounceTimerRef.current = setTimeout(() => {
      void flushSave();
    }, 1000);
  }, [flushSave]);

  const handleDocChange = useCallback(
    (doc: CanvasDocument) => {
      pendingDocRef.current = doc;
      // Show "Saving…" pre-emptively so the user gets feedback even before
      // the debounce fires; it flips to "Saved" once the mutation resolves.
      setSaveStatus((prev) => (prev === "saving" ? prev : "saving"));
      scheduleSave();
    },
    [scheduleSave],
  );

  const handleTitleChange = useCallback(
    (next: string) => {
      setTitle(next);
      pendingTitleRef.current = next;
      setSaveStatus("saving");
      scheduleSave();
    },
    [scheduleSave],
  );

  // Flush on unmount / navigation so the very last change is never lost.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      void flushSave();
    };
  }, [flushSave]);

  // Flush before the tab closes / reloads.
  useEffect(() => {
    function onBeforeUnload() {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        void flushSave();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [flushSave]);

  const handleToggleFullscreen = useCallback(() => {
    setFullscreen((v) => !v);
  }, []);

  const handleBack = useCallback(() => {
    router.push("/canvas");
  }, [router]);

  const handleSave = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    void flushSave();
  }, [flushSave]);

  const handleExportPng = useCallback(() => {
    console.log("[Canvas] Export PNG — not yet implemented");
  }, []);

  const handleShare = useCallback(() => {
    const url = `${window.location.origin}/canvas/${id}`;
    void navigator.clipboard.writeText(url);
  }, [id]);

  // While the entity is loading we still mount the toolbar so the user
  // sees the page chrome immediately. The canvas is mounted only once
  // we have its initial document, otherwise the SupernoteCanvas store
  // would freeze the empty doc and override real content on first edit.
  const ready = !!entityQuery.data && !entityQuery.isLoading;

  if (entityQuery.isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Canvas introuvable.
          </p>
          <button
            onClick={handleBack}
            className="mt-2 text-sm underline"
            style={{ color: "var(--accent)" }}
          >
            Retour aux canvas
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <CanvasEditorToolbar
        title={title}
        fullscreen={fullscreen}
        onBack={handleBack}
        onTitleChange={handleTitleChange}
        onExportPng={handleExportPng}
        onShare={handleShare}
        onSave={handleSave}
        onToggleFullscreen={handleToggleFullscreen}
      />

      <div className="relative flex-1 overflow-hidden">
        {/* Save indicator — top-left, above the canvas */}
        <div
          className="pointer-events-none absolute left-3 top-3 z-10 rounded-md px-2 py-1 text-xs"
          style={{
            backgroundColor: "var(--surface-1, rgba(255,255,255,0.85))",
            color: "var(--text-muted)",
            opacity: saveStatus === "idle" ? 0 : 1,
            transition: "opacity 200ms",
          }}
        >
          {saveStatus === "saving" && "Enregistrement…"}
          {saveStatus === "saved" && "Enregistré"}
          {saveStatus === "error" && "Erreur d'enregistrement"}
        </div>

        {ready ? (
          <SupernoteCanvas
            initialData={initialDoc}
            onChange={handleDocChange}
            onSave={() => handleSave()}
            resolveEntity={mockResolveEntity}
            readOnly={false}
          />
        ) : (
          <CanvasLoadingSpinner />
        )}
      </div>
    </div>
  );
}

function CanvasLoadingSpinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
        style={{ borderColor: "var(--accent)" }}
      />
    </div>
  );
}

export default function CanvasEditorPage() {
  return (
    <AppShell>
      <FullscreenCanvasEditor />
    </AppShell>
  );
}

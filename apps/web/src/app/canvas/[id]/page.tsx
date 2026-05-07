"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { AppShell } from "@/components/shell";
import { useShellChrome } from "@/components/shell/shell-chrome-context";
import { CanvasEditorToolbar } from "@/components/canvas-page";
import {
  FIXTURE_CANVAS_DOCUMENT,
  getCanvasById,
} from "@/components/canvas-page";
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

function FullscreenCanvasEditor() {
  const params = useParams();
  const router = useRouter();
  const { setFocusMode } = useShellChrome();
  const id = typeof params.id === "string" ? params.id : (params.id?.[0] ?? "");

  const meta = getCanvasById(id);
  const [title, setTitle] = useState(meta?.title ?? "Nouveau canvas");
  const [fullscreen, setFullscreen] = useState(false);
  const [doc, setDoc] = useState<CanvasDocument>(FIXTURE_CANVAS_DOCUMENT);

  // Enter focus mode when fullscreen
  useEffect(() => {
    setFocusMode(fullscreen);
    return () => setFocusMode(false);
  }, [fullscreen, setFocusMode]);

  const handleToggleFullscreen = useCallback(() => {
    setFullscreen((v) => !v);
  }, []);

  const handleBack = useCallback(() => {
    router.push("/canvas");
  }, [router]);

  const handleSave = useCallback(() => {
    console.log("[Canvas] Saving:", { id, title, doc });
  }, [id, title, doc]);

  const handleExportPng = useCallback(() => {
    console.log("[Canvas] Export PNG — not yet implemented");
  }, []);

  const handleShare = useCallback(() => {
    const url = `${window.location.origin}/canvas/${id}`;
    void navigator.clipboard.writeText(url);
  }, [id]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <CanvasEditorToolbar
        title={title}
        fullscreen={fullscreen}
        onBack={handleBack}
        onTitleChange={setTitle}
        onExportPng={handleExportPng}
        onShare={handleShare}
        onSave={handleSave}
        onToggleFullscreen={handleToggleFullscreen}
      />

      <div className="relative flex-1 overflow-hidden">
        <SupernoteCanvas
          initialData={doc}
          onChange={setDoc}
          onSave={handleSave}
          resolveEntity={mockResolveEntity}
          readOnly={false}
        />
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


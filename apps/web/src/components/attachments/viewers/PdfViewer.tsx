"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Spinner } from "@heroui/react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import type { AttachmentViewerProps } from "../AttachmentRouter";
import { useAttachmentBlob } from "../useAttachmentBlob";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
const SCALE_STEP = 0.25;
const DEFAULT_SCALE = 1.0;

interface PageState {
  rendered: boolean;
  rendering: boolean;
}

export function PdfViewer({ path }: AttachmentViewerProps) {
  const { loading: blobLoading, error: blobError, bytes } = useAttachmentBlob(path);

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [pageInputValue, setPageInputValue] = useState("1");
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pageStates, setPageStates] = useState<PageState[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const renderTasksRef = useRef<(RenderTask | null)[]>([]);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);

  // Load PDF from bytes
  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    const data = new Uint8Array(bytes);

    setPdfError(null);
    setPdf(null);
    setNumPages(0);
    setCurrentPage(1);
    setPageInputValue("1");

    pdfjsLib.getDocument({ data }).promise.then((doc) => {
      if (cancelled) { doc.destroy(); return; }
      pdfRef.current = doc;
      setPdf(doc);
      setNumPages(doc.numPages);
      setPageStates(Array.from({ length: doc.numPages }, () => ({ rendered: false, rendering: false })));
      canvasRefs.current = new Array(doc.numPages).fill(null);
      renderTasksRef.current = new Array(doc.numPages).fill(null);
    }).catch((err: unknown) => {
      if (cancelled) return;
      setPdfError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      cancelled = true;
      renderTasksRef.current.forEach((task) => task?.cancel());
    };
  }, [bytes]);

  // Cancel all render tasks when pdf changes
  useEffect(() => {
    return () => {
      renderTasksRef.current.forEach((task) => task?.cancel());
    };
  }, [pdf]);

  const renderPage = useCallback(async (pageNum: number, doc: PDFDocumentProxy, currentScale: number) => {
    const canvas = canvasRefs.current[pageNum - 1];
    if (!canvas) return;

    setPageStates((prev) => {
      const next = [...prev];
      next[pageNum - 1] = { rendered: false, rendering: true };
      return next;
    });

    let page: PDFPageProxy | null = null;
    try {
      page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: currentScale });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      // Cancel previous task for this page
      renderTasksRef.current[pageNum - 1]?.cancel();
      const task = page.render({ canvas, viewport });
      renderTasksRef.current[pageNum - 1] = task;

      await task.promise;

      setPageStates((prev) => {
        const next = [...prev];
        next[pageNum - 1] = { rendered: true, rendering: false };
        return next;
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message !== "Rendering cancelled") {
        setPageStates((prev) => {
          const next = [...prev];
          next[pageNum - 1] = { rendered: false, rendering: false };
          return next;
        });
      }
    } finally {
      page?.cleanup();
    }
  }, []);

  // Render visible pages when pdf or scale changes
  useEffect(() => {
    if (!pdf) return;
    const doc = pdf;
    // Render all pages sequentially — scroll container shows them stacked
    for (let i = 1; i <= doc.numPages; i++) {
      void renderPage(i, doc, scale);
    }
  }, [pdf, scale, renderPage]);

  // Track current page from scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const canvases = canvasRefs.current;
      let closest = 1;
      let minDist = Infinity;
      canvases.forEach((canvas, idx) => {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const dist = Math.abs(rect.top - containerRect.top);
        if (dist < minDist) { minDist = dist; closest = idx + 1; }
      });
      setCurrentPage(closest);
      setPageInputValue(String(closest));
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [numPages]);

  const scrollToPage = useCallback((pageNum: number) => {
    const canvas = canvasRefs.current[pageNum - 1];
    canvas?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handlePageInputChange = (val: string) => {
    setPageInputValue(val);
    const n = parseInt(val, 10);
    if (!isNaN(n) && n >= 1 && n <= numPages) {
      setCurrentPage(n);
      scrollToPage(n);
    }
  };

  const handleDownload = () => {
    if (!bytes) return;
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = path.split("/").pop() ?? "document.pdf";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (blobLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  if (blobError ?? pdfError) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs" style={{ color: "var(--text-muted)" }}>
        {blobError ?? pdfError}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        <Button size="sm" variant="ghost" isDisabled={currentPage <= 1} onPress={() => { const p = currentPage - 1; setCurrentPage(p); setPageInputValue(String(p)); scrollToPage(p); }}>
          ‹
        </Button>
        <div className="flex items-center gap-1">
          <Input
            value={pageInputValue}
            onChange={(e) => handlePageInputChange(e.target.value)}
            className="w-14 text-center"
            aria-label="Page courante"
          />
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>/ {numPages}</span>
        </div>
        <Button size="sm" variant="ghost" isDisabled={currentPage >= numPages} onPress={() => { const p = currentPage + 1; setCurrentPage(p); setPageInputValue(String(p)); scrollToPage(p); }}>
          ›
        </Button>
        <div className="mx-2 h-4 w-px" style={{ background: "var(--border)" }} />
        <Button size="sm" variant="ghost" isDisabled={scale >= MAX_SCALE} onPress={() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP))}>
          +
        </Button>
        <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{Math.round(scale * 100)}%</span>
        <Button size="sm" variant="ghost" isDisabled={scale <= MIN_SCALE} onPress={() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP))}>
          −
        </Button>
        <Button size="sm" variant="ghost" onPress={() => setScale(DEFAULT_SCALE)}>
          Reset
        </Button>
        <div className="mx-2 h-4 w-px" style={{ background: "var(--border)" }} />
        <Button size="sm" variant="ghost" onPress={handleDownload}>
          Télécharger
        </Button>
      </div>

      {/* Pages */}
      <div ref={containerRef} className="flex-1 overflow-auto bg-gray-100 dark:bg-neutral-900">
        <div className="flex flex-col items-center gap-4 py-4">
          {Array.from({ length: numPages }, (_, i) => {
            const pageNum = i + 1;
            const state = pageStates[i] ?? { rendered: false, rendering: true };
            return (
              <div key={pageNum} className="relative shadow-md">
                {state.rendering && !state.rendered && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-neutral-800">
                    <Spinner size="sm" />
                  </div>
                )}
                <canvas
                  ref={(el) => { canvasRefs.current[pageNum - 1] = el; }}
                  style={{ display: "block", maxWidth: "100%" }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Spinner, TextArea } from "@heroui/react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { PDFDocument, rgb } from "pdf-lib";
import { ChatCircle, CursorClick, Highlighter } from "@phosphor-icons/react";
import type { AttachmentViewerProps } from "../AttachmentRouter";
import { useAttachmentBlob } from "../useAttachmentBlob";
import { useAttachmentSave } from "../useAttachmentSave";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const MIN_SCALE = 0.5;
const MAX_SCALE = 3.0;
const SCALE_STEP = 0.25;
const DEFAULT_SCALE = 1.0;

type AnnotationTool = "none" | "highlight" | "comment";

interface HighlightAnnotation {
  readonly type: "highlight";
  readonly page: number;
  /** PDF user-space coordinates (origin bottom-left). */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface CommentAnnotation {
  readonly type: "comment";
  readonly page: number;
  /** PDF user-space coordinates (origin bottom-left). */
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

type Annotation = HighlightAnnotation | CommentAnnotation;

interface PageState {
  rendered: boolean;
  rendering: boolean;
}

interface DragState {
  pageNum: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  active: boolean;
}

interface PendingComment {
  pageNum: number;
  /** Screen-space x within the overlay div. */
  screenX: number;
  /** Screen-space y within the overlay div. */
  screenY: number;
}

/** Convert screen-space y (top-down) to PDF user-space y (bottom-up). */
function toPdfY(screenY: number, canvasHeight: number, pdfPageHeight: number): number {
  return pdfPageHeight - (screenY * (pdfPageHeight / canvasHeight));
}

function toPdfX(screenX: number, canvasWidth: number, pdfPageWidth: number): number {
  return screenX * (pdfPageWidth / canvasWidth);
}

async function buildAnnotatedPdf(
  originalBytes: ArrayBuffer,
  annotations: Annotation[],
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalBytes);
  const pages = pdfDoc.getPages();

  for (const ann of annotations) {
    const page = pages[ann.page - 1];
    if (!page) continue;

    if (ann.type === "highlight") {
      page.drawRectangle({
        x: ann.x,
        y: ann.y,
        width: ann.w,
        height: ann.h,
        color: rgb(1, 0.95, 0),
        opacity: 0.4,
      });
    } else {
      const { width: pw, height: ph } = page.getSize();
      page.drawCircle({
        x: ann.x,
        y: ann.y,
        size: Math.min(pw, ph) * 0.02,
        color: rgb(0.2, 0.5, 1),
        opacity: 0.85,
      });
    }
  }

  return pdfDoc.save();
}

export function PdfViewer({ path }: AttachmentViewerProps) {
  const { loading: blobLoading, error: blobError, bytes } = useAttachmentBlob(path);
  const { enqueue } = useAttachmentSave(path);

  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [pageInputValue, setPageInputValue] = useState("1");
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [pageStates, setPageStates] = useState<PageState[]>([]);

  const [activeTool, setActiveTool] = useState<AnnotationTool>("none");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [pendingComment, setPendingComment] = useState<PendingComment | null>(null);
  const [commentText, setCommentText] = useState("");

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const renderTasksRef = useRef<(RenderTask | null)[]>([]);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const originalBytesRef = useRef<ArrayBuffer | null>(null);
  const annotationsRef = useRef<Annotation[]>([]);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  // Load PDF from bytes
  useEffect(() => {
    if (!bytes) return;
    let cancelled = false;
    const data = new Uint8Array(bytes);
    originalBytesRef.current = bytes;

    setPdfError(null);
    setPdf(null);
    setNumPages(0);
    setCurrentPage(1);
    setPageInputValue("1");
    setAnnotations([]);

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

  useEffect(() => {
    if (!pdf) return;
    const doc = pdf;
    for (let i = 1; i <= doc.numPages; i++) {
      void renderPage(i, doc, scale);
    }
  }, [pdf, scale, renderPage]);

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

  /** Rebuild the PDF with all annotations and enqueue a save. */
  const saveAnnotations = useCallback(async (nextAnnotations: Annotation[]) => {
    const origBytes = originalBytesRef.current;
    if (!origBytes) return;
    try {
      const uint8 = await buildAnnotatedPdf(origBytes, nextAnnotations);
      enqueue(uint8);
    } catch (err) {
      console.error("[PdfViewer] annotation save failed", err);
    }
  }, [enqueue]);

  /** Get coords within the canvas element from a mouse event on the overlay. */
  function getOverlayLocalCoords(
    e: React.MouseEvent,
    pageNum: number,
  ): { x: number; y: number } | null {
    const canvas = canvasRefs.current[pageNum - 1];
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  const handleOverlayMouseDown = (e: React.MouseEvent, pageNum: number) => {
    if (activeTool !== "highlight") return;
    e.preventDefault();
    const coords = getOverlayLocalCoords(e, pageNum);
    if (!coords) return;
    setDragState({
      pageNum,
      startX: coords.x, startY: coords.y,
      currentX: coords.x, currentY: coords.y,
      active: true,
    });
  };

  const handleContainerMouseMove = (e: React.MouseEvent) => {
    if (!dragState?.active) return;
    const coords = getOverlayLocalCoords(e, dragState.pageNum);
    if (!coords) return;
    setDragState((prev) => prev ? { ...prev, currentX: coords.x, currentY: coords.y } : prev);
  };

  const handleContainerMouseUp = useCallback(async (e: React.MouseEvent) => {
    if (!dragState?.active) return;
    e.preventDefault();

    const canvas = canvasRefs.current[dragState.pageNum - 1];
    if (!canvas) { setDragState(null); return; }

    const { startX, startY, currentX, currentY, pageNum } = dragState;
    const minX = Math.min(startX, currentX);
    const minY = Math.min(startY, currentY);
    const w = Math.abs(currentX - startX);
    const h = Math.abs(currentY - startY);

    if (w < 4 || h < 4) { setDragState(null); return; }

    const doc = pdfRef.current;
    if (!doc) { setDragState(null); return; }

    const pdfPage = await doc.getPage(pageNum);
    const viewport = pdfPage.getViewport({ scale: 1 });
    pdfPage.cleanup();

    // Convert to PDF user-space (bottom-left origin)
    const pdfX = toPdfX(minX, canvas.width, viewport.width);
    const pdfH = h * (viewport.height / canvas.height);
    // Bottom edge of the rectangle in PDF space
    const pdfY = toPdfY(minY + h, canvas.height, viewport.height);
    const pdfW = w * (viewport.width / canvas.width);

    const newAnn: HighlightAnnotation = {
      type: "highlight", page: pageNum,
      x: pdfX, y: pdfY, w: pdfW, h: pdfH,
    };
    const nextAnnotations = [...annotationsRef.current, newAnn];
    setAnnotations(nextAnnotations);
    setDragState(null);
    await saveAnnotations(nextAnnotations);
  }, [dragState, saveAnnotations]);

  const handleOverlayClick = useCallback((e: React.MouseEvent, pageNum: number) => {
    if (activeTool !== "comment") return;
    e.preventDefault();
    const coords = getOverlayLocalCoords(e, pageNum);
    if (!coords) return;
    setPendingComment({ pageNum, screenX: coords.x, screenY: coords.y });
    setCommentText("");
  }, [activeTool]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmComment = useCallback(async () => {
    if (!pendingComment || !commentText.trim()) { setPendingComment(null); return; }
    const canvas = canvasRefs.current[pendingComment.pageNum - 1];
    if (!canvas) { setPendingComment(null); return; }

    const doc = pdfRef.current;
    if (!doc) { setPendingComment(null); return; }

    const pdfPage = await doc.getPage(pendingComment.pageNum);
    const viewport = pdfPage.getViewport({ scale: 1 });
    pdfPage.cleanup();

    const pdfX = toPdfX(pendingComment.screenX, canvas.width, viewport.width);
    const pdfY = toPdfY(pendingComment.screenY, canvas.height, viewport.height);

    const newAnn: CommentAnnotation = {
      type: "comment",
      page: pendingComment.pageNum,
      x: pdfX, y: pdfY,
      text: commentText.trim(),
    };
    const nextAnnotations = [...annotationsRef.current, newAnn];
    setAnnotations(nextAnnotations);
    setPendingComment(null);
    setCommentText("");
    await saveAnnotations(nextAnnotations);
  }, [pendingComment, commentText, saveAnnotations]);

  /** Live drag preview rect style. */
  function getDragPreviewStyle(pageNum: number): React.CSSProperties | null {
    if (!dragState?.active || dragState.pageNum !== pageNum) return null;
    const { startX, startY, currentX, currentY } = dragState;
    return {
      position: "absolute",
      left: Math.min(startX, currentX),
      top: Math.min(startY, currentY),
      width: Math.abs(currentX - startX),
      height: Math.abs(currentY - startY),
      background: "rgba(255, 240, 0, 0.35)",
      border: "1px dashed rgba(180, 150, 0, 0.7)",
      pointerEvents: "none",
    };
  }

  /** Convert PDF user-space back to screen coords using canvas dimensions. */
  function pdfToScreen(
    pdfX: number,
    pdfY: number,
    canvas: HTMLCanvasElement,
  ): { screenX: number; screenY: number } {
    const naturalW = canvas.width / scale;
    const naturalH = canvas.height / scale;
    return {
      screenX: pdfX * (canvas.width / naturalW),
      screenY: canvas.height - pdfY * (canvas.height / naturalH),
    };
  }

  function renderAnnotationsForPage(pageNum: number, canvas: HTMLCanvasElement | null): React.ReactNode {
    if (!canvas) return null;
    const naturalW = canvas.width / scale;
    const naturalH = canvas.height / scale;
    const scaleW = canvas.width / naturalW;
    const scaleH = canvas.height / naturalH;

    return annotations
      .filter((a) => a.page === pageNum)
      .map((a, idx) => {
        if (a.type === "highlight") {
          const { screenX, screenY } = pdfToScreen(a.x, a.y + a.h, canvas);
          return (
            <div
              key={`h-${idx}`}
              style={{
                position: "absolute",
                left: screenX,
                top: screenY,
                width: a.w * scaleW,
                height: a.h * scaleH,
                background: "rgba(255, 240, 0, 0.35)",
                pointerEvents: "none",
              }}
            />
          );
        } else {
          const { screenX, screenY } = pdfToScreen(a.x, a.y, canvas);
          return (
            <div
              key={`c-${idx}`}
              title={a.text}
              style={{
                position: "absolute",
                left: screenX - 8,
                top: screenY - 8,
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "rgba(51, 127, 255, 0.85)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                color: "white",
                fontWeight: "bold",
              }}
            >
              {idx + 1}
            </div>
          );
        }
      });
  }

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

  const cursorStyle = activeTool === "highlight" ? "crosshair" : activeTool === "comment" ? "cell" : "default";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2" style={{ borderColor: "var(--border)" }}>
        {/* Navigation */}
        <Button
          size="sm" variant="ghost"
          isDisabled={currentPage <= 1}
          onPress={() => { const p = currentPage - 1; setCurrentPage(p); setPageInputValue(String(p)); scrollToPage(p); }}
        >
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
        <Button
          size="sm" variant="ghost"
          isDisabled={currentPage >= numPages}
          onPress={() => { const p = currentPage + 1; setCurrentPage(p); setPageInputValue(String(p)); scrollToPage(p); }}
        >
          ›
        </Button>

        <div className="mx-2 h-4 w-px" style={{ background: "var(--border)" }} />

        {/* Zoom */}
        <Button size="sm" variant="ghost" isDisabled={scale >= MAX_SCALE} onPress={() => setScale((s) => Math.min(MAX_SCALE, s + SCALE_STEP))}>+</Button>
        <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>{Math.round(scale * 100)}%</span>
        <Button size="sm" variant="ghost" isDisabled={scale <= MIN_SCALE} onPress={() => setScale((s) => Math.max(MIN_SCALE, s - SCALE_STEP))}>−</Button>
        <Button size="sm" variant="ghost" onPress={() => setScale(DEFAULT_SCALE)}>Reset</Button>

        <div className="mx-2 h-4 w-px" style={{ background: "var(--border)" }} />

        {/* Annotation tool buttons */}
        <Button
          size="sm"
          variant={activeTool === "none" ? "outline" : "ghost"}
          isIconOnly
          aria-label="Sélectionner"
          onPress={() => setActiveTool("none")}
        >
          <CursorClick size={16} />
        </Button>
        <Button
          size="sm"
          variant={activeTool === "highlight" ? "outline" : "ghost"}
          isIconOnly
          aria-label="Surligner"
          onPress={() => setActiveTool("highlight")}
        >
          <Highlighter size={16} />
        </Button>
        <Button
          size="sm"
          variant={activeTool === "comment" ? "outline" : "ghost"}
          isIconOnly
          aria-label="Commenter"
          onPress={() => setActiveTool("comment")}
        >
          <ChatCircle size={16} />
        </Button>

        <div className="mx-2 h-4 w-px" style={{ background: "var(--border)" }} />
        <Button size="sm" variant="ghost" onPress={handleDownload}>Télécharger</Button>
      </div>

      {/* Pages scroll area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-100 dark:bg-neutral-900"
        onMouseMove={handleContainerMouseMove}
        onMouseUp={(e) => { void handleContainerMouseUp(e); }}
      >
        <div className="flex flex-col items-center gap-4 py-4">
          {Array.from({ length: numPages }, (_, i) => {
            const pageNum = i + 1;
            const state = pageStates[i] ?? { rendered: false, rendering: true };
            const canvas = canvasRefs.current[pageNum - 1] ?? null;
            const dragPreview = getDragPreviewStyle(pageNum);
            const showCommentPopover = pendingComment?.pageNum === pageNum;

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

                {/* Annotation interaction overlay */}
                <div
                  style={{ position: "absolute", inset: 0, cursor: cursorStyle, userSelect: "none" }}
                  onMouseDown={(e) => handleOverlayMouseDown(e, pageNum)}
                  onClick={(e) => { void handleOverlayClick(e, pageNum); }}
                >
                  {/* Existing annotation markers */}
                  {renderAnnotationsForPage(pageNum, canvas)}

                  {/* Drag preview rect */}
                  {dragPreview && <div style={dragPreview} />}

                  {/* Comment input popover (custom positioned) */}
                  {showCommentPopover && pendingComment && (
                    <div
                      style={{
                        position: "absolute",
                        left: Math.min(pendingComment.screenX + 8, (canvas?.width ?? 400) - 240),
                        top: pendingComment.screenY + 8,
                        width: 232,
                        background: "var(--surface-1, #fff)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
                        padding: 8,
                        zIndex: 10,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <TextArea
                        autoFocus
                        placeholder="Votre commentaire…"
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        rows={3}
                        aria-label="Commentaire"
                        onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { void confirmComment(); }
                          if (e.key === "Escape") { setPendingComment(null); }
                        }}
                        style={{ width: "100%", marginBottom: 6 }}
                      />
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                        <Button size="sm" variant="ghost" onPress={() => setPendingComment(null)}>Annuler</Button>
                        <Button size="sm" variant="primary" onPress={() => { void confirmComment(); }}>Enregistrer</Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

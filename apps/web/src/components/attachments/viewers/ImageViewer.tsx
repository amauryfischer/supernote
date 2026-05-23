"use client";

import { useCallback, useRef, useState } from "react";
import { Button, Spinner } from "@heroui/react";
import {
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  ArrowsIn,
  DownloadSimple,
} from "@phosphor-icons/react";

import type { AttachmentViewerProps } from "../AttachmentRouter";
import { useAttachmentBlob } from "../useAttachmentBlob";

const ZOOM_MIN = 1.0;
const ZOOM_MAX = 4.0;
const ZOOM_STEP = 1.25;

interface PanState {
  dragging: boolean;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
}

export function ImageViewer({ path }: AttachmentViewerProps) {
  const { loading, error, objectUrl } = useAttachmentBlob(path);
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<PanState | null>(null);

  const basename = path.split("/").pop() ?? path;

  const clampZoom = (v: number) =>
    Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));

  const zoomIn = () =>
    setZoom((z) => clampZoom(z * ZOOM_STEP));

  const zoomOut = () =>
    setZoom((z) => {
      const next = clampZoom(z / ZOOM_STEP);
      if (next <= ZOOM_MIN) setPan({ x: 0, y: 0 });
      return next;
    });

  const reset = () => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
  };

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => {
      const next = clampZoom(e.deltaY < 0 ? z * ZOOM_STEP : z / ZOOM_STEP);
      if (next <= ZOOM_MIN) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (zoom <= 1) return;
      e.preventDefault();
      dragRef.current = {
        dragging: true,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: pan.x,
        offsetY: pan.y,
      };
    },
    [zoom, pan],
  );

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d?.dragging) return;
    setPan({
      x: d.offsetX + (e.clientX - d.startX),
      y: d.offsetY + (e.clientY - d.startY),
    });
  }, []);

  const stopDrag = useCallback(() => {
    if (dragRef.current) dragRef.current.dragging = false;
  }, []);

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        Erreur lors du chargement : {error}
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div
        className="flex h-full w-full items-center justify-center text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        Aucun contenu disponible.
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-black">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-white/10 bg-black/80 px-2 py-1">
        <Button isIconOnly size="sm" variant="ghost" onPress={zoomIn} aria-label="Zoom avant">
          <MagnifyingGlassPlus size={16} weight="bold" />
        </Button>
        <Button isIconOnly size="sm" variant="ghost" onPress={zoomOut} aria-label="Zoom arrière">
          <MagnifyingGlassMinus size={16} weight="bold" />
        </Button>
        <Button isIconOnly size="sm" variant="ghost" onPress={reset} aria-label="Réinitialiser le zoom">
          <ArrowsIn size={16} weight="bold" />
        </Button>
        <span className="px-1 text-xs text-white/50">{Math.round(zoom * 100)}%</span>
        <div className="flex-1" />
        <a href={objectUrl} download={basename} tabIndex={-1}>
          <Button isIconOnly size="sm" variant="ghost" aria-label="Télécharger">
            <DownloadSimple size={16} weight="bold" />
          </Button>
        </a>
      </div>

      {/* Image canvas */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden"
        style={{ cursor: zoom > 1 ? "grab" : "default" }}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
      >
        <img
          src={objectUrl}
          alt={basename}
          draggable={false}
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transformOrigin: "center center",
            maxWidth: "100%",
            maxHeight: "100%",
            objectFit: "contain",
            userSelect: "none",
            transition: dragRef.current?.dragging ? "none" : "transform 0.15s ease",
          }}
        />
      </div>
    </div>
  );
}

"use client";

/**
 * PresentationMode — superpose la note en diapositives plein écran. Découpe sur
 * les H1 / séparateurs, navigation clavier (←/→/espace/Échap), barre de
 * progression, et notes du présentateur masquables (touche `n`).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CaretLeft, CaretRight, X, NotePencil } from "@phosphor-icons/react";
import { Button } from "@heroui/react";
import { splitSlides } from "@/lib/present/slides";
import { SlideContent } from "./SlideContent";

export function PresentationMode({
  markdown,
  title,
  onClose,
}: {
  markdown: string;
  title: string;
  onClose: () => void;
}): React.JSX.Element {
  const slides = useMemo(() => splitSlides(markdown), [markdown]);
  const [idx, setIdx] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const count = slides.length;

  const go = useCallback(
    (delta: number) => setIdx((i) => Math.min(count - 1, Math.max(0, i + delta))),
    [count],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); go(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); go(-1); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "Home") setIdx(0);
      else if (e.key === "End") setIdx(count - 1);
      else if (e.key.toLowerCase() === "n") setShowNotes((s) => !s);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose, count]);

  const slide = slides[idx] ?? { content: "", notes: "" };

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex flex-col"
      style={{ background: "var(--surface-0)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`Présentation : ${title}`}
    >
      {/* Barre de progression */}
      <div className="h-1 w-full" style={{ background: "var(--surface-2)" }}>
        <div
          className="h-full transition-all duration-300"
          style={{ width: `${((idx + 1) / count) * 100}%`, background: "var(--accent)" }}
        />
      </div>

      {/* Diapo (zone cliquable : avance au clic) */}
      <div
        className="flex flex-1 cursor-pointer items-center justify-center overflow-y-auto px-[8vw] py-[6vh]"
        onClick={(e) => {
          // Clic à gauche = reculer, à droite = avancer.
          const x = e.clientX / window.innerWidth;
          go(x < 0.25 ? -1 : 1);
        }}
      >
        <div className="mx-auto w-full max-w-4xl">
          <SlideContent markdown={slide.content} />
        </div>
      </div>

      {/* Notes présentateur */}
      {showNotes && slide.notes && (
        <div
          className="max-h-[22vh] overflow-y-auto px-[8vw] py-3 text-sm"
          style={{ borderTop: "1px solid var(--border-subtle)", background: "var(--surface-1)", color: "var(--text-secondary)" }}
        >
          <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            Notes
          </span>
          {slide.notes}
        </div>
      )}

      {/* Contrôles */}
      <div
        className="flex items-center justify-between px-6 py-2"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {title}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" isIconOnly aria-label="Diapo précédente" onPress={() => go(-1)} isDisabled={idx === 0}>
            <CaretLeft size={16} />
          </Button>
          <span className="text-xs tabular-nums" style={{ color: "var(--text-secondary)" }}>
            {idx + 1} / {count}
          </span>
          <Button variant="ghost" size="sm" isIconOnly aria-label="Diapo suivante" onPress={() => go(1)} isDisabled={idx === count - 1}>
            <CaretRight size={16} />
          </Button>
          <Button
            variant={showNotes ? "primary" : "ghost"}
            size="sm"
            isIconOnly
            aria-label="Notes du présentateur (n)"
            onPress={() => setShowNotes((s) => !s)}
          >
            <NotePencil size={16} />
          </Button>
          <Button variant="ghost" size="sm" isIconOnly aria-label="Quitter (Échap)" onPress={onClose}>
            <X size={16} />
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

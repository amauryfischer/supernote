"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";

interface NoteMinimapProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Mobile : surimpression qui n'apparaît qu'au défilement, pour ne pas manger la largeur du texte. */
  overlay?: boolean;
}

const MOBILE_HIDE_DELAY_MS = 1200;
const PREF_KEY = "supernote.minimap";
const LABEL_PX: Record<string, number> = { H1: 11, H2: 10, H3: 9 };

export function useMinimapPref(): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(PREF_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggle = () => {
    try {
      localStorage.setItem(PREF_KEY, on ? "0" : "1");
    } catch {}
    setOn(!on);
  };
  return [on, toggle];
}

// Canvas plutôt que clone DOM : un double du texte casserait les getByText des e2e et rechargerait les iframes.
export function NoteMinimap({ scrollRef, overlay = false }: NoteMinimapProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(0);
  const dragRef = useRef<number | null>(null);
  const hideTimerRef = useRef(0);
  const [overflows, setOverflows] = useState(false);

  const updateViewport = useCallback(() => {
    const c = scrollRef.current;
    const vp = viewportRef.current;
    if (!c || !vp) return;
    const s = scaleRef.current;
    vp.style.transform = `translateY(${c.scrollTop * s}px)`;
    vp.style.height = `${Math.max(8, c.clientHeight * s)}px`;
  }, [scrollRef]);

  const paint = useCallback(() => {
    const c = scrollRef.current;
    const canvas = canvasRef.current;
    if (!c || !canvas) return;
    setOverflows(c.scrollHeight > c.clientHeight + 1);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || width === 0 || height === 0) return;

    const sx = width / c.clientWidth;
    const sy = Math.min(sx, height / c.scrollHeight);
    scaleRef.current = sy;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const box = c.getBoundingClientRect();
    const originY = box.top - c.scrollTop;
    const toX = (x: number) => (x - box.left) * sx;
    const midY = (r: DOMRect) => (r.top + r.height / 2 - originY) * sy;
    const labels: { text: string; x: number; y: number; px: number; color: string; family: string }[] = [];
    const seenHeadings = new Set<Element>();
    const styles = new Map<Element, CSSStyleDeclaration>();
    const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    ctx.textBaseline = "middle";
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? "";
      const el = node.parentElement;
      if (!el || !text.trim()) continue;
      let cs = styles.get(el);
      if (!cs) {
        cs = getComputedStyle(el);
        styles.set(el, cs);
      }
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
      const first = rects[0];
      if (!first) continue;
      const heading = el.closest("h1, h2, h3");
      if (heading) {
        if (seenHeadings.has(heading)) continue;
        seenHeadings.add(heading);
        const px = LABEL_PX[heading.tagName] ?? 8;
        labels.push({ text: heading.textContent?.trim() ?? text, x: toX(first.left), y: midY(first), px, color: cs.color, family: cs.fontFamily });
        continue;
      }
      ctx.fillStyle = cs.color;
      ctx.globalAlpha = 0.6;
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${parseFloat(cs.fontSize) * sx}px ${cs.fontFamily}`;
      // Le découpage du texte par ligne n'est pas exposé : on le répartit au prorata de la largeur de chaque ligne.
      const total = rects.reduce((sum, r) => sum + r.width, 0);
      let start = 0;
      for (const r of rects) {
        const end = start + Math.round((text.length * r.width) / total);
        ctx.fillText(text.slice(start, end), toX(r.left), midY(r), r.width * sx);
        start = end;
      }
    }

    // Titres lisibles par-dessus le texte miniature ; un titre qui chevaucherait le précédent est sauté.
    ctx.globalAlpha = 1;
    let floor = -Infinity;
    for (const l of labels) {
      const top = l.y - l.px / 2 - 1;
      if (top < floor) continue;
      ctx.font = `600 ${l.px}px ${l.family}`;
      ctx.clearRect(l.x - 2, top, Math.min(width, ctx.measureText(l.text).width + 4), l.px + 2);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, l.x, l.y);
      floor = top + l.px + 2;
    }
    updateViewport();
  }, [scrollRef, updateViewport]);

  const reveal = useCallback(() => {
    const root = rootRef.current;
    if (!overlay || !root) return;
    root.style.opacity = "1";
    root.style.pointerEvents = "auto";
    window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      if (dragRef.current !== null) return;
      root.style.opacity = "0";
      root.style.pointerEvents = "none";
    }, MOBILE_HIDE_DELAY_MS);
  }, [overlay]);

  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    // Throttle et pas debounce : pendant une frappe continue, la carte doit suivre.
    let timer = 0;
    const schedule = () => {
      if (!timer) timer = window.setTimeout(() => { timer = 0; paint(); }, 200);
    };
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateViewport);
      reveal();
    };
    const mo = new MutationObserver(schedule);
    mo.observe(c, { childList: true, characterData: true, subtree: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(c);
    if (c.firstElementChild) ro.observe(c.firstElementChild);
    if (rootRef.current) ro.observe(rootRef.current);
    c.addEventListener("scroll", onScroll, { passive: true });
    paint();
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(hideTimerRef.current);
      cancelAnimationFrame(frame);
      mo.disconnect();
      ro.disconnect();
      c.removeEventListener("scroll", onScroll);
    };
  }, [scrollRef, paint, updateViewport, reveal]);

  const scrollToPointer = (e: PointerEvent<HTMLDivElement>, grab: number) => {
    const c = scrollRef.current;
    const s = scaleRef.current;
    if (!c || s === 0) return;
    c.scrollTop = (e.clientY - e.currentTarget.getBoundingClientRect().top - grab) / s;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const c = scrollRef.current;
    if (!c) return;
    const s = scaleRef.current;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const top = c.scrollTop * s;
    const height = c.clientHeight * s;
    // Saisir la fenêtre la fait glisser sans saut ; cliquer ailleurs centre la vue sur le point.
    const grab = y >= top && y <= top + height ? y - top : height / 2;
    dragRef.current = grab;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrollToPointer(e, grab);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current !== null) scrollToPointer(e, dragRef.current);
  };

  const endDrag = () => {
    dragRef.current = null;
    reveal();
  };

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={[
        "sn-no-print cursor-pointer touch-none select-none",
        overflows ? "" : "hidden",
        overlay ? "sn-motion-glide absolute inset-y-0 right-0 z-10 w-16 shadow-lg" : "relative w-32 shrink-0",
      ].join(" ")}
      style={{
        borderLeft: "1px solid var(--border-subtle)",
        backgroundColor: overlay ? "var(--surface-1)" : undefined,
        opacity: overlay ? 0 : undefined,
        pointerEvents: overlay ? "none" : undefined,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={(e) => {
        if (scrollRef.current) scrollRef.current.scrollTop += e.deltaY;
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div
        ref={viewportRef}
        className="absolute inset-x-0 top-0"
        style={{
          background: "color-mix(in srgb, var(--accent) 10%, transparent)",
          borderBlock: "1px solid color-mix(in srgb, var(--accent) 25%, transparent)",
        }}
      />
    </div>
  );
}

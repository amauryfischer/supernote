"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { NO_FIND, type FindState } from "./NoteFind";

interface NoteMinimapProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Mobile : surimpression qui n'apparaît qu'au défilement, pour ne pas manger la largeur du texte. */
  overlay?: boolean;
  /** Résultats de la recherche dans la note, tracés en traits pleine largeur. */
  find?: FindState;
}

const MOBILE_HIDE_DELAY_MS = 1200;
const PREF_KEY = "supernote.minimap";
const LABEL_PX: Record<string, number> = { H1: 11, H2: 10, H3: 9 };
const PILL_PX = 9;
const PILL_PAD = 3;

type TagKind = "todo" | "bug" | "idea" | "question" | "done";

const TAG_KINDS: Record<string, TagKind> = {
  TODO: "todo", AFAIRE: "todo",
  FIXME: "bug", BUG: "bug", URGENT: "bug",
  IDEE: "idea", IDEA: "idea", NOTE: "idea",
  QUESTION: "question",
  DONE: "done", FAIT: "done",
};

// Jeton texte brut non converti en tag inline. Le garde-fou de gauche écarte « C# », les ancres d'URL et les « &#… » ;
// un jeton sans lettre (« #1 », « #2024 ») est un numéro, pas un tag (filtré au point d'usage).
const RAW_TAG_RE = /(?<![\p{L}\p{N}_/&=:#-])#([\p{L}\p{N}_-]+)/gu;

// Même table que tag.ts (paquet editor) : il n'exporte pas son helper.
function tagKind(path: string): TagKind | undefined {
  const head = path.split("/")[0] ?? "";
  return TAG_KINDS[head.normalize("NFD").replace(/\p{M}/gu, "").replace(/[-_\s]/g, "").toUpperCase()];
}

interface TagMark {
  label: string;
  kind: TagKind | undefined;
  x: number;
  y: number;
}

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
export function NoteMinimap({ scrollRef, overlay = false, find = NO_FIND }: NoteMinimapProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const findCanvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const findRef = useRef(find);
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

  // Traits de la recherche : un canvas à part, redessiné sans repasser tout le texte à chaque Entrée.
  const drawFind = useCallback(() => {
    const c = scrollRef.current;
    const canvas = findCanvasRef.current;
    const root = rootRef.current;
    if (!c || !canvas || !root) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx || width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { ranges, current } = findRef.current;
    if (ranges.length === 0) return;
    const cs = getComputedStyle(root);
    const accent = cs.getPropertyValue("--accent").trim();
    const halo = cs.getPropertyValue("--surface-1").trim();
    const originY = c.getBoundingClientRect().top - c.scrollTop;
    const ys = ranges.map((r) => {
      const b = r.getBoundingClientRect();
      return (b.top + b.height / 2 - originY) * scaleRef.current;
    });
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.85;
    ys.forEach((y, i) => {
      if (i !== current) ctx.fillRect(0, y - 1, width, 3);
    });
    const y = ys[current];
    if (y !== undefined) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = halo;
      ctx.fillRect(0, y - 4, width, 8);
      ctx.fillStyle = accent;
      ctx.fillRect(0, y - 2.5, width, 5);
    }
  }, [scrollRef]);

  const updateCursor = useCallback(() => {
    const c = scrollRef.current;
    const el = cursorRef.current;
    if (!c || !el) return;
    const sel = document.getSelection();
    const node = sel?.focusNode;
    // Hors de l'éditeur (barre de recherche, autre champ) : on garde le dernier repère plutôt que de le faire clignoter.
    if (!sel || !node || !c.querySelector(".ProseMirror")?.contains(node)) return;
    const range = document.createRange();
    range.setStart(node, sel.focusOffset);
    range.collapse(true);
    // Une ligne vide n'a pas de rectangle de texte : on retombe sur celui de son bloc.
    let r: DOMRect | undefined = range.getClientRects()[0];
    if (!r) r = (node instanceof Element ? node : node.parentElement)?.getBoundingClientRect();
    if (!r) {
      el.style.display = "none";
      return;
    }
    const y = (r.top + r.height / 2 - (c.getBoundingClientRect().top - c.scrollTop)) * scaleRef.current;
    el.style.display = "block";
    el.style.transform = `translateY(${y - 1}px)`;
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
    const tags: TagMark[] = [];
    const seenHeadings = new Set<Element>();
    const seenPills = new Set<Element>();
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
      // Tag inline : une pastille, jamais du texte miniature.
      const pill = el.closest(".sn-tag");
      if (pill) {
        if (!seenPills.has(pill)) {
          seenPills.add(pill);
          const path = pill.getAttribute("data-tag-path") ?? text.replace(/^#/, "");
          tags.push({ label: `#${path}`, kind: tagKind(path), x: toX(first.left), y: midY(first) });
        }
        continue;
      }
      const heading = el.closest("h1, h2, h3");
      if (heading) {
        if (seenHeadings.has(heading)) continue;
        seenHeadings.add(heading);
        const px = LABEL_PX[heading.tagName] ?? 8;
        labels.push({ text: heading.textContent?.trim() ?? text, x: toX(first.left), y: midY(first), px, color: cs.color, family: cs.fontFamily });
        continue;
      }
      for (const m of text.matchAll(RAW_TAG_RE)) {
        if (!/\p{L}/u.test(m[1]!)) continue;
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const r = range.getClientRects()[0];
        if (r) tags.push({ label: m[0], kind: tagKind(m[1]!), x: toX(r.left), y: midY(r) });
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

    // Tags par-dessus : pastille colorée + libellé, sautée si elle chevauche la précédente (comme les titres).
    const palette = getComputedStyle(rootRef.current ?? c);
    const token = (name: string) => palette.getPropertyValue(name).trim();
    ctx.font = `700 ${PILL_PX}px ${palette.fontFamily}`;
    const pillH = PILL_PX + 4;
    let pillFloor = -Infinity;
    for (const t of tags) {
      const top = t.y - pillH / 2;
      if (top < pillFloor) continue;
      let label = t.label;
      let w = ctx.measureText(label).width + PILL_PAD * 2;
      while (w > width - 2 && label.length > 2) {
        label = `${label.slice(0, -2)}…`;
        w = ctx.measureText(label).width + PILL_PAD * 2;
      }
      const x = Math.min(Math.max(1, t.x), Math.max(1, width - w - 1));
      const fg = t.kind ? token(`--sn-tag-${t.kind}-fg`) : token("--text-primary");
      ctx.clearRect(x, top, w, pillH);
      ctx.beginPath();
      ctx.roundRect(x, top, w, pillH, 3);
      ctx.fillStyle = t.kind ? token(`--sn-tag-${t.kind}-bg`) : token("--surface-2");
      ctx.fill();
      ctx.strokeStyle = t.kind ? fg : token("--accent");
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = fg;
      ctx.fillText(label, x + PILL_PAD, t.y);
      pillFloor = top + pillH + 1;
    }

    // Case non cochée : point ambre sur le bord gauche.
    ctx.fillStyle = token("--sn-tag-todo-fg");
    for (const box of c.querySelectorAll<HTMLInputElement>('[data-content-type="checkListItem"] input[type="checkbox"]')) {
      if (box.checked) continue;
      ctx.beginPath();
      ctx.arc(4, midY(box.getBoundingClientRect()), 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    updateViewport();
    drawFind();
    updateCursor();
  }, [scrollRef, updateViewport, drawFind, updateCursor]);

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
    findRef.current = find;
    drawFind();
    if (find.ranges.length > 0) reveal();
  }, [find, drawFind, reveal]);

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
    // Le curseur bouge sans mutation du DOM : événement dédié, une frame d'écart au plus.
    let cursorFrame = 0;
    const onSelection = () => {
      cancelAnimationFrame(cursorFrame);
      cursorFrame = requestAnimationFrame(updateCursor);
    };
    document.addEventListener("selectionchange", onSelection);
    paint();
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(hideTimerRef.current);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(cursorFrame);
      document.removeEventListener("selectionchange", onSelection);
      mo.disconnect();
      ro.disconnect();
      c.removeEventListener("scroll", onScroll);
    };
  }, [scrollRef, paint, updateViewport, updateCursor, reveal]);

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
      <canvas ref={findCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div
        ref={cursorRef}
        className="pointer-events-none absolute inset-x-0 top-0 hidden h-0.5"
        style={{ backgroundColor: "var(--accent)" }}
      />
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

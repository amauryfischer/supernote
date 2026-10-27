"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { NO_FIND, type FindState } from "./NoteFind";
import { TAG_COLORS_EVENT } from "./useTagColors";

interface NoteMinimapProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Mobile : surimpression qui n'apparaît qu'au défilement, pour ne pas manger la largeur du texte. */
  overlay?: boolean;
  /** Desktop étroit : bande fixe de 20 px, tags en pastilles rondes, sans texte. */
  rail?: boolean;
  /** Résultats de la recherche dans la note, tracés en traits pleine largeur. */
  find?: FindState;
  /** Clic droit sur la pastille d'un tag inline. */
  onTagContextMenu?: (path: string, rect: DOMRect) => void;
}

const MOBILE_HIDE_DELAY_MS = 1200;
const PREF_KEY = "supernote.minimap";
const LABEL_PX: Record<string, number> = { H1: 11, H2: 10, H3: 9 };
const PILL_PX = 9;
const PILL_PAD = 3;

export type TagKind = "todo" | "bug" | "urgent" | "idea" | "question" | "done";

const TAG_KINDS: Record<string, TagKind> = {
  TODO: "todo", AFAIRE: "todo",
  FIXME: "bug", BUG: "bug",
  URGENT: "urgent",
  IDEE: "idea", IDEA: "idea", NOTE: "idea",
  QUESTION: "question",
  DONE: "done", FAIT: "done",
};

// Jeton texte brut non converti en tag inline. Le garde-fou de gauche écarte « C# », les ancres d'URL et les « &#… » ;
// un jeton sans lettre (« #1 », « #2024 ») est un numéro, pas un tag (filtré au point d'usage).
const RAW_TAG_RE = /(?<![\p{L}\p{N}_/&=:#-])#([\p{L}\p{N}_-]+)/gu;

// Même table que tag.ts (paquet editor) : il n'exporte pas son helper.
export function tagKind(path: string): TagKind | undefined {
  const head = path.split("/")[0] ?? "";
  return TAG_KINDS[head.normalize("NFD").replace(/\p{M}/gu, "").replace(/[-_\s]/g, "").toUpperCase()];
}

interface TagMark {
  label: string;
  kind: TagKind | undefined;
  y: number;
  /** Seulement pour une pastille de l'éditeur ; un « #tag » resté en texte n'a pas de ligne `tag` à recolorer. */
  path?: string;
  /** Couleur choisie par l'utilisateur, lue sur la pastille (useTagColors). */
  fg?: string;
  bg?: string;
}

/** Tronque avec « … » pour tenir dans `max` px ; vide si même une lettre ne tient pas. */
function fitText(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  for (let n = text.length - 1; n > 0; n--) {
    const t = `${text.slice(0, n).trimEnd()}…`;
    if (ctx.measureText(t).width <= max) return t;
  }
  return "";
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

const railRadius = (width: number) => Math.min(5, width / 2 - 1.5);

// Canvas plutôt que clone DOM : un double du texte casserait les getByText des e2e et rechargerait les iframes.
export function NoteMinimap({ scrollRef, overlay = false, rail = false, find = NO_FIND, onTagContextMenu }: NoteMinimapProps) {
  const compact = overlay || rail;
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const findCanvasRef = useRef<HTMLCanvasElement>(null);
  const pillColRef = useRef(0);
  const hitsRef = useRef<{ path: string; x: number; y: number; w: number; h: number }[]>([]);
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
    // Teintes du surlignage, vives et opaques ; dans le rail, sur leur propre bande pour ne pas se confondre avec le #TODO.
    const cs = getComputedStyle(root);
    const originY = c.getBoundingClientRect().top - c.scrollTop;
    const ys = ranges.map((r) => {
      const b = r.getBoundingClientRect();
      return (b.top + b.height / 2 - originY) * scaleRef.current;
    });
    // Arrêtés avant la colonne des pastilles (dans le rail : une encoche à gauche, les pastilles sont à droite) : un trait en travers d'un tag le rendait illisible.
    const w = compact ? Math.min(6, Math.max(2, width - 2 * railRadius(width) - 2)) : width - pillColRef.current;
    ctx.fillStyle = cs.getPropertyValue("--sn-find-mark").trim();
    ys.forEach((y, i) => {
      if (i !== current) ctx.fillRect(0, y - 1.5, w, 3);
    });
    const y = ys[current];
    if (y !== undefined) {
      ctx.fillStyle = cs.getPropertyValue("--sn-find-current-mark").trim();
      ctx.fillRect(0, y - 2.5, compact ? w + 2 : w, 5);
    }
  }, [scrollRef, compact]);

  const updateCursor = useCallback(() => {
    const c = scrollRef.current;
    const el = cursorRef.current;
    if (!c || !el) return;
    // Dans le rail, la bande du viewport suffit : un trait de curseur s'y lisait comme un tag sans couleur.
    if (compact) {
      el.style.display = "none";
      return;
    }
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
  }, [scrollRef, compact]);

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
    // Le rail n'a que 12 px de large : borné par la largeur, il tasserait toute la note dans son premier centimètre.
    const sy = compact ? height / c.scrollHeight : Math.min(sx, height / c.scrollHeight);
    scaleRef.current = sy;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const box = c.getBoundingClientRect();
    const originY = box.top - c.scrollTop;
    const midY = (r: DOMRect) => (r.top + r.height / 2 - originY) * sy;
    // Abscisses brutes (px depuis le bord du scroller) : l'échelle horizontale dépend de la colonne des pastilles.
    const labels: { text: string; rx: number; y: number; px: number; color: string; family: string }[] = [];
    const runs: { rx: number; rw: number; y: number; cs: CSSStyleDeclaration }[] = [];
    const tags: TagMark[] = [];
    const seenHeadings = new Set<Element>();
    const seenPills = new Set<Element>();
    const styles = new Map<Element, CSSStyleDeclaration>();
    const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let foldY: number | null = null;
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
      // Une section repliée garde ses tags dans la minimap, rapportés sur la ligne de son titre.
      const y: number | null = first ? midY(first) : foldY !== null && el.closest(".sn-fold-hidden") ? foldY : null;
      if (y === null) continue;
      if (first && el.closest(".sn-folded")) foldY = y;
      // Tag inline : une pastille, jamais du texte miniature.
      const pill = el.closest(".sn-tag");
      if (pill) {
        if (!seenPills.has(pill)) {
          seenPills.add(pill);
          const path = pill.getAttribute("data-tag-path") ?? text.replace(/^#/, "");
          const pcs = getComputedStyle(pill);
          const custom = pcs.getPropertyValue("--sn-tag-color").trim() !== "";
          tags.push({ label: `#${path}`, kind: tagKind(path), y, path, ...(custom && { fg: pcs.color, bg: pcs.backgroundColor }) });
        }
        continue;
      }
      if (!first) {
        for (const m of text.matchAll(RAW_TAG_RE)) if (/\p{L}/u.test(m[1]!)) tags.push({ label: m[0], kind: tagKind(m[1]!), y });
        continue;
      }
      const heading = el.closest("h1, h2, h3");
      if (heading) {
        if (compact || seenHeadings.has(heading)) continue;
        seenHeadings.add(heading);
        const px = LABEL_PX[heading.tagName] ?? 8;
        labels.push({ text: heading.textContent?.trim() ?? text, rx: first.left - box.left, y: midY(first), px, color: cs.color, family: cs.fontFamily });
        continue;
      }
      // Hors éditeur (cartes des Marges IA, rétroliens), un « #TAG » cité n'est pas un tag de la note.
      for (const m of el.closest(".ProseMirror") ? text.matchAll(RAW_TAG_RE) : []) {
        if (!/\p{L}/u.test(m[1]!)) continue;
        range.setStart(node, m.index);
        range.setEnd(node, m.index + m[0].length);
        const r = range.getClientRects()[0];
        if (r) tags.push({ label: m[0], kind: tagKind(m[1]!), y: midY(r) });
      }
      if (compact) continue;
      for (const r of rects) runs.push({ rx: r.left - box.left, rw: r.width, y: midY(r), cs });
    }

    const palette = getComputedStyle(rootRef.current ?? c);
    const token = (name: string) => palette.getPropertyValue(name).trim();

    const hits: typeof hitsRef.current = [];
    hitsRef.current = hits;
    // Rail : trop étroit pour du texte, chaque tag y devient une pastille ronde de sa couleur.
    if (compact) {
      const r = railRadius(width);
      // Deux tags d'une même ligne (ou d'une section repliée) s'empilent au lieu de se masquer.
      let below = -Infinity;
      for (const t of [...tags].sort((a, b) => a.y - b.y)) {
        const y = Math.max(t.y, below + 2 * r + 4);
        below = y;
        const cx = width - r - 1;
        ctx.beginPath();
        ctx.arc(cx, y, r, 0, Math.PI * 2);
        ctx.fillStyle = t.fg ?? (t.kind ? token(`--sn-tag-${t.kind}-fg`) : token("--accent"));
        ctx.fill();
        if (t.path) hits.push({ path: t.path, x: cx - r, y: y - r, w: 2 * r, h: 2 * r });
        // Liseré du fond : deux pastilles voisines restent deux pastilles, pas une grappe.
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = token("--surface-0") || "#fff";
        ctx.stroke();
        // #URGENT marqué d'un « ! » : à cette taille, son magenta et le rouge de #BUG se confondaient.
        if (t.kind === "urgent") {
          ctx.fillStyle = token("--surface-0") || "#fff";
          ctx.fillRect(cx - 0.75, y - r + 2, 1.5, r);
          ctx.fillRect(cx - 0.75, y + r - 2.5, 1.5, 1.5);
        }
      }
    }

    // Pastilles calées à droite sur la ligne de leur tag. Des tags trop proches pour deux pastilles en forment
    // une seule, « #A +n », sur la ligne du premier : décalée, une pastille désignait la mauvaise section.
    ctx.font = `700 ${PILL_PX}px ${palette.fontFamily}`;
    const pillH = PILL_PX + 4;
    const groups: { first: TagMark; count: number }[] = [];
    for (const t of compact ? [] : tags) {
      const last = groups[groups.length - 1];
      if (last && t.y - last.first.y < pillH + 1) last.count++;
      else groups.push({ first: t, count: 1 });
    }
    const pills = groups.map(({ first, count }) => {
      const more = count > 1 ? ` +${count - 1}` : "";
      let label = first.label;
      let w = ctx.measureText(label + more).width + PILL_PAD * 2;
      while (w > width - 4 && label.length > 2) {
        label = `${label.slice(0, -2)}…`;
        w = ctx.measureText(label + more).width + PILL_PAD * 2;
      }
      return { label: label + more, kind: first.kind, fg: first.fg, bg: first.bg, path: first.path, x: Math.max(1, width - w - 2), top: first.y - pillH / 2, w };
    });

    // Colonne réservée aux pastilles : la silhouette du texte est tassée à sa gauche, jamais dessous.
    const pillCol = pills.length > 0 ? Math.max(...pills.map((p) => p.w)) + 6 : 0;
    pillColRef.current = pillCol;
    const sxText = Math.max(width - pillCol, width / 2) / c.clientWidth;
    // Le corps en barres, pas en lettres : à cette échelle, du texte se lisait comme une bouillie rognée.
    ctx.globalAlpha = 0.22;
    for (const r of runs) {
      const h = Math.max(1, parseFloat(r.cs.fontSize) * sy * 0.6);
      ctx.fillStyle = r.cs.color;
      ctx.fillRect(r.rx * sxText, r.y - h / 2, r.rw * sxText, h);
    }
    ctx.globalAlpha = 1;

    // Titres lisibles par-dessus le texte miniature, arrêtés avant une pastille de la même ligne ; un titre
    // qui chevaucherait le précédent est sauté.
    let floor = -Infinity;
    for (const l of labels) {
      const top = l.y - l.px / 2 - 1;
      const bottom = top + l.px + 2;
      if (top < floor) continue;
      const x = l.rx * sxText;
      const limit = Math.min(width - 2, ...pills.filter((p) => p.top < bottom && p.top + pillH > top).map((p) => p.x - 6));
      ctx.font = `600 ${l.px}px ${l.family}`;
      const text = fitText(ctx, l.text, limit - x);
      if (!text) continue;
      ctx.clearRect(x - 2, top, ctx.measureText(text).width + 4, l.px + 2);
      ctx.fillStyle = l.color;
      ctx.fillText(text, x, l.y);
      floor = bottom;
    }

    ctx.font = `700 ${PILL_PX}px ${palette.fontFamily}`;
    for (const p of pills) {
      if (p.path) hits.push({ path: p.path, x: p.x, y: p.top, w: p.w, h: pillH });
      const fg = p.fg ?? (p.kind ? token(`--sn-tag-${p.kind}-fg`) : token("--text-primary"));
      ctx.clearRect(p.x, p.top, p.w, pillH);
      ctx.beginPath();
      ctx.roundRect(p.x + 0.5, p.top + 0.5, p.w - 1, pillH - 1, 3);
      ctx.fillStyle = p.bg ?? (p.kind ? token(`--sn-tag-${p.kind}-bg`) : token("--surface-2"));
      ctx.fill();
      ctx.strokeStyle = p.kind || p.fg ? fg : token("--accent");
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = fg;
      ctx.fillText(p.label, p.x + PILL_PAD, p.top + pillH / 2);
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
  }, [scrollRef, compact, updateViewport, drawFind, updateCursor]);

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
    window.addEventListener(TAG_COLORS_EVENT, schedule);
    paint();
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(hideTimerRef.current);
      cancelAnimationFrame(frame);
      cancelAnimationFrame(cursorFrame);
      document.removeEventListener("selectionchange", onSelection);
      window.removeEventListener(TAG_COLORS_EVENT, schedule);
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
    if (!c || e.button !== 0) return;
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
        overlay ? "sn-motion-glide absolute inset-y-0 right-0 z-10 w-3" : rail ? "relative w-5 shrink-0" : "relative w-40 shrink-0",
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
      onContextMenu={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - box.left;
        const y = e.clientY - box.top;
        const hit = hitsRef.current.find((h) => x >= h.x - 2 && x <= h.x + h.w + 2 && y >= h.y - 2 && y <= h.y + h.h + 2);
        if (!hit || !onTagContextMenu) return;
        e.preventDefault();
        onTagContextMenu(hit.path, new DOMRect(box.left + hit.x, box.top + hit.y, hit.w, hit.h));
      }}
      onWheel={(e) => {
        if (scrollRef.current) scrollRef.current.scrollTop += e.deltaY;
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <canvas ref={findCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      <div
        ref={cursorRef}
        // Encoche sur le bord gauche : en pleine largeur, elle barrait le titre de la ligne comme un texte rayé.
        className="pointer-events-none absolute left-0 top-0 hidden h-0.5 w-2 rounded-r-full"
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

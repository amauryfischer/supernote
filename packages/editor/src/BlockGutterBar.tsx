// Active-block gutter bar — an accent bar in the left margin that *glides*
// vertically (and morphs its height) from block to block as the selection
// moves, instead of teleporting. The ambient sibling of SmoothCaret: where
// the caret tracks the glyph, this tracks the whole block you're editing,
// giving a "you are here" affordance that follows the writing flow.
//
// Animation model: identical to SmoothCaret — a continuous, frame-rate
// independent rAF lerp (`cur += (target - cur) * (1 - e^(-dt/τ))`) that
// self-suspends once settled. τ is a touch slower than the caret (50ms vs
// 35ms): block-to-block moves are larger and rarer than keystrokes, so a
// heavier glide reads as deliberate while the caret stays snappy. We
// deliberately roll our own loop rather than reuse the app's
// `createSmoothScalar`, because that engine lives in apps/web and the editor
// package must stay self-contained (same reason SmoothCaret has its own loop).
//
// Unlike SmoothCaret this stays ENABLED on touch / coarse pointers: it tracks
// block boxes, not glyph rects, so it is immune to the IME/virtual-keyboard
// quirks that force the caret overlay to bail out — which also gives mobile a
// block-level focus affordance the caret can't provide.
//
// Reduced motion: the bar still shows (it's an affordance, not decoration) but
// snaps instantly with no rAF loop.

import { useEffect, useRef } from "react";

interface BlockGutterBarProps {
  /** The `.sn-editor-wrapper` element the overlay positions itself against. */
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}

interface BlockBox {
  /** Wrapper-relative coordinates of the active block's content box. */
  x: number;
  y: number;
  height: number;
}

/** Smoothing time constant — slightly slower than the caret's 35ms so the
 *  block bar feels deliberate while the caret stays vivid. */
const TAU_MS = 50;
/** Below this remaining delta (px) the bar snaps and the loop suspends. */
const SETTLE_EPSILON = 0.4;
/** Horizontal gap (px) between the block's text edge and the bar — sits the
 *  bar just inside the gutter, and tracks indentation when blocks are nested. */
const GUTTER_GAP = 14;

/**
 * Resolve the active block's content box relative to `wrapper`. Returns null
 * whenever there is no selection anchored inside a block in this editor (the
 * bar then hides). Works for both collapsed and range selections — any
 * selection still has an anchor block worth highlighting.
 */
function measureBlock(wrapper: HTMLElement): BlockBox | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const node = sel.anchorNode;
  if (!node || !wrapper.contains(node)) return null;
  const el = node instanceof Element ? node : node.parentElement;
  if (!el) return null;
  const block = el.closest(".bn-block-content");
  if (!(block instanceof HTMLElement) || !wrapper.contains(block)) return null;

  const r = block.getBoundingClientRect();
  if (r.height === 0) return null;
  const wRect = wrapper.getBoundingClientRect();
  return {
    x: Math.max(0, r.left - wRect.left - GUTTER_GAP),
    y: r.top - wRect.top,
    height: r.height,
  };
}

export function BlockGutterBar({ wrapperRef }: BlockGutterBarProps) {
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const bar = barRef.current;
    if (!wrapper || !bar) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let measureRaf: number | null = null;
    let loopRaf: number | null = null;
    let lastFrameTime = 0;
    let visible = false;
    let target: BlockBox | null = null;
    const cur = { x: 0, y: 0, h: 0 };

    const apply = () => {
      bar.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0)`;
      bar.style.height = `${cur.h}px`;
    };

    const hide = () => {
      target = null;
      if (loopRaf !== null) {
        cancelAnimationFrame(loopRaf);
        loopRaf = null;
      }
      if (!visible) return;
      visible = false;
      bar.style.opacity = "0";
    };

    // ── Animation loop (runs only while the bar is off-target) ────────────
    const loop = (t: number) => {
      loopRaf = null;
      if (!target || !visible) return;
      const dt = lastFrameTime ? Math.min(t - lastFrameTime, 50) : 16.7;
      lastFrameTime = t;
      const k = 1 - Math.exp(-dt / TAU_MS);
      cur.x += (target.x - cur.x) * k;
      cur.y += (target.y - cur.y) * k;
      cur.h += (target.height - cur.h) * k;
      const remaining = Math.max(
        Math.abs(target.x - cur.x),
        Math.abs(target.y - cur.y),
        Math.abs(target.height - cur.h),
      );
      if (remaining < SETTLE_EPSILON) {
        cur.x = target.x;
        cur.y = target.y;
        cur.h = target.height;
        apply();
        lastFrameTime = 0;
        return;
      }
      apply();
      loopRaf = requestAnimationFrame(loop);
    };

    const kickLoop = () => {
      if (loopRaf === null) {
        lastFrameTime = 0;
        loopRaf = requestAnimationFrame(loop);
      }
    };

    const update = () => {
      measureRaf = null;
      const pos = measureBlock(wrapper);
      if (!pos) {
        hide();
        return;
      }
      const wasVisible = visible;
      if (!wasVisible || reduced) {
        // (Re)appearing, or reduced-motion: land straight on the target —
        // no glide from a stale/zero position.
        cur.x = pos.x;
        cur.y = pos.y;
        cur.h = pos.height;
        apply();
        if (!wasVisible) {
          visible = true;
          bar.style.opacity = "1";
        }
        target = pos;
        return;
      }
      target = pos;
      kickLoop();
    };

    const schedule = () => {
      if (measureRaf !== null) return;
      measureRaf = requestAnimationFrame(update);
    };

    document.addEventListener("selectionchange", schedule);
    window.addEventListener("resize", schedule);
    schedule();

    return () => {
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("resize", schedule);
      if (measureRaf !== null) cancelAnimationFrame(measureRaf);
      if (loopRaf !== null) cancelAnimationFrame(loopRaf);
    };
  }, [wrapperRef]);

  return <div ref={barRef} className="sn-block-gutter-bar" aria-hidden="true" />;
}

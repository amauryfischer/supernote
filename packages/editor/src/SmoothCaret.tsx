// Smooth caret overlay — replaces the native text caret with an animated
// bar that *glides* between positions instead of teleporting (the "smooth
// typing" feel of Word / Cursor). The native caret is hidden through
// `[data-smooth-caret="on"]` (see editor.css) only while the overlay is
// active, so every bail-out path (IME, selection, unmeasurable caret)
// falls back to the real caret instead of leaving the user blind.
//
// Animation model: a continuous rAF loop applying time-based exponential
// smoothing (`cur += (target - cur) * (1 - e^(-dt/τ))`) — NOT CSS
// transitions. A CSS transition restarts its easing curve every time the
// target moves, so fast typing produced a jerky stop-start motion; the
// lerp loop keeps velocity continuous across keystrokes, which is exactly
// what makes Word's caret feel liquid. The loop self-suspends once the
// caret settles (sub-pixel delta) so an idle editor costs zero frames.
//
// Extras layered on top:
//   - Comet trail on fast jumps (clicking another paragraph, Enter).
//   - Typewriter scroll: typing near the container edges glides the
//     scroll position to keep the caret in a comfort zone.
//
// Deliberately disabled when:
//   - `prefers-reduced-motion: reduce` (vestibular safety)
//   - coarse pointers (mobile/tablet — virtual keyboards and IME move the
//     selection in ways the overlay can't track reliably)
//   - during IME composition (compositionstart → compositionend)

import { useEffect, useRef } from "react";

interface SmoothCaretProps {
  /** The `.sn-editor-wrapper` element the overlay positions itself against. */
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}

interface CaretPos {
  /** Wrapper-relative coordinates (used to place the overlay). */
  x: number;
  y: number;
  height: number;
  /** Viewport coordinates (used for typewriter-scroll math). */
  clientTop: number;
  clientBottom: number;
}

/** Smoothing time constant — the caret covers ~63% of the remaining
 *  distance every τ ms (≈95% in 3τ). 35ms ≈ Word's ~110ms glide. */
const TAU_MS = 35;
/** Below this remaining delta (px) the caret snaps and the loop suspends. */
const SETTLE_EPSILON = 0.4;
/** Distance below which a move is "typing" (no comet trail). */
const TRAIL_MIN_DISTANCE = 24;
/** Comfort margins for the typewriter scroll, in px from container edges. */
const SCROLL_MARGIN_BOTTOM = 72;
const SCROLL_MARGIN_TOP = 56;

/**
 * Resolve the caret's position relative to `wrapper`. Returns null whenever
 * the overlay should hide (no selection, range selection, caret outside the
 * editor, unmeasurable position).
 */
function measureCaret(wrapper: HTMLElement): CaretPos | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
  const node = sel.anchorNode;
  if (!node || !wrapper.contains(node)) return null;
  const el = node instanceof Element ? node : node.parentElement;
  if (!el || !el.closest('[contenteditable="true"]')) return null;

  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  let rect: DOMRect | undefined = range.getClientRects()[0];
  if (!rect || rect.height === 0) {
    // Empty line / fresh block — the range has no glyph to measure against.
    // Fall back to the closest element box + its computed line-height.
    const r = el.getBoundingClientRect();
    const lh = parseFloat(window.getComputedStyle(el).lineHeight);
    const height = Number.isFinite(lh) && lh > 0 ? lh : r.height;
    if (height === 0) return null;
    rect = new DOMRect(r.left, r.top, 0, height);
  }
  const wRect = wrapper.getBoundingClientRect();
  return {
    x: rect.left - wRect.left,
    y: rect.top - wRect.top,
    height: rect.height,
    clientTop: rect.top,
    clientBottom: rect.top + rect.height,
  };
}

/** Closest ancestor that actually scrolls vertically (the editor pane). */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p) {
    const overflowY = window.getComputedStyle(p).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return p;
    p = p.parentElement;
  }
  return null;
}

export function SmoothCaret({ wrapperRef }: SmoothCaretProps) {
  const caretRef = useRef<HTMLDivElement | null>(null);
  const blinkRef = useRef<HTMLDivElement | null>(null);
  const trailRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const caret = caretRef.current;
    const blink = blinkRef.current;
    const trail = trailRef.current;
    if (!wrapper || !caret || !blink || !trail) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;

    let measureRaf: number | null = null;
    let loopRaf: number | null = null;
    let lastFrameTime = 0;
    let visible = false;
    let composing = false;
    let target: CaretPos | null = null;
    const cur = { x: 0, y: 0, h: 0 };
    let scrollParent: HTMLElement | null | undefined; // undefined = unresolved

    const setNativeCaretHidden = (hidden: boolean) => {
      wrapper.dataset.smoothCaret = hidden ? "on" : "off";
    };

    const apply = () => {
      caret.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0)`;
      caret.style.height = `${cur.h}px`;
    };

    /** Solid while moving; the CSS blink resumes (from its solid first
     *  frame) once the caret settles. Inline `animation: none` toggling
     *  restarts the keyframes without any forced reflow. */
    const setMoving = (moving: boolean) => {
      blink.style.animation = moving ? "none" : "";
    };

    const hide = () => {
      target = null;
      if (loopRaf !== null) {
        cancelAnimationFrame(loopRaf);
        loopRaf = null;
      }
      if (!visible) return;
      visible = false;
      caret.style.opacity = "0";
      setNativeCaretHidden(false);
    };

    // ── Animation loop (runs only while the caret is off-target) ──────────
    const loop = (t: number) => {
      loopRaf = null;
      if (!target || !visible) return;
      const dt = lastFrameTime ? Math.min(t - lastFrameTime, 50) : 16.7;
      lastFrameTime = t;
      // Time-based exponential smoothing — frame-rate independent.
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
        setMoving(false); // settled — resume blinking
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

    /** Accent streak from the previous caret spot to the new one on large
     *  jumps. A single reused div: width = travel distance, rotated along
     *  the travel vector, fade re-armed on each spawn. */
    const spawnTrail = (from: { x: number; y: number; h: number }, to: CaretPos) => {
      const x1 = from.x;
      const y1 = from.y + from.h / 2;
      const x2 = to.x;
      const y2 = to.y + to.height / 2;
      const dx = x2 - x1;
      const dy = y2 - y1;
      const dist = Math.hypot(dx, dy);
      if (dist < TRAIL_MIN_DISTANCE) return;
      const angle = Math.atan2(dy, dx);
      trail.style.transition = "none";
      trail.style.opacity = "0.5";
      trail.style.width = `${dist}px`;
      trail.style.transform = `translate(${x1}px, ${y1 - 1}px) rotate(${angle}rad)`;
      void trail.offsetWidth; // commit start state before re-arming the fade
      trail.style.transition = "opacity 160ms ease-out";
      trail.style.opacity = "0";
    };

    /** Typewriter scroll — keep the caret inside the comfort zone of the
     *  editor's scroll container with a smooth glide instead of letting the
     *  browser snap it flush against the edge. Only runs while the overlay
     *  was already visible (typing flow), never on the initial click. */
    const keepCaretComfortable = (pos: CaretPos) => {
      if (scrollParent === undefined) scrollParent = findScrollParent(wrapper);
      if (!scrollParent) return;
      const cRect = scrollParent.getBoundingClientRect();
      const overshootBottom = pos.clientBottom - (cRect.bottom - SCROLL_MARGIN_BOTTOM);
      const overshootTop = pos.clientTop - (cRect.top + SCROLL_MARGIN_TOP);
      if (overshootBottom > 0) {
        scrollParent.scrollBy({ top: overshootBottom, behavior: "smooth" });
      } else if (overshootTop < 0) {
        scrollParent.scrollBy({ top: overshootTop, behavior: "smooth" });
      }
    };

    // ── Measurement (on selectionchange, rAF-batched) ──────────────────────
    const update = () => {
      measureRaf = null;
      if (composing) {
        hide();
        return;
      }
      const pos = measureCaret(wrapper);
      if (!pos) {
        hide();
        return;
      }
      const wasVisible = visible;
      if (!wasVisible) {
        // (Re)appearing — teleport straight to the spot, no glide from a
        // stale position (e.g. refocusing the note after a tab switch).
        cur.x = pos.x;
        cur.y = pos.y;
        cur.h = pos.height;
        apply();
        visible = true;
        caret.style.opacity = "1";
        setNativeCaretHidden(true);
        setMoving(false);
      } else {
        spawnTrail(cur, pos);
        setMoving(true); // solid while gliding
        keepCaretComfortable(pos);
      }
      target = pos;
      kickLoop();
    };

    const schedule = () => {
      if (measureRaf !== null) return;
      measureRaf = requestAnimationFrame(update);
    };

    const onCompositionStart = () => {
      composing = true;
      hide();
    };
    const onCompositionEnd = () => {
      composing = false;
      schedule();
    };

    document.addEventListener("selectionchange", schedule);
    window.addEventListener("resize", schedule);
    wrapper.addEventListener("compositionstart", onCompositionStart);
    wrapper.addEventListener("compositionend", onCompositionEnd);
    schedule();

    return () => {
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("resize", schedule);
      wrapper.removeEventListener("compositionstart", onCompositionStart);
      wrapper.removeEventListener("compositionend", onCompositionEnd);
      if (measureRaf !== null) cancelAnimationFrame(measureRaf);
      if (loopRaf !== null) cancelAnimationFrame(loopRaf);
      delete wrapper.dataset.smoothCaret;
    };
  }, [wrapperRef]);

  return (
    <>
      <div ref={trailRef} className="sn-smooth-caret-trail" aria-hidden="true" />
      <div ref={caretRef} className="sn-smooth-caret" aria-hidden="true">
        <div ref={blinkRef} className="sn-smooth-caret__blink" />
      </div>
    </>
  );
}

"use client";

/**
 * useLongPress — fire a callback after a sustained touch press, used to enter
 * the bulk-selection mode on mobile without a dedicated UI control.
 *
 * Returns a set of touch handlers to spread onto the target element. The
 * callback fires only when the finger stays roughly still for `delay` ms; any
 * movement past `moveTolerance` or an early release cancels it. Mouse input is
 * intentionally ignored — desktop already has the row checkboxes / context menu
 * for selection, and binding mousedown would hijack ordinary clicks.
 */

import { useCallback, useRef } from "react";

interface LongPressHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
}

export function useLongPress(
  /** Receives the viewport coordinates of the finger, so callers that open a
   *  positioned surface (context menu, sheet) can anchor it on the press.
   *  Callbacks that don't care may ignore both arguments. */
  callback: ((x: number, y: number) => void) | undefined,
  { delay = 500, moveTolerance = 10 }: { delay?: number; moveTolerance?: number } = {},
): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (!callback) return;
      const t = e.touches[0];
      if (!t) return;
      const { clientX, clientY } = t;
      start.current = { x: clientX, y: clientY };
      timer.current = setTimeout(() => {
        callback(clientX, clientY);
        timer.current = null;
      }, delay);
    },
    [callback, delay],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (timer.current === null || !start.current) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = Math.abs(t.clientX - start.current.x);
      const dy = Math.abs(t.clientY - start.current.y);
      if (dx > moveTolerance || dy > moveTolerance) clear();
    },
    [clear, moveTolerance],
  );

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd: clear,
    onTouchCancel: clear,
  };
}

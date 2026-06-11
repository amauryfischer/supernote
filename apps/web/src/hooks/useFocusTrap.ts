"use client";

/**
 * useFocusTrap — keeps keyboard focus inside an open overlay dialog and
 * restores it to the trigger element on close.
 *
 * For hand-rolled `role="dialog"` overlays (PromptModal / ConfirmModal) that
 * don't get a focus trap from a component lib. Behaviour:
 *   - On open: remember the previously-focused element, then move focus to the
 *     first focusable control inside the container (or a caller-provided one).
 *   - While open: Tab / Shift+Tab cycle within the container, never escaping.
 *   - On close: restore focus to the element that was focused before opening.
 */

import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import {
  getFocusableElements,
  handleFocusTrapKeydown,
} from "@/lib/a11y/focus-trap";

interface UseFocusTrapOptions {
  /**
   * Optional element to focus first instead of the first focusable child
   * (e.g. a text input the user should type into immediately).
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  options: UseFocusTrapOptions = {},
) {
  const { initialFocusRef } = options;
  // Keep the latest initialFocusRef without making the effect re-run on it.
  const initialFocusRefStore = useRef(initialFocusRef);
  initialFocusRefStore.current = initialFocusRef;

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    // Remember where focus was so we can hand it back when the dialog closes.
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    // Move focus inside after the DOM has mounted + painted, otherwise the
    // target may not exist / be focusable yet.
    const focusId = requestAnimationFrame(() => {
      const explicit = initialFocusRefStore.current?.current;
      if (explicit) {
        explicit.focus();
        return;
      }
      const focusable = getFocusableElements(container);
      const firstFocusable = focusable[0];
      if (firstFocusable) {
        firstFocusable.focus();
      } else {
        // No focusable child: make the dialog itself focusable as a fallback
        // so focus doesn't stay behind the overlay.
        container.tabIndex = -1;
        container.focus();
      }
    });

    const onKeyDown = (event: KeyboardEvent) => {
      handleFocusTrapKeydown(container, event, document.activeElement);
    };
    // Capture phase so we intercept Tab before it reaches focusable children.
    container.addEventListener("keydown", onKeyDown, true);

    return () => {
      cancelAnimationFrame(focusId);
      container.removeEventListener("keydown", onKeyDown, true);
      // Restore focus to the trigger if it's still in the document.
      if (previouslyFocused && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [active, containerRef]);
}

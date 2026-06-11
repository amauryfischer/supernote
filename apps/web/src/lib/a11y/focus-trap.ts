/**
 * Focus-trap primitives — pure DOM helpers, no React.
 *
 * Used by hand-rolled overlay dialogs (PromptModal / ConfirmModal) that are
 * NOT built on a component lib providing a trap. Without these, Tab / Shift+Tab
 * can move focus to controls *behind* the open dialog, and the dialog never
 * restores focus to whatever opened it.
 *
 * Kept framework-agnostic so the cycling logic can be unit-tested in jsdom
 * without mounting React.
 */

/**
 * Selector matching the natively-focusable / explicitly-tabbable elements.
 * Mirrors the common `focus-trap` / WAI-ARIA practice list.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable]",
  "[tabindex]",
  "audio[controls]",
  "video[controls]",
].join(",");

/**
 * True when an element (or an ancestor) is hidden in a way that removes it from
 * the tab order. We only return `true` on *positive* evidence of hiding so we
 * don't drop genuinely-visible controls in environments without layout (jsdom
 * reports no offsetParent / client rects for everything).
 */
function isHidden(el: HTMLElement): boolean {
  if (el.hidden) return true;
  if (el.getAttribute("aria-hidden") === "true") return true;
  // Walk up checking inline `display:none` / `visibility:hidden`. In a real
  // browser `getComputedStyle` would catch CSS-class hiding too; we fall back
  // to it when available (it's a no-op-safe call in jsdom).
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const inline = node.style;
    if (inline.display === "none" || inline.visibility === "hidden") return true;
    const win = node.ownerDocument?.defaultView;
    if (win?.getComputedStyle) {
      const computed = win.getComputedStyle(node);
      if (computed.display === "none" || computed.visibility === "hidden") {
        return true;
      }
    }
  }
  return false;
}

/** True when the element can actually receive keyboard focus right now. */
function isFocusable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  // `tabindex="-1"` is programmatically focusable but skipped by Tab order.
  if (el.tabIndex < 0) return false;
  if (el.hasAttribute("disabled")) return false;
  if (isHidden(el)) return false;
  return true;
}

/**
 * Ordered list of focusable elements inside `container` (tab order = DOM order;
 * we don't reorder by positive tabindex — the dialogs don't use them).
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  const result: HTMLElement[] = [];
  for (const node of nodes) {
    if (isFocusable(node)) result.push(node);
  }
  return result;
}

/** Minimal shape of a keydown event the trap reacts to. */
export interface FocusTrapKeyEvent {
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
}

/**
 * Handles one keydown for a trapped container. Cycles focus on Tab /
 * Shift+Tab so it never escapes `container`.
 *
 * Returns `true` when it moved focus (and called preventDefault), `false`
 * when the event wasn't a Tab or there was nothing to trap.
 *
 * `activeElement` is injected (rather than read off `document`) so the logic
 * stays testable and works across document/shadow boundaries.
 */
export function handleFocusTrapKeydown(
  container: HTMLElement,
  event: FocusTrapKeyEvent,
  activeElement: Element | null,
): boolean {
  if (event.key !== "Tab") return false;

  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    // Nothing tabbable: keep focus on the container itself rather than letting
    // it fall through to the page behind.
    event.preventDefault();
    return true;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  // `focusable.length === 0` returned above, so both ends exist; this guard
  // also satisfies `noUncheckedIndexedAccess` without a non-null assertion.
  if (!first || !last) return false;
  const activeIndex = activeElement
    ? focusable.indexOf(activeElement as HTMLElement)
    : -1;

  if (event.shiftKey) {
    // Going backwards from the first (or from outside the trap) wraps to last.
    if (activeElement === first || activeIndex === -1) {
      event.preventDefault();
      last.focus();
      return true;
    }
    return false;
  }

  // Going forwards from the last (or from outside the trap) wraps to first.
  if (activeElement === last || activeIndex === -1) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

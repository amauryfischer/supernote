import { useEffect, useState } from "react";

/**
 * True while the on-screen keyboard is open AND a rich-text editor
 * (contenteditable) holds focus. Drives the mobile "focus mode" that hides app
 * chrome — top bar, bottom nav, FAB, editor toolbar — so only the note content
 * remains while the user is typing.
 *
 * Detection: when the virtual keyboard slides up, the visual viewport shrinks
 * while the layout viewport (`window.innerHeight`) stays put on every mobile
 * browser we target. A shrink past the threshold therefore means "keyboard
 * up". We additionally require a contenteditable to be focused so that typing
 * in a plain `<input>`/`<textarea>` — e.g. the search field that lives inside
 * the very top bar we'd otherwise hide — does NOT trigger focus mode.
 *
 * Falls back to `false` when `visualViewport` is unavailable (older browsers,
 * SSR), so desktop and unsupported environments never enter focus mode.
 */

// Below this shrink the change is more likely a URL bar collapse or rotation
// than a keyboard; above it, it's the keyboard. Keyboards are ≥ ~250px tall.
const KEYBOARD_MIN_SHRINK_PX = 120;

function isEditableElementFocused(): boolean {
  const el = typeof document !== "undefined" ? document.activeElement : null;
  return el instanceof HTMLElement && el.isContentEditable;
}

export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    const recompute = () => {
      const keyboardUp = window.innerHeight - vv.height > KEYBOARD_MIN_SHRINK_PX;
      setOpen(keyboardUp && isEditableElementFocused());
    };

    vv.addEventListener("resize", recompute);
    vv.addEventListener("scroll", recompute);
    // Re-evaluate on focus moves: tapping out of the editor (keyboard may still
    // be animating down) clears focus mode; tapping into it re-enters.
    document.addEventListener("focusin", recompute);
    document.addEventListener("focusout", recompute);
    recompute();

    return () => {
      vv.removeEventListener("resize", recompute);
      vv.removeEventListener("scroll", recompute);
      document.removeEventListener("focusin", recompute);
      document.removeEventListener("focusout", recompute);
    };
  }, []);

  return open;
}

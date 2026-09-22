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
 * up". We additionally require a contenteditable or a `<textarea>` (multi-line
 * composers: mail reply, assistant) to be focused so that typing in a plain
 * `<input>` — e.g. the search field that lives inside the very top bar we'd
 * otherwise hide — does NOT trigger focus mode.
 *
 * Falls back to `false` when `visualViewport` is unavailable (older browsers,
 * SSR), so desktop and unsupported environments never enter focus mode.
 */

// Below this shrink the change is more likely a URL bar collapse or rotation
// than a keyboard; above it, it's the keyboard. Keyboards are ≥ ~250px tall.
const KEYBOARD_MIN_SHRINK_PX = 120;

function isEditableElementFocused(): boolean {
  const el = typeof document !== "undefined" ? document.activeElement : null;
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
}

function isKeyboardUp(vv: VisualViewport): boolean {
  return window.innerHeight - vv.height > KEYBOARD_MIN_SHRINK_PX;
}

// Focus moves re-evaluate too: tapping out of the editor (keyboard may still be
// animating down) clears focus mode; tapping into it re-enters.
function subscribeViewport(vv: VisualViewport, onChange: () => void): () => void {
  vv.addEventListener("resize", onChange);
  vv.addEventListener("scroll", onChange);
  document.addEventListener("focusin", onChange);
  document.addEventListener("focusout", onChange);
  onChange();
  return () => {
    vv.removeEventListener("resize", onChange);
    vv.removeEventListener("scroll", onChange);
    document.removeEventListener("focusin", onChange);
    document.removeEventListener("focusout", onChange);
  };
}

export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const vv = typeof window === "undefined" ? null : window.visualViewport;
    if (!vv) return undefined;
    return subscribeViewport(vv, () => setOpen(isKeyboardUp(vv) && isEditableElementFocused()));
  }, []);

  return open;
}

export interface KeyboardViewport {
  top: number;
  height: number;
}

/**
 * Zone visible au-dessus du clavier virtuel, `null` clavier fermé. `top` suit
 * iOS, qui fait glisser le viewport visuel pour montrer le champ focalisé.
 */
export function useKeyboardViewport(enabled: boolean): KeyboardViewport | null {
  const [box, setBox] = useState<KeyboardViewport | null>(null);

  useEffect(() => {
    const vv = enabled && typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return undefined;
    return subscribeViewport(vv, () => {
      const next = isKeyboardUp(vv) ? { top: vv.offsetTop, height: vv.height } : null;
      setBox((prev) => (prev?.top === next?.top && prev?.height === next?.height ? prev : next));
    });
  }, [enabled]);

  return enabled ? box : null;
}

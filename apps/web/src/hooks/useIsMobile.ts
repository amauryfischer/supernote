"use client";

import { useEffect, useState } from "react";

/**
 * Single mobile breakpoint for the whole app.
 *
 * Anything below this width is considered "mobile" and renders the dedicated
 * `MobileShell` (bottom nav + drawer + sheets) instead of the desktop
 * three-column shell. The same value lives in Tailwind's default `md:` prefix
 * (>= 768 px), so utility classes prefixed `md:` automatically activate when
 * we leave mobile mode — no extra config needed.
 */
export const MOBILE_MAX_WIDTH = 767;

/**
 * Reactive viewport-width predicate. Returns `true` while the viewport is
 * narrower than the mobile breakpoint (i.e. the user is on a phone-sized
 * screen, including narrow desktop windows).
 *
 * Implementation notes:
 *  - Uses `matchMedia` rather than tracking `innerWidth` so we listen for the
 *    breakpoint crossing only, not every pixel change. Cheaper + matches what
 *    the `md:` Tailwind utilities react to.
 *  - SSR-safe: returns `false` on the server / first paint, then reconciles
 *    in the mount effect. The shell flicker is acceptable because the SSR
 *    HTML is never rendered on a phone (the PWA always boots client-side).
 */
/**
 * Dev-only override: append `?mobile=1` (or `?mobile=0`) to the URL to force
 * the mobile (or desktop) shell regardless of viewport width. Persists for
 * the tab via sessionStorage so refreshes keep the same mode. Use
 * `?mobile=auto` to clear the override.
 */
function readForcedMode(): "on" | "off" | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("mobile");
    if (fromUrl === "1" || fromUrl === "true" || fromUrl === "on") {
      window.sessionStorage.setItem("supernote.forceMobile", "on");
      return "on";
    }
    if (fromUrl === "0" || fromUrl === "false" || fromUrl === "off") {
      window.sessionStorage.setItem("supernote.forceMobile", "off");
      return "off";
    }
    if (fromUrl === "auto") {
      window.sessionStorage.removeItem("supernote.forceMobile");
      return null;
    }
    const stored = window.sessionStorage.getItem("supernote.forceMobile");
    if (stored === "on" || stored === "off") return stored;
  } catch {
    // sessionStorage unavailable in some privacy modes — fall through to mql
  }
  return null;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const forced = readForcedMode();
    if (forced) return forced === "on";
    return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const forced = readForcedMode();
    if (forced) {
      setIsMobile(forced === "on");
      return;
    }
    const mql = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // Sync once after mount in case SSR/first-paint guess was wrong.
    setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

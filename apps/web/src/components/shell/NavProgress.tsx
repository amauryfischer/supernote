"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Global top-of-viewport progress bar that shows IMMEDIATELY when an
 * in-app navigation begins (before the destination route mounts).
 *
 * Approach: a capture-phase click listener on the document detects
 * left-clicks on same-origin <a> elements (Next/Link renders an <a>),
 * flips `pending` on, and clears it once `usePathname` reports the
 * new URL — or after a safety timeout. Also reacts to popstate (back/forward).
 *
 * Notes:
 * - Skips modified clicks (cmd/ctrl/shift/alt/middle) and target=_blank.
 * - No JS animation loop: the bar uses a CSS keyframes scale animation.
 * - Pointer-events: none so it never interferes with focus / forms / scroll.
 */
export function NavProgress() {
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const pathnameRef = useRef(pathname);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clear() {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setPending(false);
    }
    function arm() {
      setPending(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      // Safety: if route never resolves, drop the bar after 10s.
      timeoutRef.current = setTimeout(() => setPending(false), 10_000);
    }
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      const target = anchor.getAttribute("target");
      if (target && target !== "_self") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      // Resolve to compare origins; skip external links.
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      } catch {
        return;
      }
      arm();
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", arm);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", arm);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Clear when the new route has actually mounted.
  useEffect(() => {
    if (pathname !== pathnameRef.current) {
      pathnameRef.current = pathname;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setPending(false), 120);
    }
  }, [pathname]);

  if (!pending) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        zIndex: 9999,
        pointerEvents: "none",
        overflow: "hidden",
        background: "color-mix(in oklch, var(--accent) 18%, transparent)",
      }}
    >
      <div
        style={{
          height: "100%",
          width: "40%",
          background: "var(--accent)",
          borderRadius: 2,
          animation: "nav-progress-slide 1.1s cubic-bezier(0.4, 0, 0.2, 1) infinite",
          willChange: "transform",
        }}
      />
      <style>{`@keyframes nav-progress-slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}`}</style>
    </div>
  );
}

/**
 * Drop-in shim for `next/navigation` on top of react-router-dom v6.
 *
 * Aliased via vite.config.ts: `import {...} from "next/navigation"`
 * resolves to this module.
 *
 * Differences from the real Next API are documented inline. The behaviour
 * matches what the existing app code actually uses (router.push/replace/back,
 * usePathname, useParams, useSearchParams.get/has/toString) and ignores the
 * Next-only options that don't translate (e.g. `scroll`, `prefetch`, RSC).
 */

import { useCallback, useMemo } from "react";
import {
  useNavigate,
  useLocation,
  useParams as useRouterParams,
  useSearchParams as useRouterSearchParams,
} from "react-router-dom";

// ── useRouter ────────────────────────────────────────────────────────────────

export interface NavigateOptions {
  /** Ignored — react-router does not preserve scroll automatically. */
  scroll?: boolean;
}

export interface AppRouterInstance {
  push: (href: string, options?: NavigateOptions) => void;
  replace: (href: string, options?: NavigateOptions) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
  prefetch: (href: string) => void;
}

/**
 * Mimics Next's `useRouter()` from `next/navigation`. Methods are stable
 * across renders thanks to `useCallback` so consumers can include them in
 * effect dependency arrays without thrashing.
 */
export function useRouter(): AppRouterInstance {
  const navigate = useNavigate();

  const push = useCallback(
    (href: string, _options?: NavigateOptions) => {
      navigate(href);
    },
    [navigate],
  );

  const replace = useCallback(
    (href: string, _options?: NavigateOptions) => {
      navigate(href, { replace: true });
    },
    [navigate],
  );

  const back = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  const forward = useCallback(() => {
    navigate(1);
  }, [navigate]);

  // Next exposes `refresh()` to invalidate the RSC cache. In a SPA the
  // closest analogue is a no-op (data layers like tRPC/React Query manage
  // their own cache). We expose it for API parity.
  const refresh = useCallback(() => {
    /* no-op */
  }, []);

  // No prefetch in SPA mode — Vite serves modules instantly. No-op for parity.
  const prefetch = useCallback((_href: string) => {
    /* no-op */
  }, []);

  return useMemo(
    () => ({ push, replace, back, forward, refresh, prefetch }),
    [push, replace, back, forward, refresh, prefetch],
  );
}

// ── usePathname ──────────────────────────────────────────────────────────────

/**
 * Returns the current pathname (no query string, no hash).
 * Matches the Next.js shape exactly — not `null` during SSR because we never SSR.
 */
export function usePathname(): string {
  return useLocation().pathname;
}

// ── useParams ────────────────────────────────────────────────────────────────

/**
 * Generic over the route's param shape. react-router types params as a
 * record of optional strings; Next types them as `string | string[]`. The
 * existing app code only reads single string params, so we cast.
 */
export function useParams<
  T extends Record<string, string | string[]> = Record<string, string>,
>(): T {
  const raw = useRouterParams();
  return raw as unknown as T;
}

// ── useSearchParams ──────────────────────────────────────────────────────────

/**
 * Returns a `URLSearchParams` instance — just like Next.js. We keep the
 * exact API surface (`get`, `has`, `getAll`, `toString`, `entries`, …)
 * so existing call sites don't notice the difference.
 *
 * Note: in Next, this returned object is "read-only by convention". Mutating
 * it does NOT update the URL. We preserve that contract — callers must use
 * `router.push("?…")` to actually change the URL, just as before.
 */
export function useSearchParams(): URLSearchParams {
  const [params] = useRouterSearchParams();
  return params;
}

// ── notFound / redirect ──────────────────────────────────────────────────────

/**
 * Trigger a navigation to /404. We don't throw a Next-style NEXT_NOT_FOUND
 * symbol because there's no SSR pipeline to catch it — instead callers
 * should usually return `null` after calling.
 *
 * Any code currently using these is best replaced with explicit logic, but
 * we expose them so accidental imports don't blow up.
 */
export function notFound(): never {
  if (typeof window !== "undefined") window.location.replace("/404");
  throw new Error("notFound() called");
}

export function redirect(url: string): never {
  if (typeof window !== "undefined") window.location.replace(url);
  throw new Error(`redirect(${url}) called`);
}

// ── Re-exports kept for completeness ────────────────────────────────────────

export { useLocation } from "react-router-dom";

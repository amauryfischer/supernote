/**
 * Drop-in replacement for `next/dynamic`.
 *
 * Wraps `React.lazy` + `Suspense` with the Next options the app currently
 * uses: `{ ssr: false }` (no-op here — we never SSR), `loading` (rendered as
 * the Suspense fallback). The `dynamic(loader, options?)` signature stays
 * identical so callers don't change.
 *
 * Aliased via vite.config.ts: `import dynamic from "next/dynamic"`
 * resolves to the default export below.
 */

import * as React from "react";

type ComponentLike<P> = React.ComponentType<P>;
type Loader<P> = () => Promise<{ default: ComponentLike<P> } | ComponentLike<P>>;

// `P` is consumed by the loader's component type. We don't need to thread it
// through the options object — `dynamic<P>(...)` keeps inference working at
// the call site through the loader/return-type pair below.
interface DynamicOptions {
  ssr?: boolean;
  loading?: () => React.ReactNode;
  // Anything else (suspense, modules, ...) is silently accepted but ignored.
  [key: string]: unknown;
}

export default function dynamic<P extends object = Record<string, unknown>>(
  loader: Loader<P>,
  options?: DynamicOptions,
): React.ComponentType<P> {
  // Normalize to React.lazy's expected `{ default: Component }` shape: some
  // call sites use `() => import("foo").then((m) => ({ default: m.Foo }))`,
  // others — the named-export form `() => import("foo")` if `default` is
  // already there. We support both transparently.
  const Lazy = React.lazy<ComponentLike<P>>(async () => {
    const mod = await loader();
    if (mod && typeof mod === "object" && "default" in (mod as object)) {
      return mod as { default: ComponentLike<P> };
    }
    return { default: mod as ComponentLike<P> };
  });

  const Loading = options?.loading;
  const fallback: React.ReactNode = Loading ? <Loading /> : null;

  function DynamicWrapper(props: P) {
    return (
      <React.Suspense fallback={fallback}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <Lazy {...(props as any)} />
      </React.Suspense>
    );
  }
  DynamicWrapper.displayName = "DynamicShim";
  return DynamicWrapper;
}

/**
 * Drop-in replacement for `next/image`.
 *
 * Renders a plain <img> with the props Next exposes, dropping the ones that
 * only made sense for Next's image-optimization pipeline (loader, placeholder,
 * blurDataURL, fetchPriority="auto", quality, sizes, …).
 *
 * Aliased via vite.config.ts: `import Image from "next/image"` resolves here.
 *
 * The current codebase is PWA-only — no image optimization is needed. Dynamic
 * `src` strings (string | StaticImageData) are accepted; objects fall back
 * to their `.src` / `.default.src` field if present.
 */

import * as React from "react";

interface StaticImport {
  src?: string;
  default?: { src?: string };
}

export interface ImageProps
  extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src: string | StaticImport;
  alt: string;
  width?: number | string;
  height?: number | string;
  // Next-only props we tolerate but ignore:
  fill?: boolean;
  loader?: unknown;
  quality?: number | string;
  priority?: boolean;
  loading?: "lazy" | "eager";
  placeholder?: "blur" | "empty";
  blurDataURL?: string;
  unoptimized?: boolean;
  sizes?: string;
}

function resolveSrc(src: string | StaticImport): string {
  if (typeof src === "string") return src;
  if (src && typeof src === "object") {
    return src.src ?? src.default?.src ?? "";
  }
  return "";
}

const Image = React.forwardRef<HTMLImageElement, ImageProps>(function Image(
  { src, alt, width, height, fill, loader: _loader, quality: _quality, priority, loading, placeholder: _p, blurDataURL: _b, unoptimized: _u, sizes, ...rest },
  ref,
) {
  const resolvedSrc = resolveSrc(src);
  const style = fill
    ? { ...rest.style, position: "absolute" as const, inset: 0, width: "100%", height: "100%" }
    : rest.style;

  return (
    <img
      ref={ref}
      src={resolvedSrc}
      alt={alt}
      width={width}
      height={height}
      sizes={sizes}
      // `priority` maps to eager loading; otherwise defer to caller.
      loading={priority ? "eager" : loading}
      decoding="async"
      {...rest}
      style={style}
    />
  );
});

export default Image;

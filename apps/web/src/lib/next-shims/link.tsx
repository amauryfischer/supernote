/**
 * Drop-in replacement for `next/link` that maps to `react-router-dom`.
 *
 * The Next.js `<Link href="..." prefetch>` API is renamed to
 * `<Link to="..." />` by react-router. We accept the Next props and translate.
 *
 * Aliased via vite.config.ts: `import Link from "next/link"` resolves here.
 *
 * Quirks handled:
 *   - `href` (string | UrlObject) → `to` (string)
 *   - `prefetch`, `scroll`, `replace`, `shallow` → mostly ignored, but
 *     `replace` is forwarded to react-router's `replace` prop.
 *   - `passHref`, `legacyBehavior` → ignored (those existed for next/link@v12
 *     compat). Children are rendered as-is.
 *   - External URLs (absolute http(s)) fall through to a plain <a> so the
 *     browser handles them the way it would with Next.
 */

import * as React from "react";
import { Link as RRLink, type LinkProps as RRLinkProps } from "react-router-dom";

// Next.js UrlObject — minimal subset we accept.
interface UrlObjectLike {
  pathname?: string;
  query?: Record<string, string | number | boolean | undefined> | string;
  hash?: string;
}

type Href = string | UrlObjectLike;

// Mirrors Next's `<Link>` prop surface; everything past `to`/`href` is
// passthrough-or-discarded.
export interface NextLinkProps
  extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: Href;
  as?: Href;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  prefetch?: boolean | null;
  locale?: string | false;
  legacyBehavior?: boolean;
}

function urlObjectToString(url: UrlObjectLike): string {
  let out = url.pathname ?? "/";
  if (url.query) {
    if (typeof url.query === "string") {
      out += url.query.startsWith("?") ? url.query : `?${url.query}`;
    } else {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(url.query)) {
        if (v !== undefined) params.set(k, String(v));
      }
      const qs = params.toString();
      if (qs) out += `?${qs}`;
    }
  }
  if (url.hash) out += url.hash.startsWith("#") ? url.hash : `#${url.hash}`;
  return out;
}

function isExternal(href: string): boolean {
  return /^([a-z][a-z0-9+\-.]*:)?\/\//i.test(href) || href.startsWith("mailto:") || href.startsWith("tel:");
}

const Link = React.forwardRef<HTMLAnchorElement, NextLinkProps>(function Link(
  { href, as: _as, replace, scroll: _scroll, shallow: _shallow, passHref: _passHref, prefetch: _prefetch, locale: _locale, legacyBehavior: _legacyBehavior, ...rest },
  ref,
) {
  const target = typeof href === "string" ? href : urlObjectToString(href);

  // External / non-http schemes → plain anchor so we don't capture them.
  if (isExternal(target)) {
    return <a ref={ref} href={target} {...rest} />;
  }

  // react-router-dom's Link only accepts string/Path for `to`; we already
  // have a string above. `replace` carries through as the only meaningful
  // Next-side flag since the rest don't apply (no SSR, no prefetch model).
  return (
    <RRLink
      ref={ref}
      to={target}
      replace={replace}
      {...(rest as Omit<RRLinkProps, "to" | "replace">)}
    />
  );
});

export default Link;

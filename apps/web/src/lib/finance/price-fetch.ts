/**
 * Free price-feed adapter.
 *
 * Supports the asset categories defined by the worker `assetFields` seed:
 *   - crypto  → CoinGecko `/simple/price` (CORS-enabled, no key required)
 *   - action  → Yahoo Finance v8 chart endpoint, fallback Stooq CSV
 *   - fond    → Yahoo Finance v8 chart endpoint (most ETF tickers work there)
 *   - immo    → no public feed; returns `null` so the caller surfaces the user
 *               to manual entry.
 *
 * Every fetcher returns `{ value, currency } | null`. We never throw — when
 * a source is unreachable (CORS, 404, rate limit), the function resolves to
 * `null` and the UI shows a "non disponible" message. Currencies are kept
 * separate from values so a future feature can convert into the user's vault
 * currency at refresh time.
 */
export type PriceResult = { value: number; currency: string } | null;

export type AssetCategory = "crypto" | "action" | "fond" | "immo" | string;

interface FetchInput {
  category: AssetCategory;
  /**
   * For crypto: a CoinGecko id (e.g. `bitcoin`, `ethereum`).
   *   See https://api.coingecko.com/api/v3/coins/list for the catalogue.
   * For actions/fonds: a Yahoo Finance ticker (e.g. `AAPL`, `CW8.PA`).
   */
  symbol: string;
  /** Target currency for crypto lookup. Defaults to EUR. */
  vsCurrency?: string;
}

export async function fetchAssetPrice(input: FetchInput): Promise<PriceResult> {
  const symbol = input.symbol.trim();
  if (!symbol) return null;
  const vs = (input.vsCurrency ?? "EUR").toLowerCase();

  switch (input.category) {
    case "crypto":
      return fetchCoinGecko(symbol, vs);
    case "action":
    case "fond":
      return (await fetchYahoo(symbol)) ?? (await fetchStooq(symbol));
    default:
      return null;
  }
}

// ── CoinGecko ────────────────────────────────────────────────────────────────

async function fetchCoinGecko(coinId: string, vs: string): Promise<PriceResult> {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId.toLowerCase())}&vs_currencies=${encodeURIComponent(vs)}`;
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, Record<string, number>>;
    const entry = json[coinId.toLowerCase()];
    const price = entry?.[vs];
    if (typeof price !== "number") return null;
    return { value: price, currency: vs.toUpperCase() };
  } catch {
    return null;
  }
}

// ── Yahoo Finance v8 chart ──────────────────────────────────────────────────
//
// `query1.finance.yahoo.com/v8/finance/chart/{symbol}` returns the data but
// does NOT send `Access-Control-Allow-Origin`, so the browser blocks the
// response from a non-Yahoo origin. We work around it by routing through a
// public CORS proxy. `corsproxy.io` is free, unlimited, no key, and has been
// stable for years; if it goes down the caller still has the Stooq fallback.
//
// In dev (Vite), the same URL is rewritten by `vite.config.ts` so requests
// stay on the dev server origin and bypass the proxy.

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; currency?: string };
    }>;
    error?: unknown;
  };
}

async function fetchYahoo(symbol: string): Promise<PriceResult> {
  const directUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const devProxyUrl = `/_yahoo/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const corsProxyUrl = `https://corsproxy.io/?${encodeURIComponent(directUrl)}`;

  // allorigins.win wraps the response in JSON `{contents,status}` so we'd
  // need a separate parser. Easier path: use its `/raw` endpoint, which
  // streams the upstream body verbatim and rewrites CORS headers.
  const corsProxyUrlRaw = `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`;

  const candidates = import.meta.env.DEV
    ? [devProxyUrl, corsProxyUrlRaw, corsProxyUrl, directUrl]
    : [corsProxyUrlRaw, corsProxyUrl, directUrl];

  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) continue;
      const json = (await res.json()) as YahooChartResponse;
      const meta = json.chart?.result?.[0]?.meta;
      const price = meta?.regularMarketPrice;
      if (typeof price !== "number") continue;
      return { value: price, currency: (meta?.currency ?? "USD").toUpperCase() };
    } catch {
      // Try next candidate (CORS, network, etc.).
    }
  }
  return null;
}

// ── Stooq CSV fallback ──────────────────────────────────────────────────────
//
// Stooq serves quotes as CSV without CORS headers, so the browser blocks
// direct calls. We mirror the Yahoo proxy strategy: Vite proxy in dev,
// allorigins (free CORS gateway, JSON-wrapped) in prod.
//
// Stooq's symbol scheme differs from Yahoo (`mc.fr` instead of `MC.PA`,
// `aapl.us` instead of `AAPL`). We translate the most common suffixes
// automatically and try a couple of variants per symbol.

function stooqVariants(input: string): string[] {
  const lower = input.toLowerCase().trim();
  const variants = new Set<string>([lower]);
  const dotIdx = lower.lastIndexOf(".");
  const stem = dotIdx > 0 ? lower.slice(0, dotIdx) : lower;
  const suffix = dotIdx > 0 ? lower.slice(dotIdx + 1) : "";

  // Yahoo suffix → Stooq suffix translation.
  const map: Record<string, string> = {
    pa: "fr", // Paris
    l: "uk",  // London
    sw: "ch", // Swiss
    mi: "it", // Milan
    mc: "es", // Madrid
    as: "nl", // Amsterdam
    br: "be", // Brussels
    to: "ca", // Toronto
    ax: "au", // Australia
    t: "jp",  // Tokyo
    hk: "hk",
    sz: "cn", sh: "cn",
  };
  if (suffix && map[suffix]) variants.add(`${stem}.${map[suffix]}`);
  if (!suffix && stem) variants.add(`${stem}.us`); // bare ticker → assume US
  return [...variants];
}

async function fetchStooq(symbol: string): Promise<PriceResult> {
  const variants = stooqVariants(symbol);
  for (const v of variants) {
    const path = `/q/l/?s=${encodeURIComponent(v)}&i=d&f=sd2t2ohlcv&h&e=csv`;
    const directUrl = `https://stooq.com${path}`;
    const devProxyUrl = `/_stooq${path}`;
    const corsProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(directUrl)}`;

    const candidates = import.meta.env.DEV
      ? [devProxyUrl, corsProxyUrl, directUrl]
      : [corsProxyUrl, directUrl];

    for (const url of candidates) {
      try {
        const res = await fetch(url, { method: "GET" });
        if (!res.ok) continue;
        const text = await res.text();
        const lines = text.trim().split("\n");
        if (lines.length < 2) continue;
        const headers = lines[0]!.split(",");
        const values = lines[1]!.split(",");
        const closeIdx = headers.findIndex((h) => h.toLowerCase() === "close");
        if (closeIdx === -1) continue;
        const raw = values[closeIdx];
        if (!raw || raw === "N/D") continue;
        const price = parseFloat(raw);
        if (!Number.isFinite(price)) continue;
        // Stooq returns "MC.FR" etc — currency depends on the market. We
        // default to EUR for FR/DE/IT/ES/NL/BE/CH and USD otherwise.
        const variantSuffix = v.split(".").pop();
        const currency =
          variantSuffix && /^(fr|de|it|es|nl|be|ch)$/.test(variantSuffix) ? "EUR" : "USD";
        return { value: price, currency };
      } catch {
        // Try next candidate.
      }
    }
  }
  return null;
}

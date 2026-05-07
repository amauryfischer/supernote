import yahooFinance from "yahoo-finance2";
import { ok, err } from "@supernote/core/result";
import type { Result } from "@supernote/core/result";
import type { Logger } from "pino";
import {
  readCacheEntry,
  writeCacheEntry,
  isCacheValid,
} from "./cache.js";
import type {
  PriceQuote,
  PricingError,
  PricingEngine,
  PricingEngineOptions,
  CacheTtl,
} from "./types.js";

const DEFAULT_TTL: CacheTtl = {
  intraday: 15 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
};

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const FRANKFURTER_BASE = "https://api.frankfurter.app";

function pricingErr(
  code: PricingError["code"],
  message: string,
  ticker?: string,
  cause?: unknown,
): PricingError {
  return { code, message, ticker, cause };
}

export function createPricingEngine(opts: PricingEngineOptions): PricingEngine {
  const { cacheDir } = opts;
  const ttl: CacheTtl = {
    intraday: opts.cacheTtlMs?.intraday ?? DEFAULT_TTL.intraday,
    daily: opts.cacheTtlMs?.daily ?? DEFAULT_TTL.daily,
  };
  const logger: Logger | undefined = opts.logger;
  const memCache = new Map<string, PriceQuote>();

  async function getCached(
    key: string,
    ttlMs: number,
  ): Promise<PriceQuote | null> {
    const mem = memCache.get(key);
    if (mem) return mem;
    const entry = await readCacheEntry(cacheDir, key);
    if (entry && isCacheValid(entry, ttlMs)) {
      memCache.set(key, entry.quote);
      return entry.quote;
    }
    return null;
  }

  async function setCache(key: string, quote: PriceQuote): Promise<void> {
    memCache.set(key, quote);
    await writeCacheEntry(cacheDir, key, quote).catch((e) => {
      logger?.warn({ err: e, key }, "Failed to persist cache entry");
    });
  }

  async function fetchStock(
    ticker: string,
  ): Promise<Result<PriceQuote, PricingError>> {
    const key = `yahoo:${ticker.toUpperCase()}`;
    const cached = await getCached(key, ttl.intraday);
    if (cached) return ok(cached);

    try {
      const result = await yahooFinance.quote(ticker);
      if (!result || result.regularMarketPrice == null) {
        return err(pricingErr("NOT_FOUND", `Ticker not found: ${ticker}`, ticker));
      }
      const quote: PriceQuote = {
        ticker,
        symbol: result.symbol ?? ticker,
        price: result.regularMarketPrice,
        currency: result.currency ?? "USD",
        asOf: result.regularMarketTime ?? new Date(),
        source: "yahoo",
        metadata: {
          name: result.longName ?? result.shortName,
          exchange: result.fullExchangeName ?? result.exchange,
          marketCap: result.marketCap ?? undefined,
          volume: result.regularMarketVolume ?? undefined,
          change24h: result.regularMarketChangePercent ?? undefined,
        },
      };
      await setCache(key, quote);
      return ok(quote);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
        return err(pricingErr("RATE_LIMIT", `Rate limited for ${ticker}`, ticker, e));
      }
      if (msg.toLowerCase().includes("network") || msg.toLowerCase().includes("fetch")) {
        return err(pricingErr("NETWORK", `Network error for ${ticker}`, ticker, e));
      }
      return err(pricingErr("PARSE", `Failed to parse response for ${ticker}: ${msg}`, ticker, e));
    }
  }

  async function fetchStocks(
    tickers: string[],
  ): Promise<Result<PriceQuote[], PricingError>> {
    const results = await Promise.all(tickers.map(fetchStock));
    const quotes: PriceQuote[] = [];
    for (const r of results) {
      if (!r.ok) return r;
      quotes.push(r.value);
    }
    return ok(quotes);
  }

  async function fetchCrypto(
    coinId: string,
    vsCurrency = "usd",
  ): Promise<Result<PriceQuote, PricingError>> {
    const key = `coingecko:${coinId.toLowerCase()}:${vsCurrency.toLowerCase()}`;
    const cached = await getCached(key, ttl.intraday);
    if (cached) return ok(cached);

    try {
      const url = `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=${vsCurrency}&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true`;
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 429) return err(pricingErr("RATE_LIMIT", "CoinGecko rate limit", coinId));
        if (res.status === 404) return err(pricingErr("NOT_FOUND", `Coin not found: ${coinId}`, coinId));
        return err(pricingErr("NETWORK", `HTTP ${res.status} from CoinGecko`, coinId));
      }
      const data = (await res.json()) as Record<string, Record<string, number>>;
      const coinData = data[coinId.toLowerCase()];
      if (!coinData) {
        return err(pricingErr("NOT_FOUND", `No data for coin: ${coinId}`, coinId));
      }
      const price = coinData[vsCurrency.toLowerCase()];
      if (price == null) {
        return err(pricingErr("PARSE", `No price in ${vsCurrency} for ${coinId}`, coinId));
      }
      const quote: PriceQuote = {
        ticker: coinId,
        symbol: coinId.toUpperCase(),
        price,
        currency: vsCurrency.toUpperCase(),
        asOf: new Date(),
        source: "coingecko",
        metadata: {
          marketCap: coinData[`${vsCurrency}_market_cap`],
          volume: coinData[`${vsCurrency}_24h_vol`],
          change24h: coinData[`${vsCurrency}_24h_change`],
        },
      };
      await setCache(key, quote);
      return ok(quote);
    } catch (e) {
      if (e instanceof TypeError) {
        return err(pricingErr("OFFLINE", "No network connection", coinId, e));
      }
      return err(pricingErr("NETWORK", `Failed to fetch crypto: ${String(e)}`, coinId, e));
    }
  }

  async function fetchForex(
    from: string,
    to: string,
  ): Promise<Result<PriceQuote, PricingError>> {
    const key = `forex:${from.toUpperCase()}-${to.toUpperCase()}`;
    const cached = await getCached(key, ttl.daily);
    if (cached) return ok(cached);

    try {
      const url = `${FRANKFURTER_BASE}/latest?from=${from.toUpperCase()}&to=${to.toUpperCase()}`;
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404) return err(pricingErr("NOT_FOUND", `Currency not found: ${from}/${to}`, key));
        return err(pricingErr("NETWORK", `HTTP ${res.status} from Frankfurter`, key));
      }
      const data = (await res.json()) as { base: string; date: string; rates: Record<string, number> };
      const rate = data.rates[to.toUpperCase()];
      if (rate == null) {
        return err(pricingErr("PARSE", `No rate for ${to} in response`, key));
      }
      const quote: PriceQuote = {
        ticker: key,
        symbol: `${from.toUpperCase()}/${to.toUpperCase()}`,
        price: rate,
        currency: to.toUpperCase(),
        asOf: new Date(data.date),
        source: "forex",
        metadata: { name: `${from.toUpperCase()} to ${to.toUpperCase()} exchange rate` },
      };
      await setCache(key, quote);
      return ok(quote);
    } catch (e) {
      if (e instanceof TypeError) {
        return err(pricingErr("OFFLINE", "No network connection", key, e));
      }
      return err(pricingErr("NETWORK", `Failed to fetch forex: ${String(e)}`, key, e));
    }
  }

  async function refreshCache(): Promise<void> {
    memCache.clear();
    logger?.info("Pricing cache cleared");
  }

  function getCachedQuote(key: string): PriceQuote | null {
    return memCache.get(key) ?? null;
  }

  return { fetchStock, fetchStocks, fetchCrypto, fetchForex, refreshCache, getCachedQuote };
}

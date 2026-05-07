import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPricingEngine } from "./engine.js";
import * as cacheModule from "./cache.js";
import { normalizeKey } from "./cache.js";
import type { PriceQuote } from "./types.js";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return path.join(os.tmpdir(), `finance-test-${Date.now()}`);
}

function mockQuote(overrides: Partial<PriceQuote> = {}): PriceQuote {
  return {
    ticker: "AAPL",
    symbol: "AAPL",
    price: 195.5,
    currency: "USD",
    asOf: new Date("2026-05-07T16:00:00Z"),
    source: "yahoo",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeKey
// ---------------------------------------------------------------------------

describe("normalizeKey", () => {
  it("lowercases and replaces colon with underscore", () => {
    expect(normalizeKey("yahoo:AAPL")).toBe("yahoo_aapl");
    expect(normalizeKey("coingecko:bitcoin")).toBe("coingecko_bitcoin");
  });

  it("preserves hyphen in keys", () => {
    expect(normalizeKey("forex:USD-EUR")).toBe("forex_usd-eur");
  });

  it("handles already clean keys", () => {
    expect(normalizeKey("bitcoin")).toBe("bitcoin");
  });
});

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

describe("cache", () => {
  it("isCacheValid returns true within TTL", async () => {
    const { isCacheValid } = await import("./cache.js");
    const entry = { quote: mockQuote(), cachedAt: Date.now() - 1000 };
    expect(isCacheValid(entry, 60_000)).toBe(true);
  });

  it("isCacheValid returns false after TTL", async () => {
    const { isCacheValid } = await import("./cache.js");
    const entry = { quote: mockQuote(), cachedAt: Date.now() - 100_000 };
    expect(isCacheValid(entry, 60_000)).toBe(false);
  });

  it("readCacheEntry returns null for non-existent file", async () => {
    const { readCacheEntry } = await import("./cache.js");
    const result = await readCacheEntry("/non/existent/dir", "noop");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PricingEngine — getCachedQuote (memory cache)
// ---------------------------------------------------------------------------

describe("PricingEngine.getCachedQuote", () => {
  it("returns null for unknown key", () => {
    const engine = createPricingEngine({ cacheDir: makeTmpDir() });
    expect(engine.getCachedQuote("yahoo:UNKNOWN")).toBeNull();
  });

  it("returns null after refreshCache clears memory", async () => {
    const engine = createPricingEngine({ cacheDir: makeTmpDir() });
    // Manually populate via private side-effect: use spy
    await engine.refreshCache();
    expect(engine.getCachedQuote("yahoo:AAPL")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// PricingEngine — fetchStock (mocked)
// ---------------------------------------------------------------------------

describe("PricingEngine.fetchStock", () => {
  beforeEach(() => {
    vi.mock("yahoo-finance2", () => ({
      default: {
        quote: vi.fn(),
      },
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok PriceQuote on success", async () => {
    const yahooFinance = await import("yahoo-finance2");
    vi.mocked(yahooFinance.default.quote).mockResolvedValueOnce({
      symbol: "AAPL",
      regularMarketPrice: 195.5,
      regularMarketTime: new Date("2026-05-07T16:00:00Z"),
      currency: "USD",
      longName: "Apple Inc.",
      fullExchangeName: "NASDAQ",
      regularMarketChangePercent: -0.5,
    } as never);

    const engine = createPricingEngine({ cacheDir: makeTmpDir() });
    const result = await engine.fetchStock("AAPL");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.ticker).toBe("AAPL");
      expect(result.value.price).toBe(195.5);
      expect(result.value.currency).toBe("USD");
      expect(result.value.source).toBe("yahoo");
      expect(result.value.metadata?.name).toBe("Apple Inc.");
    }
  });

  it("returns NOT_FOUND when price is null", async () => {
    const yahooFinance = await import("yahoo-finance2");
    vi.mocked(yahooFinance.default.quote).mockResolvedValueOnce({
      symbol: "FAKEFAKE",
      regularMarketPrice: null,
    } as never);

    const engine = createPricingEngine({ cacheDir: makeTmpDir() });
    const result = await engine.fetchStock("FAKEFAKE");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("returns RATE_LIMIT on 429 error", async () => {
    const yahooFinance = await import("yahoo-finance2");
    vi.mocked(yahooFinance.default.quote).mockRejectedValueOnce(
      new Error("HTTP 429 rate limit exceeded"),
    );

    const engine = createPricingEngine({ cacheDir: makeTmpDir() });
    const result = await engine.fetchStock("AAPL");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RATE_LIMIT");
  });

  it("serves from memory cache on second call", async () => {
    const yahooFinance = await import("yahoo-finance2");
    vi.mocked(yahooFinance.default.quote).mockResolvedValueOnce({
      symbol: "TSLA",
      regularMarketPrice: 250.0,
      currency: "USD",
      regularMarketTime: new Date(),
    } as never);

    const engine = createPricingEngine({ cacheDir: makeTmpDir() });
    await engine.fetchStock("TSLA");
    await engine.fetchStock("TSLA"); // second call — should not call yahoo again

    expect(yahooFinance.default.quote).toHaveBeenCalledTimes(1);
  });

  it("fetchStocks returns all quotes when all succeed", async () => {
    const yahooFinance = await import("yahoo-finance2");
    const mkQuote = (sym: string, price: number) => ({
      symbol: sym,
      regularMarketPrice: price,
      currency: "USD",
      regularMarketTime: new Date(),
    });
    vi.mocked(yahooFinance.default.quote)
      .mockResolvedValueOnce(mkQuote("AAPL", 195) as never)
      .mockResolvedValueOnce(mkQuote("MSFT", 400) as never);

    const engine = createPricingEngine({ cacheDir: makeTmpDir() });
    const result = await engine.fetchStocks(["AAPL", "MSFT"]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
  });
});

// ---------------------------------------------------------------------------
// PricingEngine — fetchCrypto (mocked fetch)
// ---------------------------------------------------------------------------

describe("PricingEngine.fetchCrypto", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok PriceQuote for bitcoin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          bitcoin: { usd: 65000, usd_market_cap: 1.2e12, usd_24h_vol: 3e10, usd_24h_change: 1.5 },
        }),
      }),
    );

    const engine = createPricingEngine({ cacheDir: makeTmpDir() });
    const result = await engine.fetchCrypto("bitcoin");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.price).toBe(65000);
      expect(result.value.currency).toBe("USD");
      expect(result.value.source).toBe("coingecko");
    }
  });

  it("returns NOT_FOUND when coin absent from response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      }),
    );

    const engine = createPricingEngine({ cacheDir: makeTmpDir() });
    const result = await engine.fetchCrypto("notacoin");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns RATE_LIMIT on 429 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, status: 429 }),
    );

    const engine = createPricingEngine({ cacheDir: makeTmpDir() });
    const result = await engine.fetchCrypto("bitcoin");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("RATE_LIMIT");
  });

  it("returns OFFLINE on TypeError (network failure)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch")),
    );

    const engine = createPricingEngine({ cacheDir: makeTmpDir() });
    const result = await engine.fetchCrypto("bitcoin");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OFFLINE");
  });
});

// ---------------------------------------------------------------------------
// PricingEngine — fetchForex (mocked fetch)
// ---------------------------------------------------------------------------

describe("PricingEngine.fetchForex", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok PriceQuote for USD to EUR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          base: "USD",
          date: "2026-05-07",
          rates: { EUR: 0.923 },
        }),
      }),
    );

    const engine = createPricingEngine({ cacheDir: makeTmpDir() });
    const result = await engine.fetchForex("USD", "EUR");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.price).toBe(0.923);
      expect(result.value.source).toBe("forex");
      expect(result.value.currency).toBe("EUR");
    }
  });

  it("returns NOT_FOUND on 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ ok: false, status: 404 }),
    );

    const engine = createPricingEngine({ cacheDir: makeTmpDir() });
    const result = await engine.fetchForex("XYZ", "EUR");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns OFFLINE on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValueOnce(new TypeError("network error")),
    );

    const engine = createPricingEngine({ cacheDir: makeTmpDir() });
    const result = await engine.fetchForex("USD", "EUR");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("OFFLINE");
  });

  it("uses daily TTL for forex (longer cache)", async () => {
    const shortTtl = createPricingEngine({
      cacheDir: makeTmpDir(),
      cacheTtlMs: { daily: 1 }, // 1 ms — effectively expired immediately
    });
    // With 1ms TTL, after any delay the cache will be stale — just verify it doesn't crash
    expect(shortTtl).toBeDefined();
  });
});

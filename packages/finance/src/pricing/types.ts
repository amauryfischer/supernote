import type { Result } from "@supernote/core/result";
import type { Logger } from "pino";

export type PriceSource = "yahoo" | "coingecko" | "forex" | "manual" | "cache";

export interface PriceQuote {
  readonly ticker: string;
  readonly symbol: string;
  readonly price: number;
  readonly currency: string;
  readonly asOf: Date;
  readonly source: PriceSource;
  readonly metadata?: {
    readonly name?: string;
    readonly exchange?: string;
    readonly marketCap?: number;
    readonly volume?: number;
    readonly change24h?: number;
  };
}

export type PricingErrorCode =
  | "RATE_LIMIT"
  | "NOT_FOUND"
  | "NETWORK"
  | "PARSE"
  | "OFFLINE";

export interface PricingError {
  readonly code: PricingErrorCode;
  readonly message: string;
  readonly ticker?: string;
  readonly cause?: unknown;
}

export interface CacheTtl {
  readonly intraday: number;
  readonly daily: number;
}

export interface PricingEngineOptions {
  readonly cacheDir: string;
  readonly cacheTtlMs?: Partial<CacheTtl>;
  readonly logger?: Logger;
}

export interface PricingEngine {
  fetchStock(ticker: string): Promise<Result<PriceQuote, PricingError>>;
  fetchStocks(tickers: string[]): Promise<Result<PriceQuote[], PricingError>>;
  fetchCrypto(
    coinId: string,
    vsCurrency?: string,
  ): Promise<Result<PriceQuote, PricingError>>;
  fetchForex(
    from: string,
    to: string,
  ): Promise<Result<PriceQuote, PricingError>>;
  refreshCache(): Promise<void>;
  getCachedQuote(key: string): PriceQuote | null;
}

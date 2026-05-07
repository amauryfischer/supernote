import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PriceQuote } from "./types.js";

interface CacheEntry {
  readonly quote: PriceQuote;
  readonly cachedAt: number;
}

export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

export function cacheFilePath(cacheDir: string, key: string): string {
  return join(cacheDir, `${normalizeKey(key)}.json`);
}

export async function readCacheEntry(
  cacheDir: string,
  key: string,
): Promise<CacheEntry | null> {
  try {
    const raw = await readFile(cacheFilePath(cacheDir, key), "utf-8");
    const parsed = JSON.parse(raw) as CacheEntry & { quote: { asOf: string } };
    return {
      ...parsed,
      quote: { ...parsed.quote, asOf: new Date(parsed.quote.asOf) },
    };
  } catch {
    return null;
  }
}

export async function writeCacheEntry(
  cacheDir: string,
  key: string,
  quote: PriceQuote,
): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  const entry: CacheEntry = { quote, cachedAt: Date.now() };
  await writeFile(cacheFilePath(cacheDir, key), JSON.stringify(entry), "utf-8");
}

export function isCacheValid(
  entry: CacheEntry,
  ttlMs: number,
): boolean {
  return Date.now() - entry.cachedAt < ttlMs;
}

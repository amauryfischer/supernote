import { z } from "zod";

// ── Shared primitives ─────────────────────────────────────────────────────────

export const AppInfoSchema = z.object({
  appName: z.string(),
  version: z.string(),
  electronVersion: z.string(),
  nodeVersion: z.string(),
  platform: z.enum(["darwin", "win32", "linux"]),
  arch: z.string(),
  userDataPath: z.string(),
  locale: z.string(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export const FileFilterSchema = z.object({
  name: z.string(),
  extensions: z.array(z.string()),
});
export type FileFilter = z.infer<typeof FileFilterSchema>;

// ── Input schemas ─────────────────────────────────────────────────────────────

export const OpenExternalInput = z.object({
  url: z.string().url(),
});
export type OpenExternalInput = z.infer<typeof OpenExternalInput>;

export const ShowInFolderInput = z.object({
  path: z.string().min(1),
});
export type ShowInFolderInput = z.infer<typeof ShowInFolderInput>;

export const SelectFolderInput = z.object({
  title: z.string().optional(),
  defaultPath: z.string().optional(),
});
export type SelectFolderInput = z.infer<typeof SelectFolderInput>;

export const SelectFileInput = z.object({
  title: z.string().optional(),
  defaultPath: z.string().optional(),
  filters: z.array(FileFilterSchema).optional(),
  multiSelections: z.boolean().default(false),
});
export type SelectFileInput = z.infer<typeof SelectFileInput>;

// ── Output schemas ────────────────────────────────────────────────────────────

export const SelectFolderOutput = z.object({
  /** Null if the user cancelled the dialog */
  path: z.string().nullable(),
});
export type SelectFolderOutput = z.infer<typeof SelectFolderOutput>;

export const SelectFileOutput = z.object({
  /** Empty if the user cancelled the dialog */
  paths: z.array(z.string()),
});
export type SelectFileOutput = z.infer<typeof SelectFileOutput>;

// ── fetchPrice ────────────────────────────────────────────────────────────────

export const FetchPriceInput = z.object({
  /** Yahoo Finance ticker (e.g. "AAPL", "MC.PA") or CoinGecko id (e.g. "bitcoin") */
  ticker: z.string().min(1),
  /** Whether to treat the ticker as a crypto coin id. Defaults to false. */
  isCrypto: z.boolean().optional().default(false),
  /** Quote currency for crypto. Defaults to "eur". */
  vsCurrency: z.string().optional().default("eur"),
});
export type FetchPriceInput = z.infer<typeof FetchPriceInput>;

export const FetchPriceOutput = z.object({
  ticker: z.string(),
  symbol: z.string(),
  price: z.number(),
  currency: z.string(),
  asOf: z.string().datetime(),
  source: z.enum(["yahoo", "coingecko", "forex", "manual", "cache"]),
  name: z.string().optional(),
  change24h: z.number().optional(),
});
export type FetchPriceOutput = z.infer<typeof FetchPriceOutput>;

// ── transcribeAudio ───────────────────────────────────────────────────────────

export const TranscribeAudioInput = z.object({
  filePath: z.string().min(1),
  language: z.enum(["fr", "en", "auto"]).optional().default("fr"),
});
export type TranscribeAudioInput = z.infer<typeof TranscribeAudioInput>;

export const TranscriptionSegmentSchema = z.object({
  start: z.number(),
  end: z.number(),
  text: z.string(),
});

export const TranscribeAudioOutput = z.object({
  text: z.string(),
  language: z.string(),
  segments: z.array(TranscriptionSegmentSchema),
  duration: z.number(),
  assetPath: z.string(),
});
export type TranscribeAudioOutput = z.infer<typeof TranscribeAudioOutput>;

// ── ocrImage ─────────────────────────────────────────────────────────────────

export const OcrImageInput = z.object({
  filePath: z.string().min(1),
});
export type OcrImageInput = z.infer<typeof OcrImageInput>;

export const OcrImageOutput = z.object({
  text: z.string(),
  confidence: z.number(),
  assetPath: z.string(),
});
export type OcrImageOutput = z.infer<typeof OcrImageOutput>;

// ── fetchStockPrice ───────────────────────────────────────────────────────────

export const FetchStockPriceInput = z.object({
  ticker: z.string().min(1),
});
export type FetchStockPriceInput = z.infer<typeof FetchStockPriceInput>;

export const FetchCryptoPriceInput = z.object({
  symbol: z.string().min(1),
  vsCurrency: z.string().optional().default("eur"),
});
export type FetchCryptoPriceInput = z.infer<typeof FetchCryptoPriceInput>;

export const FetchForexRateInput = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});
export type FetchForexRateInput = z.infer<typeof FetchForexRateInput>;

export const LivePriceOutput = z.object({
  ticker: z.string(),
  symbol: z.string(),
  price: z.number(),
  currency: z.string(),
  asOf: z.string().datetime(),
  source: z.enum(["yahoo", "coingecko", "forex", "manual", "cache"]),
  name: z.string().optional(),
  change24h: z.number().optional(),
});
export type LivePriceOutput = z.infer<typeof LivePriceOutput>;

// ── ollamaStatus ─────────────────────────────────────────────────────────────

export const OllamaStatusOutput = z.object({
  available: z.boolean(),
  models: z.array(z.object({
    name: z.string(),
    size: z.number(),
    digest: z.string(),
  })),
});
export type OllamaStatusOutput = z.infer<typeof OllamaStatusOutput>;

// ── encryption ───────────────────────────────────────────────────────────────

export const EncryptFolderInput = z.object({
  folderPath: z.string().min(1),
  passphrase: z.string().min(1),
});
export type EncryptFolderInput = z.infer<typeof EncryptFolderInput>;

export const DecryptFolderInput = z.object({
  folderPath: z.string().min(1),
  passphrase: z.string().min(1),
});
export type DecryptFolderInput = z.infer<typeof DecryptFolderInput>;

export const UnlockInput = z.object({
  passphrase: z.string().min(1),
});
export type UnlockInput = z.infer<typeof UnlockInput>;

export const EncryptionStatusOutput = z.object({
  unlocked: z.boolean(),
  encryptedFolders: z.array(z.string()),
});
export type EncryptionStatusOutput = z.infer<typeof EncryptionStatusOutput>;

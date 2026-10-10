import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  AppInfoSchema,
  OpenExternalInput,
  ShowInFolderInput,
  FetchPriceInput,
  FetchPriceOutput,
  FetchStockPriceInput,
  FetchCryptoPriceInput,
  FetchForexRateInput,
  LivePriceOutput,
  OllamaStatusOutput,
} from "../schemas/system.js";
import { z } from "zod";

export const systemRouter = router({
  /**
   * Returns the default vault path for the current OS user.
   * Resolves to `~/Documents/Supernote` (expanded by the main process).
   */
  getDefaultVaultPath: publicProcedure
    .output(z.object({ path: z.string() }))
    .query(() => {
      throw notImplemented("system.getDefaultVaultPath");
    }),

  /** Get application metadata (version, platform, paths, etc.). */
  getAppInfo: publicProcedure
    .output(AppInfoSchema)
    .query(() => {
      throw notImplemented("system.getAppInfo");
    }),

  /** Open a URL in the system default browser. */
  openExternal: publicProcedure
    .input(OpenExternalInput)
    .output(z.object({ success: z.boolean() }))
    .mutation(() => {
      throw notImplemented("system.openExternal");
    }),

  /** Reveal a file or folder in the OS file manager. */
  showInFolder: publicProcedure
    .input(ShowInFolderInput)
    .output(z.object({ success: z.boolean() }))
    .mutation(() => {
      throw notImplemented("system.showInFolder");
    }),

  /**
   * Fetch the live market price for a stock ticker (via yahoo-finance2) or
   * a crypto coin id (via CoinGecko). Runs in the main process where network
   * access is unrestricted. Returns the quote or throws a TRPCError.
   */
  fetchPrice: publicProcedure
    .input(FetchPriceInput)
    .output(FetchPriceOutput)
    .query(() => {
      throw notImplemented("system.fetchPrice");
    }),

  /** Fetch live stock price via Yahoo Finance (10 s timeout). */
  fetchStockPrice: publicProcedure
    .input(FetchStockPriceInput)
    .output(LivePriceOutput)
    .mutation(() => {
      throw notImplemented("system.fetchStockPrice");
    }),

  /** Fetch live crypto price via CoinGecko (10 s timeout). */
  fetchCryptoPrice: publicProcedure
    .input(FetchCryptoPriceInput)
    .output(LivePriceOutput)
    .mutation(() => {
      throw notImplemented("system.fetchCryptoPrice");
    }),

  /** Fetch live forex rate via Frankfurter (10 s timeout). */
  fetchForexRate: publicProcedure
    .input(FetchForexRateInput)
    .output(LivePriceOutput)
    .mutation(() => {
      throw notImplemented("system.fetchForexRate");
    }),

  /** Check Ollama availability and list installed models. */
  ollamaStatus: publicProcedure
    .output(OllamaStatusOutput)
    .query(() => {
      throw notImplemented("system.ollamaStatus");
    }),
});

export type SystemRouter = typeof systemRouter;

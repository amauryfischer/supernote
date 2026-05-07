import { router, publicProcedure } from "./trpc.js";
import { notImplemented } from "../errors/index.js";
import {
  AppInfoSchema,
  OpenExternalInput,
  ShowInFolderInput,
  SelectFolderInput,
  SelectFolderOutput,
  SelectFileInput,
  SelectFileOutput,
  FetchPriceInput,
  FetchPriceOutput,
  TranscribeAudioInput,
  TranscribeAudioOutput,
  OcrImageInput,
  OcrImageOutput,
  FetchStockPriceInput,
  FetchCryptoPriceInput,
  FetchForexRateInput,
  LivePriceOutput,
  OllamaStatusOutput,
  EncryptFolderInput,
  DecryptFolderInput,
  UnlockInput,
  EncryptionStatusOutput,
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

  picker: router({
    /** Open a native folder picker dialog. */
    selectFolder: publicProcedure
      .input(SelectFolderInput)
      .output(SelectFolderOutput)
      .mutation(() => {
        throw notImplemented("system.picker.selectFolder");
      }),

    /** Open a native file picker dialog (supports multi-selection). */
    selectFile: publicProcedure
      .input(SelectFileInput)
      .output(SelectFileOutput)
      .mutation(() => {
        throw notImplemented("system.picker.selectFile");
      }),
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

  /** Transcribe an audio file via Whisper (nodejs-whisper). Copies the file
   *  into _assets/audio/{ulid}.{ext} and returns markdown-ready segments. */
  transcribeAudio: publicProcedure
    .input(TranscribeAudioInput)
    .output(TranscribeAudioOutput)
    .mutation(() => {
      throw notImplemented("system.transcribeAudio");
    }),

  /** Run OCR on an image file via Tesseract.js. Copies the file into
   *  _assets/images/{ulid}.{ext} and returns extracted text + confidence. */
  ocrImage: publicProcedure
    .input(OcrImageInput)
    .output(OcrImageOutput)
    .mutation(() => {
      throw notImplemented("system.ocrImage");
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

  /** Encryption procedures for designated vault folders (age-based). */
  encryption: router({
    /** List absolute paths of all encrypted folders. */
    listEncryptedFolders: publicProcedure
      .output(z.array(z.string()))
      .query(() => {
        throw notImplemented("system.encryption.listEncryptedFolders");
      }),

    /** Mark a folder as encrypted and cipher all existing files in it. */
    encryptFolder: publicProcedure
      .input(EncryptFolderInput)
      .output(z.object({ success: z.boolean() }))
      .mutation(() => {
        throw notImplemented("system.encryption.encryptFolder");
      }),

    /** Remove the encrypted marker and decipher all files in the folder. */
    decryptFolder: publicProcedure
      .input(DecryptFolderInput)
      .output(z.object({ success: z.boolean() }))
      .mutation(() => {
        throw notImplemented("system.encryption.decryptFolder");
      }),

    /** Unlock the encryption session for the current vault. */
    unlock: publicProcedure
      .input(UnlockInput)
      .output(z.object({ success: z.boolean() }))
      .mutation(() => {
        throw notImplemented("system.encryption.unlock");
      }),

    /** Lock the encryption session (forget cached passphrase). */
    lock: publicProcedure
      .output(z.object({ success: z.boolean() }))
      .mutation(() => {
        throw notImplemented("system.encryption.lock");
      }),

    /** Return current encryption session status. */
    status: publicProcedure
      .output(EncryptionStatusOutput)
      .query(() => {
        throw notImplemented("system.encryption.status");
      }),
  }),
});

export type SystemRouter = typeof systemRouter;

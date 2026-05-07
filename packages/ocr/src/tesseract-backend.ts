import type { OcrOptions, OcrResult, OcrBlock, Logger } from "./types.js";

/** Default language set: French + English. */
export const DEFAULT_LANGUAGES = ["fra", "eng"];

// ---------------------------------------------------------------------------
// Minimal type surface we use from tesseract.js
// ---------------------------------------------------------------------------
interface TesseractBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface TesseractBlock {
  text: string;
  confidence: number;
  bbox: TesseractBbox;
}

interface TesseractPage {
  text: string;
  confidence: number;
  blocks: TesseractBlock[] | null;
}

interface TesseractWorker {
  setParameters(params: Record<string, string | number>): Promise<unknown>;
  recognize(
    image: string | Buffer,
    options?: Record<string, unknown>
  ): Promise<{ data: TesseractPage }>;
  terminate(): Promise<unknown>;
}

interface TesseractModule {
  createWorker(
    langs: string | string[],
    oem?: number,
    options?: Record<string, unknown>
  ): Promise<TesseractWorker>;
}

/** Attempt a dynamic import of tesseract.js. Returns null when unavailable. */
async function tryImportTesseract(): Promise<TesseractModule | null> {
  try {
    const mod = (await import("tesseract.js")) as unknown;
    // tesseract.js uses `export = Tesseract` so ESM interop gives us .default
    const m = (mod as { default?: TesseractModule }) .default ?? (mod as TesseractModule);
    if (typeof m?.createWorker === "function") return m;
    return null;
  } catch {
    return null;
  }
}

/** Map a Page returned by Tesseract into our OcrResult shape. */
function mapPage(page: TesseractPage): OcrResult {
  const blocks: OcrBlock[] = (page.blocks ?? []).map((b) => ({
    bbox: { x0: b.bbox.x0, y0: b.bbox.y0, x1: b.bbox.x1, y1: b.bbox.y1 },
    text: b.text.trim(),
    confidence: b.confidence,
  }));

  return {
    text: page.text.trim(),
    confidence: page.confidence,
    blocks,
  };
}

/** Build the Tesseract worker options. */
function buildWorkerOptions(langDir: string | undefined): Record<string, unknown> {
  const opts: Record<string, unknown> = { legacyLang: false };
  if (langDir) opts["langPath"] = langDir;
  return opts;
}

// ---------------------------------------------------------------------------
// Public backend interface
// ---------------------------------------------------------------------------

export interface TesseractBackend {
  isAvailable(): Promise<boolean>;
  recognizeImage(
    image: string | Buffer,
    langDir: string | undefined,
    opts: OcrOptions,
    logger: Logger
  ): Promise<OcrResult>;
}

export function createTesseractBackend(): TesseractBackend {
  let _tesseract: TesseractModule | null | undefined = undefined;

  return {
    async isAvailable(): Promise<boolean> {
      if (_tesseract === undefined) _tesseract = await tryImportTesseract();
      return _tesseract !== null;
    },

    async recognizeImage(
      image: string | Buffer,
      langDir: string | undefined,
      opts: OcrOptions,
      logger: Logger
    ): Promise<OcrResult> {
      if (_tesseract === undefined) _tesseract = await tryImportTesseract();
      if (!_tesseract) throw new Error("tesseract.js is not available");

      const langs = opts.languages ?? DEFAULT_LANGUAGES;
      const workerOpts = buildWorkerOptions(langDir);

      logger.debug(`OCR with langs [${langs.join(",")}]`);

      const worker = await _tesseract.createWorker(langs, 1, workerOpts);

      try {
        if (opts.pageSegMode !== undefined) {
          await worker.setParameters({
            tessedit_pageseg_mode: opts.pageSegMode,
          });
        }

        const result = await worker.recognize(image);
        return mapPage(result.data);
      } finally {
        await worker.terminate();
      }
    },
  };
}

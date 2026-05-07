import type {
  OcrEngine,
  OcrEngineOptions,
  OcrOptions,
  OcrResult,
  Logger,
} from "./types.js";
import {
  createTesseractBackend,
  type TesseractBackend,
} from "./tesseract-backend.js";

/** No-op logger used when none is provided. */
const NOOP_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

/** Validate image input at the system boundary. */
function assertValidImage(image: string | Buffer, label: string): void {
  if (typeof image === "string" && !image) {
    throw new Error(`${label}: image path must not be empty`);
  }
  if (Buffer.isBuffer(image) && image.length === 0) {
    throw new Error(`${label}: image buffer must not be empty`);
  }
}

/**
 * Concrete implementation of OcrEngine backed by tesseract.js.
 */
class TesseractOcrEngine implements OcrEngine {
  private readonly langDir: string | undefined;
  private readonly logger: Logger;
  private readonly backend: TesseractBackend;

  constructor(opts: OcrEngineOptions, backend: TesseractBackend) {
    this.langDir = opts.langDir;
    this.logger = opts.logger ?? NOOP_LOGGER;
    this.backend = backend;
  }

  async isAvailable(): Promise<boolean> {
    return this.backend.isAvailable();
  }

  async recognize(
    image: string | Buffer,
    opts: OcrOptions = {}
  ): Promise<OcrResult> {
    assertValidImage(image, "recognize");
    const label = typeof image === "string" ? image : `<buffer ${image.length}B>`;
    this.logger.debug(`recognize: ${label}`);
    return this.backend.recognizeImage(image, this.langDir, opts, this.logger);
  }

  async recognizeBatch(images: (string | Buffer)[]): Promise<OcrResult[]> {
    if (!Array.isArray(images) || images.length === 0) {
      throw new Error("recognizeBatch: images array must not be empty");
    }
    images.forEach((img, i) => assertValidImage(img, `recognizeBatch[${i}]`));

    return Promise.all(
      images.map((img) =>
        this.backend.recognizeImage(img, this.langDir, {}, this.logger)
      )
    );
  }
}

/**
 * Factory that creates an OcrEngine backed by tesseract.js.
 *
 * @param opts.langDir  Optional directory containing .traineddata files.
 * @param opts.logger   Optional structured logger (pino-compatible).
 * @param backend       Optional backend override (used in tests).
 */
export function createOcrEngine(
  opts: OcrEngineOptions = {},
  backend?: TesseractBackend
): OcrEngine {
  return new TesseractOcrEngine(opts, backend ?? createTesseractBackend());
}

/**
 * Logger interface — minimal subset compatible with console and pino.
 */
export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
  debug(msg: string, ...args: unknown[]): void;
}

/**
 * Bounding box of a recognised block on the page.
 */
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A single recognised block of text with its position and confidence.
 */
export interface OcrBlock {
  bbox: BBox;
  text: string;
  confidence: number;
}

/**
 * Full result returned by a recognition call.
 */
export interface OcrResult {
  text: string;
  confidence: number;
  blocks: OcrBlock[];
}

/**
 * Options passed to individual recognition calls.
 */
export interface OcrOptions {
  /** Tesseract language codes, e.g. ['fra', 'eng']. Defaults to ['fra', 'eng']. */
  languages?: string[];
  /** Tesseract page segmentation mode (PSM). */
  pageSegMode?: number;
}

/**
 * Public API surface of an OCR engine.
 */
export interface OcrEngine {
  isAvailable(): Promise<boolean>;
  recognize(
    image: string | Buffer,
    opts?: OcrOptions
  ): Promise<OcrResult>;
  recognizeBatch(images: (string | Buffer)[]): Promise<OcrResult[]>;
}

/**
 * Options passed to createOcrEngine().
 */
export interface OcrEngineOptions {
  /** Directory where Tesseract language data (.traineddata) files are stored. */
  langDir?: string;
  logger?: Logger;
}

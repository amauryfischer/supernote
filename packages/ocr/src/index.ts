/**
 * @supernote/ocr — Tesseract.js-based OCR engine.
 *
 * Quick start:
 *   const engine = createOcrEngine({ langDir: '/tmp/tessdata' });
 *   const result = await engine.recognize('/path/to/image.png');
 */

export type {
  OcrEngine,
  OcrResult,
  OcrBlock,
  OcrOptions,
  OcrEngineOptions,
  BBox,
  Logger,
} from "./types.js";

export { createOcrEngine } from "./engine.js";
export { DEFAULT_LANGUAGES, createTesseractBackend } from "./tesseract-backend.js";
export type { TesseractBackend } from "./tesseract-backend.js";

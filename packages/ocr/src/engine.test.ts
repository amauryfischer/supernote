import { describe, it, expect, vi } from "vitest";
import { createOcrEngine, DEFAULT_LANGUAGES } from "./index.js";
import type { OcrResult, Logger } from "./index.js";
import type { TesseractBackend } from "./tesseract-backend.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_RESULT: OcrResult = {
  text: "Bonjour le monde",
  confidence: 92.5,
  blocks: [
    {
      bbox: { x0: 10, y0: 10, x1: 200, y1: 40 },
      text: "Bonjour le monde",
      confidence: 92.5,
    },
  ],
};

function makeDummyBackend(available = true): TesseractBackend {
  return {
    isAvailable: vi.fn().mockResolvedValue(available),
    recognizeImage: vi.fn().mockResolvedValue(MOCK_RESULT),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createOcrEngine", () => {
  it("returns an object with the expected interface", () => {
    const engine = createOcrEngine({}, makeDummyBackend());
    expect(typeof engine.isAvailable).toBe("function");
    expect(typeof engine.recognize).toBe("function");
    expect(typeof engine.recognizeBatch).toBe("function");
  });

  it("works without any options (all defaults)", () => {
    expect(() => createOcrEngine()).not.toThrow();
  });
});

describe("OcrEngine.isAvailable", () => {
  it("returns true when backend is available", async () => {
    const engine = createOcrEngine({}, makeDummyBackend(true));
    await expect(engine.isAvailable()).resolves.toBe(true);
  });

  it("returns false when backend is unavailable", async () => {
    const engine = createOcrEngine({}, makeDummyBackend(false));
    await expect(engine.isAvailable()).resolves.toBe(false);
  });
});

describe("OcrEngine.recognize", () => {
  it("returns an OcrResult with expected shape for a path", async () => {
    const backend = makeDummyBackend();
    const engine = createOcrEngine({}, backend);
    const result = await engine.recognize("/fake/image.png");
    expect(result.text).toBe("Bonjour le monde");
    expect(result.confidence).toBe(92.5);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.bbox).toMatchObject({ x0: 10, y0: 10 });
  });

  it("returns an OcrResult for a Buffer input", async () => {
    const backend = makeDummyBackend();
    const engine = createOcrEngine({}, backend);
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    const result = await engine.recognize(buf);
    expect(result.text).toBe("Bonjour le monde");
  });

  it("throws when image path is empty string", async () => {
    const engine = createOcrEngine({}, makeDummyBackend());
    await expect(engine.recognize("")).rejects.toThrow("image path must not be empty");
  });

  it("throws when image buffer is empty", async () => {
    const engine = createOcrEngine({}, makeDummyBackend());
    await expect(engine.recognize(Buffer.alloc(0))).rejects.toThrow(
      "image buffer must not be empty"
    );
  });

  it("passes languages option to the backend", async () => {
    const backend = makeDummyBackend();
    const engine = createOcrEngine({}, backend);
    await engine.recognize("/fake/image.png", { languages: ["fra"] });
    expect(backend.recognizeImage).toHaveBeenCalledWith(
      "/fake/image.png",
      undefined,
      { languages: ["fra"] },
      expect.anything()
    );
  });

  it("passes pageSegMode option to the backend", async () => {
    const backend = makeDummyBackend();
    const engine = createOcrEngine({}, backend);
    await engine.recognize("/fake/image.png", { pageSegMode: 6 });
    expect(backend.recognizeImage).toHaveBeenCalledWith(
      "/fake/image.png",
      undefined,
      { pageSegMode: 6 },
      expect.anything()
    );
  });
});

describe("OcrEngine.recognizeBatch", () => {
  it("processes multiple images and returns results array", async () => {
    const backend = makeDummyBackend();
    const engine = createOcrEngine({}, backend);
    const results = await engine.recognizeBatch([
      "/fake/a.png",
      "/fake/b.png",
      Buffer.from([0x00]),
    ]);
    expect(results).toHaveLength(3);
    results.forEach((r) => expect(r.text).toBe("Bonjour le monde"));
    expect(backend.recognizeImage).toHaveBeenCalledTimes(3);
  });

  it("throws when images array is empty", async () => {
    const engine = createOcrEngine({}, makeDummyBackend());
    await expect(engine.recognizeBatch([])).rejects.toThrow(
      "images array must not be empty"
    );
  });

  it("throws when one of the images is an empty string", async () => {
    const engine = createOcrEngine({}, makeDummyBackend());
    await expect(engine.recognizeBatch(["/valid.png", ""])).rejects.toThrow(
      "image path must not be empty"
    );
  });
});

describe("Logger integration", () => {
  it("calls logger.debug on recognize", async () => {
    const logger: Logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const backend = makeDummyBackend();
    const engine = createOcrEngine({ logger }, backend);
    await engine.recognize("/fake/image.png");
    expect(logger.debug).toHaveBeenCalled();
  });
});

describe("DEFAULT_LANGUAGES", () => {
  it("includes fra and eng by default", () => {
    expect(DEFAULT_LANGUAGES).toContain("fra");
    expect(DEFAULT_LANGUAGES).toContain("eng");
  });
});

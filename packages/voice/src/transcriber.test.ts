import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTranscriber, DEFAULT_MODEL } from "./index.js";
import type { TranscriptionResult, Logger } from "./index.js";
import type { WhisperBackend } from "./whisper-backend.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_RESULT: TranscriptionResult = {
  text: "Bonjour le monde",
  language: "fr",
  segments: [{ start: 0, end: 1500, text: "Bonjour le monde" }],
  duration: 1500,
};

function makeDummyBackend(available = true): WhisperBackend {
  return {
    isAvailable: vi.fn().mockResolvedValue(available),
    transcribeFile: vi.fn().mockResolvedValue(MOCK_RESULT),
  };
}

async function createTempWav(): Promise<string> {
  const path = join(tmpdir(), `test-voice-${Date.now()}.wav`);
  // Minimal 44-byte WAV header (silent audio) — enough to pass file existence check
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.write("WAVE", 8);
  await writeFile(path, header);
  return path;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createTranscriber", () => {
  it("throws when modelDir is missing", () => {
    // @ts-expect-error — intentional invalid input
    expect(() => createTranscriber({})).toThrow("opts.modelDir is required");
  });

  it("returns an object with the expected interface", () => {
    const t = createTranscriber({ modelDir: "/tmp/models" }, makeDummyBackend());
    expect(typeof t.isAvailable).toBe("function");
    expect(typeof t.loadModel).toBe("function");
    expect(typeof t.transcribe).toBe("function");
    expect(typeof t.transcribeBuffer).toBe("function");
  });
});

describe("VoiceTranscriber.isAvailable", () => {
  it("returns true when backend is available", async () => {
    const t = createTranscriber({ modelDir: "/tmp/models" }, makeDummyBackend(true));
    await expect(t.isAvailable()).resolves.toBe(true);
  });

  it("returns false when backend is unavailable", async () => {
    const t = createTranscriber({ modelDir: "/tmp/models" }, makeDummyBackend(false));
    await expect(t.isAvailable()).resolves.toBe(false);
  });
});

describe("VoiceTranscriber.loadModel", () => {
  it("accepts the default model name", async () => {
    const t = createTranscriber({ modelDir: tmpdir() }, makeDummyBackend());
    await expect(t.loadModel()).resolves.toBeUndefined();
  });

  it("accepts a custom model name", async () => {
    const t = createTranscriber({ modelDir: tmpdir() }, makeDummyBackend());
    await expect(t.loadModel("whisper-small-q5_1")).resolves.toBeUndefined();
  });

  it("throws when model name is empty string", async () => {
    const t = createTranscriber({ modelDir: tmpdir() }, makeDummyBackend());
    await expect(t.loadModel("")).rejects.toThrow("modelName must not be empty");
  });
});

describe("VoiceTranscriber.transcribe", () => {
  let tmpWav: string;

  beforeEach(async () => {
    tmpWav = await createTempWav();
  });

  it("returns a TranscriptionResult with expected shape", async () => {
    const backend = makeDummyBackend();
    const t = createTranscriber({ modelDir: tmpdir() }, backend);
    const result = await t.transcribe(tmpWav);
    expect(result.text).toBe("Bonjour le monde");
    expect(result.language).toBe("fr");
    expect(result.segments).toHaveLength(1);
    expect(result.duration).toBe(1500);
  });

  it("passes language option to the backend", async () => {
    const backend = makeDummyBackend();
    const t = createTranscriber({ modelDir: tmpdir() }, backend);
    await t.transcribe(tmpWav, { language: "fr" });
    expect(backend.transcribeFile).toHaveBeenCalledWith(
      tmpWav,
      tmpdir(),
      DEFAULT_MODEL,
      { language: "fr" },
      expect.anything()
    );
  });

  it("throws when audioPath is empty", async () => {
    const t = createTranscriber({ modelDir: tmpdir() }, makeDummyBackend());
    await expect(t.transcribe("")).rejects.toThrow("audioPath must not be empty");
  });

  it("throws when audio file does not exist", async () => {
    const t = createTranscriber({ modelDir: tmpdir() }, makeDummyBackend());
    await expect(t.transcribe("/nonexistent/file.wav")).rejects.toThrow(
      "Audio file not found"
    );
  });
});

describe("VoiceTranscriber.transcribeBuffer", () => {
  it("rejects an empty buffer", async () => {
    const t = createTranscriber({ modelDir: tmpdir() }, makeDummyBackend());
    await expect(t.transcribeBuffer(new ArrayBuffer(0))).rejects.toThrow(
      "buffer must not be empty"
    );
  });

  it("returns a TranscriptionResult from a non-empty buffer", async () => {
    const backend = makeDummyBackend();
    const t = createTranscriber({ modelDir: tmpdir() }, backend);
    // We inject a backend mock so the actual file write + delete still runs
    // but the whisper call is mocked — the backend.transcribeFile receives the tmp path.
    const buf = new ArrayBuffer(44);
    const result = await t.transcribeBuffer(buf);
    expect(result.text).toBe("Bonjour le monde");
    expect(backend.transcribeFile).toHaveBeenCalled();
  });
});

describe("Logger integration", () => {
  it("calls logger.info on loadModel", async () => {
    const logger: Logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const t = createTranscriber({ modelDir: tmpdir(), logger }, makeDummyBackend());
    await t.loadModel();
    expect(logger.info).toHaveBeenCalled();
  });
});

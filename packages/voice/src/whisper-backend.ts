import { existsSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type {
  TranscribeOptions,
  TranscriptionResult,
  TranscriptionSegment,
  Logger,
} from "./types.js";

/** Default quantized model name (~50 MB, supports FR + EN). */
export const DEFAULT_MODEL = "whisper-base-q5_1";

// ---------------------------------------------------------------------------
// Shape of the JSON output that nodejs-whisper writes when outputInJsonFull
// is enabled. Only the fields we need are declared.
// ---------------------------------------------------------------------------
interface WhisperJsonSegment {
  start: number;
  end: number;
  text: string;
}

interface WhisperJsonResult {
  language?: string;
  segments?: WhisperJsonSegment[];
  text?: string;
}

/** Parse the raw JSON string returned by nodejs-whisper. */
function parseWhisperOutput(raw: string): TranscriptionResult {
  let parsed: WhisperJsonResult = {};

  try {
    parsed = JSON.parse(raw) as WhisperJsonResult;
  } catch {
    // nodejs-whisper may return plain text when JSON output is unavailable
    return {
      text: raw.trim(),
      language: "unknown",
      segments: [],
      duration: 0,
    };
  }

  const segments: TranscriptionSegment[] = (parsed.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
  }));

  const text =
    parsed.text?.trim() ?? segments.map((s) => s.text).join(" ").trim();

  const last = segments[segments.length - 1];
  const duration = last?.end ?? 0;

  return {
    text,
    language: parsed.language ?? "unknown",
    segments,
    duration,
  };
}

/** nodejs-whisper IOptions subset we actually use. */
interface NodeWhisperOptions {
  modelName: string;
  modelRootPath?: string;
  whisperOptions?: {
    outputInJsonFull?: boolean;
    language?: string;
    translateToEnglish?: boolean;
  };
}

/** Attempt a dynamic import of nodejs-whisper. Returns null when unavailable. */
async function tryImportWhisper(): Promise<
  ((path: string, opts: NodeWhisperOptions) => Promise<string>) | null
> {
  try {
    const mod = await import("nodejs-whisper");
    const fn = (mod as { nodewhisper?: unknown }).nodewhisper;
    if (typeof fn === "function")
      return fn as (path: string, opts: NodeWhisperOptions) => Promise<string>;
    return null;
  } catch {
    return null;
  }
}

/** Build the IOptions object passed to nodejs-whisper. */
function buildWhisperOptions(
  modelDir: string,
  modelName: string,
  opts: TranscribeOptions
): NodeWhisperOptions {
  const lang = opts.language === "auto" ? undefined : opts.language;

  return {
    modelName,
    modelRootPath: modelDir,
    whisperOptions: {
      outputInJsonFull: true,
      language: lang,
      translateToEnglish: opts.translate ?? false,
    },
  };
}

// ---------------------------------------------------------------------------
// Public backend interface
// ---------------------------------------------------------------------------

export interface WhisperBackend {
  isAvailable(): Promise<boolean>;
  transcribeFile(
    audioPath: string,
    modelDir: string,
    modelName: string,
    opts: TranscribeOptions,
    logger: Logger
  ): Promise<TranscriptionResult>;
}

export function createWhisperBackend(): WhisperBackend {
  // undefined = not yet resolved; null = unavailable
  let _whisper:
    | ((path: string, opts: NodeWhisperOptions) => Promise<string>)
    | null
    | undefined = undefined;

  return {
    async isAvailable(): Promise<boolean> {
      if (_whisper === undefined) _whisper = await tryImportWhisper();
      return _whisper !== null;
    },

    async transcribeFile(
      audioPath: string,
      modelDir: string,
      modelName: string,
      opts: TranscribeOptions,
      logger: Logger
    ): Promise<TranscriptionResult> {
      if (_whisper === undefined) _whisper = await tryImportWhisper();
      if (!_whisper) throw new Error("nodejs-whisper is not available");

      logger.debug(`Transcribing ${audioPath} with model ${modelName}`);
      const whisperOpts = buildWhisperOptions(modelDir, modelName, opts);
      const raw = await _whisper(audioPath, whisperOpts);
      return parseWhisperOutput(raw);
    },
  };
}

/** Write an ArrayBuffer to a temp WAV file, transcribe it, then clean up. */
export async function transcribeBufferViaFile(
  backend: WhisperBackend,
  buffer: ArrayBuffer,
  modelDir: string,
  modelName: string,
  opts: TranscribeOptions,
  logger: Logger
): Promise<TranscriptionResult> {
  const tmpPath = join(tmpdir(), `supernote-voice-${randomUUID()}.wav`);
  await writeFile(tmpPath, Buffer.from(buffer));

  try {
    return await backend.transcribeFile(tmpPath, modelDir, modelName, opts, logger);
  } finally {
    await unlink(tmpPath).catch(() => undefined);
  }
}

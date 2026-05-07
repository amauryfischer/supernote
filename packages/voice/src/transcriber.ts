import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type {
  VoiceTranscriber,
  TranscribeOptions,
  TranscriptionResult,
  TranscriberOptions,
  Logger,
} from "./types.js";
import {
  DEFAULT_MODEL,
  createWhisperBackend,
  transcribeBufferViaFile,
  type WhisperBackend,
} from "./whisper-backend.js";

/** No-op logger used when none is provided. */
const NOOP_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

/**
 * Concrete implementation of VoiceTranscriber backed by nodejs-whisper.
 */
class WhisperTranscriber implements VoiceTranscriber {
  private readonly modelDir: string;
  private readonly logger: Logger;
  private readonly backend: WhisperBackend;
  private currentModel: string = DEFAULT_MODEL;

  constructor(opts: TranscriberOptions, backend: WhisperBackend) {
    this.modelDir = opts.modelDir;
    this.logger = opts.logger ?? NOOP_LOGGER;
    this.backend = backend;
  }

  async isAvailable(): Promise<boolean> {
    return this.backend.isAvailable();
  }

  async loadModel(modelName: string = DEFAULT_MODEL): Promise<void> {
    if (!modelName) throw new Error("modelName must not be empty");
    this.currentModel = modelName;
    await mkdir(this.modelDir, { recursive: true });
    this.logger.info(`Model set to ${this.currentModel} in ${this.modelDir}`);
  }

  async transcribe(
    audioPath: string,
    opts: TranscribeOptions = {}
  ): Promise<TranscriptionResult> {
    if (!audioPath) throw new Error("audioPath must not be empty");
    if (!existsSync(audioPath))
      throw new Error(`Audio file not found: ${audioPath}`);

    return this.backend.transcribeFile(
      audioPath,
      this.modelDir,
      this.currentModel,
      opts,
      this.logger
    );
  }

  async transcribeBuffer(
    buffer: ArrayBuffer,
    opts: TranscribeOptions = {}
  ): Promise<TranscriptionResult> {
    if (!buffer || buffer.byteLength === 0)
      throw new Error("buffer must not be empty");

    return transcribeBufferViaFile(
      this.backend,
      buffer,
      this.modelDir,
      this.currentModel,
      opts,
      this.logger
    );
  }
}

/**
 * Factory that creates a VoiceTranscriber backed by whisper.cpp via nodejs-whisper.
 *
 * @param opts.modelDir  Directory where Whisper GGUF models are stored/downloaded.
 * @param opts.logger    Optional structured logger (pino-compatible).
 * @param backend        Optional backend override (used in tests).
 */
export function createTranscriber(
  opts: TranscriberOptions,
  backend?: WhisperBackend
): VoiceTranscriber {
  if (!opts.modelDir) throw new Error("opts.modelDir is required");
  return new WhisperTranscriber(opts, backend ?? createWhisperBackend());
}

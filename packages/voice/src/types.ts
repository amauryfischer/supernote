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
 * A single time-stamped segment of transcribed speech.
 */
export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Full result returned by a transcription call.
 */
export interface TranscriptionResult {
  text: string;
  language: string;
  segments: TranscriptionSegment[];
  duration: number;
}

/**
 * Options passed to individual transcription calls.
 */
export interface TranscribeOptions {
  language?: "fr" | "en" | "auto";
  translate?: boolean;
}

/**
 * Public API surface of a voice transcriber.
 */
export interface VoiceTranscriber {
  isAvailable(): Promise<boolean>;
  loadModel(modelName?: string): Promise<void>;
  transcribe(
    audioPath: string,
    opts?: TranscribeOptions
  ): Promise<TranscriptionResult>;
  transcribeBuffer(
    buffer: ArrayBuffer,
    opts?: TranscribeOptions
  ): Promise<TranscriptionResult>;
}

/**
 * Options passed to createTranscriber().
 */
export interface TranscriberOptions {
  modelDir: string;
  logger?: Logger;
}

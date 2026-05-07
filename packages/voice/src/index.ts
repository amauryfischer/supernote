/**
 * @supernote/voice — Whisper-based voice transcription.
 *
 * Quick start:
 *   const t = createTranscriber({ modelDir: '/tmp/models' });
 *   await t.loadModel();
 *   const result = await t.transcribe('/path/to/audio.wav');
 */

export type {
  VoiceTranscriber,
  TranscriptionResult,
  TranscriptionSegment,
  TranscribeOptions,
  TranscriberOptions,
  Logger,
} from "./types.js";

export { createTranscriber } from "./transcriber.js";
export { DEFAULT_MODEL, createWhisperBackend } from "./whisper-backend.js";
export type { WhisperBackend } from "./whisper-backend.js";

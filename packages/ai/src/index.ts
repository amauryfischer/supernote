// ============================================================
// @supernote/ai — Main entry point
// ============================================================

export * from "./ollama/index.js";
export * from "./auto-tag/index.js";
export * from "./classifier/index.js";
export * from "./extract/index.js";
export * as prompts from "./prompts/index.js";
export { cosineSimilarity } from "./utils/cosine.js";
export * as actions from "./actions/index.js";

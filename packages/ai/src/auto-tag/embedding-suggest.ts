// ============================================================
// Embedding-based tag suggestion (cosine similarity fallback)
// ============================================================

import type { AutoTagInput, AutoTagSuggestion, EmbeddingEngine, TagInfo } from "./types.js";
import { cosineSimilarity } from "../utils/cosine.js";

const DEFAULT_SIMILARITY_THRESHOLD = 0.45;

/**
 * Embed a TagInfo text representation for comparison.
 */
function buildTagText(tag: TagInfo): string {
  const parts = [tag.path.replace("/", " ")];
  if (tag.description) parts.push(tag.description);
  if (tag.recentEntities && tag.recentEntities.length > 0) {
    parts.push(tag.recentEntities.slice(0, 3).join(", "));
  }
  return parts.join(". ");
}

export async function embeddingSuggest(
  input: AutoTagInput,
  engine: EmbeddingEngine,
  threshold = DEFAULT_SIMILARITY_THRESHOLD,
): Promise<AutoTagSuggestion[]> {
  const { noteContent, noteTitle, existingTags } = input;
  if (existingTags.length === 0) return [];

  const noteText = noteTitle
    ? `${noteTitle}\n\n${noteContent}`
    : noteContent;

  const noteEmbedding = await engine.embed(noteText);

  const results: Array<{ tag: TagInfo; similarity: number }> = [];

  for (const tag of existingTags) {
    let tagEmbedding: Float32Array;
    if (tag.embedding) {
      tagEmbedding = tag.embedding;
    } else {
      tagEmbedding = await engine.embed(buildTagText(tag));
    }
    const similarity = cosineSimilarity(noteEmbedding, tagEmbedding);
    if (similarity >= threshold) {
      results.push({ tag, similarity });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);

  return results.map(({ tag, similarity }) => ({
    tag: tag.path,
    confidence: Math.min(similarity, 1.0),
    reason: "embedding-similarity" as const,
    source: "embedding" as const,
  }));
}

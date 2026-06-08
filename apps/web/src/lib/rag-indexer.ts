/**
 * RAG indexer — embeds note bodies+titles via Ollama and stores the result
 * as `entity.fields.embedding` (JSON-encoded number array).
 */

import { trpcVanillaClient } from "@/lib/trpc/client";
import { embedQuery, encodeEmbeddingField, parseEmbeddingField, DEFAULT_EMBED_MODEL } from "@/lib/rag";
import { OLLAMA_HOST_KEY, DEFAULT_OLLAMA_HOST } from "@/hooks/useAutoTitle";
import type { EntitySummary } from "@supernote/ipc";

export interface RunIndexOptions {
  onProgress?: (done: number, total: number) => void;
  host?: string;
  model?: string;
  /** Re-embed notes that already have an embedding */
  force?: boolean;
}

export interface IndexResult {
  indexed: number;
  skipped: number;
  failed: number;
  /** Message de la première erreur d'embedding (diagnostic UI). */
  firstError?: string;
}

function resolveHost(override?: string): string {
  if (override) return override;
  if (typeof window === "undefined") return DEFAULT_OLLAMA_HOST;
  try {
    const stored = window.localStorage.getItem(OLLAMA_HOST_KEY);
    if (stored?.trim()) return stored.trim();
  } catch {
    /* ignore */
  }
  return DEFAULT_OLLAMA_HOST;
}

type IndexOutcome =
  | { kind: "indexed" }
  | { kind: "skipped" }
  | { kind: "failed"; error: string };

async function indexNote(
  note: EntitySummary,
  host: string,
  model: string,
  force: boolean,
): Promise<IndexOutcome> {
  const existing = parseEmbeddingField(note.fields["embedding"]);
  if (existing && !force) return { kind: "skipped" };

  const titleField = note.fields["title"];
  const title = typeof titleField === "string" ? titleField : note.filePath;
  const text = [title, note.body ?? ""].filter(Boolean).join("\n\n");
  if (!text.trim()) return { kind: "skipped" };

  try {
    const vec = await embedQuery(text, host, model);
    await trpcVanillaClient.entities.update.mutate({
      id: note.id,
      fields: { ...note.fields, embedding: encodeEmbeddingField(vec) },
    });
    return { kind: "indexed" };
  } catch (e) {
    return { kind: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function runIndex(opts: RunIndexOptions = {}): Promise<IndexResult> {
  const host = resolveHost(opts.host);
  const model = opts.model ?? DEFAULT_EMBED_MODEL;
  const { onProgress, force = false } = opts;

  const listResult = await trpcVanillaClient.entities.list.query({
    limit: 5000,
    offset: 0,
  });

  const notes = listResult.items;
  const total = notes.length;
  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  let firstError: string | undefined;

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (!note) {
      skipped++;
      onProgress?.(i + 1, total);
      continue;
    }

    const outcome = await indexNote(note, host, model, force);
    if (outcome.kind === "indexed") indexed++;
    else if (outcome.kind === "skipped") skipped++;
    else {
      failed++;
      if (!firstError) firstError = outcome.error;
    }

    onProgress?.(i + 1, total);
  }

  return { indexed, skipped, failed, firstError };
}

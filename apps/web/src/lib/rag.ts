/**
 * RAG helpers — pure functions for embedding, similarity, and streaming chat.
 * No React deps. Calls Ollama directly from the browser.
 */

export const DEFAULT_EMBED_MODEL = "nomic-embed-text";

const REQUEST_TIMEOUT_MS = 30_000;

// ── Embedding ──────────────────────────────────────────────────────────────

interface EmbedResponse {
  embedding?: number[];
  embeddings?: number[][];
}

export async function embedQuery(
  text: string,
  host: string,
  model: string,
): Promise<number[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${host}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: text }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`Ollama embed HTTP ${res.status}`);
    const data = (await res.json()) as EmbedResponse;
    const vec = data.embeddings?.[0] ?? data.embedding;
    if (!vec || vec.length === 0) throw new Error("Empty embedding from Ollama");
    return vec;
  } finally {
    clearTimeout(timer);
  }
}

// ── Cosine similarity ─────────────────────────────────────────────────────

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Embedding field serialization ─────────────────────────────────────────

export function parseEmbeddingField(raw: unknown): number[] | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "number") {
        return parsed as number[];
      }
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "number") {
    return raw as number[];
  }
  return null;
}

export function encodeEmbeddingField(vec: number[]): string {
  return JSON.stringify(vec);
}

// ── Chat streaming ────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface StreamChunk {
  message?: { content?: string };
  done?: boolean;
}

export async function chatStream(
  host: string,
  model: string,
  messages: ChatMessage[],
  onToken: (chunk: string) => void,
): Promise<void> {
  const ac = new AbortController();
  const res = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
    signal: ac.signal,
  });
  if (!res.ok) throw new Error(`Ollama chat HTTP ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const chunk = JSON.parse(trimmed) as StreamChunk;
        const delta = chunk.message?.content;
        if (delta) onToken(delta);
        if (chunk.done) return;
      } catch {
        // partial JSON line — skip
      }
    }
  }
}

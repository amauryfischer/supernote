/**
 * aiVerify — ask local Ollama whether each detected checklist line is
 * actually a todo (action to do) or rhetorical filler (examples, lists,
 * a "vu/lu/à voir" enumeration, etc).
 *
 * Re-uses the host + model + probe helpers from `useAutoTitle` so settings
 * stay co-located. Never throws — falls back to "all are todos" on any
 * failure (network, parse error, model not pulled).
 *
 * No npm deps. Browser fetch only.
 */

import {
  AUTO_TITLE_MODEL_KEY,
  readOllamaHost,
} from "@/hooks/useAutoTitle";

const REQUEST_TIMEOUT_MS = 20_000;
const FALLBACK_MODEL = "llama3.2:1b";
const MAX_ITEMS = 50;

export interface VerifyInput {
  /** Stable line index in the source note (forwarded back as-is). */
  line: number;
  /** The text of the checklist item (already trimmed). */
  text: string;
}

export interface VerifyResult {
  line: number;
  text: string;
  /** True iff this line should be surfaced as a todo. */
  isTodo: boolean;
}

function readPreferredModel(): string {
  if (typeof window === "undefined") return FALLBACK_MODEL;
  try {
    return window.localStorage.getItem(AUTO_TITLE_MODEL_KEY) ?? FALLBACK_MODEL;
  } catch {
    return FALLBACK_MODEL;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Build the bullet list passed to the LLM. We number items 1..N and pair
 * them with the original `line` index in the parser output so the model's
 * answers can be remapped without ambiguity even if the model hallucinates
 * extra entries (we drop those).
 */
function buildPrompt(items: VerifyInput[]): string {
  const list = items
    .map((it, idx) => `${idx}. ${it.text}`)
    .join("\n");
  return [
    "Voici une liste de cases à cocher extraites d'une note. Pour chaque case, dis si c'est une vraie todo (action concrète à faire) ou pas (liste rhétorique, exemples, etc.).",
    'Réponds UNIQUEMENT avec un tableau JSON: [{"line": 0, "isTodo": true, "text": "..."}, ...]',
    "",
    "Cases:",
    list,
  ].join("\n");
}

/**
 * Best-effort parse of the LLM response. Tries to extract a JSON array
 * even when wrapped in code fences or trailing prose; falls back to
 * "everything is a todo" on parse failure.
 */
function parseResponse(raw: string, items: VerifyInput[]): VerifyResult[] | null {
  if (!raw) return null;
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return null;
    // Build a map keyed by the *prompt index* (0..N-1) since some models
    // echo back the prompt's local index instead of our `line`. We accept
    // either, but prefer prompt-index when both look valid.
    const byPromptIdx = new Map<number, boolean>();
    const byLine = new Map<number, boolean>();
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as { line?: unknown; isTodo?: unknown };
      const idx = typeof obj.line === "number" ? obj.line : NaN;
      const isTodo = obj.isTodo === true;
      if (Number.isFinite(idx)) {
        if (idx >= 0 && idx < items.length) byPromptIdx.set(idx, isTodo);
        byLine.set(idx, isTodo);
      }
    }

    const out: VerifyResult[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      // Prefer prompt-idx match; fall back to original line; default true
      // (be permissive — better to surface a non-todo than drop a real one).
      const verdict =
        byPromptIdx.has(i)
          ? byPromptIdx.get(i)!
          : byLine.has(item.line)
            ? byLine.get(item.line)!
            : true;
      out.push({ line: item.line, text: item.text, isTodo: verdict });
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Ask the LLM to filter the checklist items.
 *
 * Returns one VerifyResult per input item (same order). On any failure
 * (Ollama down, CORS, model not pulled, parse error) we return the items
 * as if they were all real todos — best-effort fallback so the feature
 * keeps working without the LLM.
 */
export async function aiVerifyTodos(
  items: VerifyInput[],
): Promise<VerifyResult[]> {
  if (items.length === 0) return [];
  if (items.length > MAX_ITEMS) {
    // Avoid prompts that explode the context window; truncate and treat
    // the overflow as todos.
    const head = items.slice(0, MAX_ITEMS);
    const tail = items.slice(MAX_ITEMS);
    const verified = await aiVerifyTodos(head);
    return [
      ...verified,
      ...tail.map((it) => ({ line: it.line, text: it.text, isTodo: true })),
    ];
  }

  const fallback = (): VerifyResult[] =>
    items.map((it) => ({ line: it.line, text: it.text, isTodo: true }));

  const prompt = buildPrompt(items);
  try {
    const host = readOllamaHost();
    const model = readPreferredModel();
    const res = await fetchWithTimeout(
      `${host}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.1 },
        }),
      },
      REQUEST_TIMEOUT_MS,
    );
    if (!res.ok) return fallback();
    const data = (await res.json()) as { response?: string };
    const parsed = parseResponse(data.response ?? "", items);
    return parsed ?? fallback();
  } catch {
    return fallback();
  }
}

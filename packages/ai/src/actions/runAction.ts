// ============================================================
// runAction — orchestrateur async generator pour actions IA
// ============================================================

import type { OllamaClient } from "../ollama/types.js";
import type { AIActionInput, AIActionChunk, AIActionId } from "./types.js";
import { AI_SYSTEM_PROMPT, renderPrompt } from "./prompts.js";

export type PromptResolver = (id: AIActionId) => Promise<string>;

export interface RunActionDeps {
  ollama: OllamaClient;
  promptResolver: PromptResolver;
}

/**
 * Strip une fence markdown en tête/queue (```...```) que les LLMs ajoutent
 * parfois malgré le system prompt strict. Conserve le contenu interne tel quel.
 */
function makeFenceStripper(): (chunk: string) => string {
  let leadingTrimmed = false;
  let buffer = "";

  return (chunk: string) => {
    let out = "";
    if (!leadingTrimmed) {
      buffer += chunk;
      const trimmed = buffer.trimStart();
      if (trimmed.startsWith("```")) {
        const nl = trimmed.indexOf("\n");
        if (nl === -1) {
          return ""; // attend la fin du fence open
        }
        buffer = trimmed.slice(nl + 1);
      } else {
        buffer = trimmed;
      }
      leadingTrimmed = true;
      out = buffer;
      buffer = "";
      return out;
    }
    return chunk;
  };
}

function stripTrailingFence(text: string): string {
  // Removes a trailing ``` (possibly with surrounding whitespace) if present.
  return text.replace(/\n?```\s*$/, "");
}

export async function* runAction(
  input: AIActionInput,
  deps: RunActionDeps,
): AsyncIterable<AIActionChunk> {
  let template: string;
  try {
    template = await deps.promptResolver(input.actionId);
  } catch (err) {
    yield {
      type: "error",
      code: "prompt_resolve_failed",
      message: err instanceof Error ? err.message : String(err),
    };
    return;
  }

  const userPrompt = renderPrompt(template, {
    selection: input.selection,
    noteTitle: input.context.noteTitle ?? "",
    parentBlock: input.context.parentBlock ?? "",
    targetLanguage: input.params?.targetLanguage ?? "",
    tone: input.params?.tone ?? "",
    customPrompt: input.params?.customPrompt ?? "",
  });

  const stripFence = makeFenceStripper();
  // Buffer to hold pending delta chunks — allows trailing fence stripping
  // before emitting. We keep the last two chunks buffered so we can detect
  // and suppress a trailing ``` that arrives as its own chunk.
  const pending: string[] = [];

  function flushPending(): { type: "delta"; text: string } | null {
    if (pending.length === 0) return null;
    const text = pending.join("");
    pending.length = 0;
    if (!text) return null;
    return { type: "delta", text };
  }

  try {
    for await (const chunk of deps.ollama.chat({
      messages: [
        { role: "system", content: AI_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
    })) {
      if (chunk.content) {
        const stripped = stripFence(chunk.content);
        if (stripped) {
          // Flush previous pending before buffering new content
          const flushed = flushPending();
          if (flushed) yield flushed;
          pending.push(stripped);
        }
      }
      if (chunk.done) break;
    }
  } catch (err) {
    yield {
      type: "error",
      code: "ollama_chat_failed",
      message: err instanceof Error ? err.message : String(err),
    };
    return;
  }

  // Strip trailing fence from buffered content before final yield
  if (pending.length > 0) {
    const raw = pending.join("");
    const stripped = stripTrailingFence(raw);
    if (stripped) {
      yield { type: "delta", text: stripped };
    }
  }

  yield { type: "done" };
}

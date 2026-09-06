/**
 * Run an AI column prompt against the local Ollama server.
 *
 * Le prompt peut contenir des placeholders `{fieldName}` qui sont remplacés
 * par les valeurs courantes de la ligne. La sortie est typée selon
 * `outputKind` (number → parse number, bool → parse oui/non, etc.).
 */

import type { Field } from "@supernote/core";
import { getAiSettings } from "./settings";

const REQUEST_TIMEOUT_MS = 60_000;

async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit,
  ms: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

export interface AIRunInput {
  prompt: string;
  outputKind: "text" | "longtext" | "number" | "bool" | "select";
  model?: string;
  rowFields: Record<string, unknown>;
  fieldDefs: Field[];
}

export interface AIRunResult {
  value: unknown;
  raw: string;
}

/** Substitue `{fieldName}` par la valeur correspondante. */
export function interpolatePrompt(
  template: string,
  rowFields: Record<string, unknown>,
  fieldDefs: Field[],
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name: string) => {
    const def = fieldDefs.find((f) => f.name === name || f.id === name);
    if (!def) return "";
    const v = rowFields[def.id];
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return v.join(", ");
    return String(v);
  });
}

/** Parse la sortie brute selon `outputKind`. */
function parseOutput(raw: string, kind: AIRunInput["outputKind"]): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (kind === "number") {
    const cleaned = trimmed.replace(/[^\d.\-,]/g, "").replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  if (kind === "bool") {
    const lo = trimmed.toLowerCase();
    if (["true", "oui", "yes", "1", "vrai"].includes(lo)) return true;
    if (["false", "non", "no", "0", "faux"].includes(lo)) return false;
    return null;
  }
  // text / longtext / select renvoient la chaîne nettoyée
  return trimmed;
}

export async function runAIColumn(input: AIRunInput): Promise<AIRunResult> {
  const ai = getAiSettings();
  const model = input.model || ai.model;
  if (!model) throw new Error("Aucun modèle Ollama configuré");
  const prompt = interpolatePrompt(input.prompt, input.rowFields, input.fieldDefs);

  const res = await fetchWithTimeout(
    `${ai.baseUrl}/api/generate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        // Pas de raisonnement (Qwen3.5 & co) et modèle maintenu en
        // VRAM : sinon chaque appel repaie ~15 s de rechargement.
        think: false,
        keep_alive: "2h",
        options: { temperature: 0.2 },
      }),
    },
    REQUEST_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(`Ollama ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { response?: string };
  const raw = (data.response ?? "").trim();
  return { value: parseOutput(raw, input.outputKind), raw };
}

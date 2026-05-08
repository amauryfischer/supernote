"use client";

/**
 * useAutoTag — auto-suggest tags for a note via local Ollama, constrained
 * to the user's *existing* tag vocabulary.
 *
 * Mirrors the architecture of `useAutoTitle.ts`:
 *   - Browser talks directly to Ollama at http://localhost:11434 (no proxy).
 *   - Ollama must allow CORS: `OLLAMA_ORIGINS=* ollama serve`.
 *   - One probe per mount; result cached LRU on (model, body-hash, tags-hash, folder).
 *   - `suggest(body, existingTags, folderPath?, currentTags?)` returns string[]
 *     or [] on any failure / no match. The model is told to PICK from `existingTags`
 *     and we additionally filter the response client-side (case-insensitive)
 *     to drop any hallucinated tag the model invents anyway.
 *   - If `existingTags` is empty we skip the LLM call entirely (no point
 *     asking the model to pick from a list of zero options).
 *   - Never throws — fail-silent so the editor keeps working without Ollama.
 *
 * Re-uses the *exact* probe + host helpers from useAutoTitle so settings
 * (host override, model selection, CORS warning) stay in one place.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUTO_TITLE_MODEL_KEY,
  probeOllama,
  readOllamaHost,
} from "./useAutoTitle";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_CHARS = 2_000;
const CACHE_MAX_ENTRIES = 50;
const MAX_TAGS = 5;

const ENABLED_KEY = "supernote.ai.autoTag";
const FALLBACK_MODEL = "llama3.2:1b";

/** Read the user-configured model — same key as useAutoTitle so settings co-locate. */
function readPreferredModel(): string {
  if (typeof window === "undefined") return FALLBACK_MODEL;
  try {
    return window.localStorage.getItem(AUTO_TITLE_MODEL_KEY) ?? FALLBACK_MODEL;
  } catch {
    return FALLBACK_MODEL;
  }
}

/** Read the user's "auto-tag" toggle from localStorage. Default: false (opt-in). */
export function isAutoTagEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export const AUTO_TAG_ENABLED_KEY = ENABLED_KEY;

/** Trim + lowercase. We DON'T canonicalize further (no slug/hyphen rewrite)
 *  because the model is asked to pick *exact* paths from `existingTags` and
 *  paths can legitimately contain "/" separators, accents, etc. */
function normalizeForMatch(raw: string): string {
  return raw.trim().toLowerCase().replace(/^#+/, "");
}

/**
 * Best-effort parse of an LLM response into a raw string[] of candidate tags.
 * Tries JSON first, falls back to line-/comma-splitting because small
 * models often ignore "JSON only" instructions. The caller is responsible
 * for filtering against the existing-tag vocabulary.
 */
function parseTags(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: unknown) => {
    if (typeof s !== "string") return;
    const t = s.trim().replace(/^#+/, "").trim();
    if (!t) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };

  // 1) Try to extract a JSON array even if wrapped in prose / code fences.
  const match = raw.match(/\[[\s\S]*?\]/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) push(item);
        if (out.length >= 1) return out.slice(0, MAX_TAGS);
      }
    } catch {
      /* fall through to line parsing */
    }
  }

  // 2) Line / comma fallback for models that just return prose lists.
  const tokens = raw
    .split(/[\n,;]+/)
    .map((s) => s.replace(/^[\s\-*\d.)\]]+/, "").trim())
    .filter(Boolean);
  for (const tok of tokens) push(tok);
  return out.slice(0, MAX_TAGS);
}

/**
 * Drop any candidate tag that doesn't appear (case-insensitive) in the
 * `existingTags` vocabulary. Returns the *canonical* path from `existingTags`
 * (preserving the user's casing), not the LLM's spelling. This is the
 * hallucination guard: even if the model invents a new tag, it can't reach
 * the note state.
 */
function filterToExisting(
  candidates: string[],
  existingTags: string[],
): string[] {
  if (existingTags.length === 0) return [];
  const lookup = new Map<string, string>();
  for (const t of existingTags) {
    lookup.set(normalizeForMatch(t), t);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const canonical = lookup.get(normalizeForMatch(c));
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Cheap stable hash for cache keys. Includes the existing-tag list because
 *  changing the vocabulary changes the legal answer set, and the folder path
 *  because moving a note between folders changes the contextual hint we feed
 *  the model — re-evaluating is the right behaviour. */
function hashBody(
  body: string,
  model: string,
  existingTags: string[],
  folderPath?: string,
): string {
  let h = 5381;
  const tagsKey = [...existingTags].sort().join("|");
  const folderKey = folderPath ?? "";
  const s = `${model}::${tagsKey}::${folderKey}::${body.slice(0, MAX_BODY_CHARS)}`;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

const cache = new Map<string, string[]>();
function cacheGet(key: string): string[] | undefined {
  const v = cache.get(key);
  if (v !== undefined) {
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}
function cacheSet(key: string, value: string[]): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
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

export interface UseAutoTagResult {
  /** True once a probe of /api/tags has succeeded. False until probed or on failure. */
  isAvailable: boolean;
  /** True while the very first probe is in-flight. */
  isProbing: boolean;
  /**
   * Suggest tags drawn EXCLUSIVELY from `existingTags`. The model is asked
   * to pick 0..MAX_TAGS items from the provided vocabulary; the response is
   * additionally filtered client-side (case-insensitive) so any hallucinated
   * tag is dropped. Returns [] on any error, no match, or empty vocabulary.
   */
  suggest: (
    body: string,
    existingTags: string[],
    folderPath?: string,
    currentTags?: string[],
  ) => Promise<string[]>;
}

export function useAutoTag(): UseAutoTagResult {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isProbing, setIsProbing] = useState(true);
  const probedRef = useRef(false);

  // Single probe on mount — same shape as useAutoTitle.
  useEffect(() => {
    if (probedRef.current) return;
    probedRef.current = true;
    let cancelled = false;
    (async () => {
      const result = await probeOllama();
      if (cancelled) return;
      setIsAvailable(result.status === "ok");
      setIsProbing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const suggest = useCallback(
    async (
      body: string,
      existingTags: string[],
      folderPath?: string,
      currentTags?: string[],
    ): Promise<string[]> => {
      const trimmed = body.trim();
      if (trimmed.length < 30) return [];
      // Don't overwrite manual tags — caller should also enforce, but we double-check.
      if (currentTags && currentTags.length > 0) return [];
      // No vocabulary → nothing to pick from. Skip the LLM call entirely.
      if (!existingTags || existingTags.length === 0) {
        if (typeof console !== "undefined") {
          console.info("[autoTag] no tags configured, skipping");
        }
        return [];
      }

      const model = readPreferredModel();
      // "Inbox" is the default unsorted folder — feeding it as context would
      // bias the model toward generic tags. Treat it the same as undefined.
      const usefulFolder =
        folderPath && folderPath.trim() && folderPath.trim() !== "Inbox"
          ? folderPath.trim()
          : undefined;
      const key = hashBody(trimmed, model, existingTags, usefulFolder);
      const hit = cacheGet(key);
      if (hit !== undefined) return hit;

      const tagsList = existingTags.map((t) => `- ${t}`).join("\n");
      const promptLines: string[] = [
        "Voici la liste des tags disponibles:",
        tagsList,
        "",
      ];
      if (usefulFolder) {
        promptLines.push(
          `La note se trouve dans le dossier: ${usefulFolder}`,
          "",
          `À partir du contenu suivant ET du contexte du dossier, choisis 0 à ${MAX_TAGS} tags PARMI cette liste qui correspondent.`,
          "Les sous-dossiers donnent un indice (ex: une note dans 'Travail/2026/Q1' est probablement liée au travail).",
        );
      } else {
        promptLines.push(
          `À partir du contenu suivant, choisis 0 à ${MAX_TAGS} tags PARMI cette liste qui correspondent.`,
        );
      }
      promptLines.push(
        "Réponds UNIQUEMENT avec un tableau JSON des tags choisis (paths exacts), sans explication.",
        "Si aucun tag ne convient, retourne [].",
        "",
        "Contenu:",
        trimmed.slice(0, MAX_BODY_CHARS),
      );
      const prompt = promptLines.join("\n");

      try {
        const host = readOllamaHost();
        const res = await fetchWithTimeout(
          `${host}/api/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              prompt,
              stream: false,
              options: { temperature: 0.2 },
            }),
          },
          REQUEST_TIMEOUT_MS,
        );
        if (!res.ok) return [];
        const data = (await res.json()) as { response?: string };
        const candidates = parseTags(data.response ?? "");
        // Hard guard: drop anything not in the existing vocabulary. Even a
        // perfectly-instructed model occasionally invents tags.
        const tags = filterToExisting(candidates, existingTags);
        if (tags.length === 0) {
          // Cache the empty result too — saves a round-trip if the body
          // and vocabulary haven't changed.
          cacheSet(key, []);
          return [];
        }
        cacheSet(key, tags);
        return tags;
      } catch {
        // Fail silently — same policy as useAutoTitle.
        return [];
      }
    },
    [],
  );

  return { isAvailable, isProbing, suggest };
}

"use client";

/**
 * useAutoTitle — auto-generate a note title from its body via local Ollama.
 *
 * The browser talks directly to Ollama at http://localhost:11434 (no Electron,
 * no backend proxy). Ollama must allow CORS — see README/setup tip:
 *     OLLAMA_ORIGINS=* ollama serve
 *
 * Behaviour:
 *  - `isAvailable` resolves once on mount (HEAD-ish GET /api/tags).
 *  - `suggest(body, currentTitle?)` calls /api/generate with stream:false.
 *    Returns the cleaned title (max 60 chars), or null on any failure.
 *  - Results are LRU-cached on a body-hash to avoid re-querying for the
 *    same content (saves cycles when the user edits then reverts).
 *
 * No npm deps. Native fetch only. Never throws — always returns null on error
 * so callers can fail silent without breaking the editor.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
const REQUEST_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 2_500;
const MAX_TITLE_LENGTH = 40;
const MAX_BODY_CHARS = 2_000;
const CACHE_MAX_ENTRIES = 50;

const DEFAULT_MODEL_KEY = "supernote.ai.autoTitle.model";
const ENABLED_KEY = "supernote.ai.autoTitle";
const CORS_WARNED_KEY = "supernote.ai.autoTitle.corsWarned";
const HOST_KEY = "supernote.ai.ollamaHost";

const FALLBACK_MODEL = "llama3.2:1b";

/**
 * Result of a probe against Ollama. We distinguish failure modes so the
 * settings UI can show actionable guidance instead of a generic "not detected".
 *
 * - "ok": HTTP 200 from /api/tags. Server is up AND CORS allows our origin.
 * - "http": HTTP non-2xx (e.g. 403 if Ollama gates the endpoint, 404 if path
 *           changed). Server reachable but rejected the request.
 * - "cors": fetch threw `TypeError: Failed to fetch` AND `navigator.onLine`
 *           is true AND a same-origin sanity check would succeed. Most likely
 *           Ollama is up but `OLLAMA_ORIGINS` does not include our origin.
 * - "network": fetch threw and we believe the network/server is the problem
 *              (offline, DNS, port closed). Ollama probably not running.
 * - "timeout": probe exceeded `PROBE_TIMEOUT_MS`. Treat as network.
 */
export type OllamaProbeStatus = "ok" | "http" | "cors" | "network" | "timeout";

export interface OllamaProbeResult {
  status: OllamaProbeStatus;
  /** Resolved host (after applying user override). */
  host: string;
  /** Origin that Ollama would need to whitelist. */
  origin: string;
  /** HTTP status if we got a response. */
  httpStatus?: number;
  /** Underlying error message for diagnostics. */
  error?: string;
  /** Model list if the probe succeeded. */
  models?: Array<{ name: string; size?: number; digest?: string }>;
}

/** Read the user-configured Ollama host (set in IaOllamaTab). Trailing slash trimmed. */
export function readOllamaHost(): string {
  if (typeof window === "undefined") return DEFAULT_OLLAMA_BASE_URL;
  try {
    const raw = window.localStorage.getItem(HOST_KEY);
    if (!raw) return DEFAULT_OLLAMA_BASE_URL;
    return raw.trim().replace(/\/+$/, "") || DEFAULT_OLLAMA_BASE_URL;
  } catch {
    return DEFAULT_OLLAMA_BASE_URL;
  }
}

// Set of placeholder titles that the auto-title hook is allowed to overwrite.
// We include both space-separated and slug-form variants because the inbox
// pipeline normalises "Nouvelle note" → "nouvelle-note" (filename slug) and
// occasionally surfaces the slug as the visible title.
const DEFAULT_TITLES = new Set([
  "",
  "nouvelle note",
  "nouvelle-note",
  "sans titre",
  "sans-titre",
  "untitled",
  "new note",
  "new-note",
]);

/** Read the user-configured model (set in IaOllamaTab) with sane fallback. */
function readPreferredModel(): string {
  if (typeof window === "undefined") return FALLBACK_MODEL;
  try {
    return window.localStorage.getItem(DEFAULT_MODEL_KEY) ?? FALLBACK_MODEL;
  } catch {
    return FALLBACK_MODEL;
  }
}

/** True if the current title looks like a placeholder the user hasn't edited. */
export function isDefaultTitle(title: string | undefined | null): boolean {
  const t = (title ?? "").trim().toLowerCase();
  return DEFAULT_TITLES.has(t);
}

/** Strip surrounding quotes / common LLM noise; clamp length. */
function cleanTitle(raw: string): string {
  let t = raw.trim();
  // Drop wrapping quotes (single, double, French)
  t = t.replace(/^["'«“”‘’`]+/, "").replace(/["'«»“”‘’`]+$/, "");
  // Take only the first line — model often verboses despite instructions
  t = t.split(/\r?\n/)[0]?.trim() ?? "";
  // Drop trailing punctuation that LLMs love adding
  t = t.replace(/[.;:!?]+$/, "");
  // Strip leading "Titre :" / "Title:" prefixes
  t = t.replace(/^(titre|title)\s*[:\-–—]\s*/i, "");
  // Re-strip wrapping quotes in case the prefix hid them
  t = t.replace(/^["'«“”‘’`]+/, "").replace(/["'«»“”‘’`]+$/, "");
  if (t.length > MAX_TITLE_LENGTH) t = t.slice(0, MAX_TITLE_LENGTH).trimEnd();
  return t;
}

/**
 * Validate a cleaned title against quality rules. Returns true if it looks
 * like a real human-readable French phrase, false if it smells like a slug
 * or camelCase concatenation (e.g. "DataAnonModelExistLibImprove").
 *
 * Rules:
 *  - Non-empty after cleaning
 *  - At most 6 words
 *  - No single word longer than 20 chars (likely a concatenation)
 *  - No internal capital letters within a word (heuristic for camelCase),
 *    but allow Title Case at word starts and all-caps acronyms (≤4 chars).
 */
function isValidTitle(title: string): boolean {
  if (!title) return false;
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) return false;
  for (const word of words) {
    if (word.length > 20) return false;
    // Strip surrounding non-letters for the camelCase check (e.g. "Q3,").
    const core = word.replace(/^[^A-Za-zÀ-ÖØ-öø-ÿ]+|[^A-Za-zÀ-ÖØ-öø-ÿ]+$/g, "");
    if (!core) continue;
    // Allow all-uppercase acronyms up to 4 chars (e.g. "Q3", "API", "RGPD").
    if (core.length <= 4 && core === core.toUpperCase()) continue;
    // Reject internal uppercase: a capital letter that follows a lowercase
    // letter inside the same word — classic camelCase fingerprint.
    if (/[a-zà-öø-ÿ][A-ZÀ-Ö]/.test(core)) return false;
  }
  return true;
}

/** Cheap stable hash for cache keys. */
function hashBody(body: string, model: string): string {
  // djb2
  let h = 5381;
  const s = `${model}::${body.slice(0, MAX_BODY_CHARS)}`;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

/**
 * Module-level LRU cache. Shared across hook instances, which is fine —
 * it's a pure body→title map and survives editor remounts.
 */
const cache = new Map<string, string>();
function cacheGet(key: string): string | undefined {
  const v = cache.get(key);
  if (v !== undefined) {
    // refresh recency
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}
function cacheSet(key: string, value: string): void {
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

/**
 * Build the list of candidate hosts to try, in order.
 *
 * Why multiple? Because Chrome treats `http://localhost` and `http://127.0.0.1`
 * differently for Private Network Access (PNA): both are "loopback", but
 * preflight handling can vary, and Ollama may bind to one but not the other.
 * If the user explicitly set a host that's not a loopback variant we just try
 * that one verbatim — they know what they're doing.
 */
function buildCandidateHosts(host: string): string[] {
  const candidates = new Set<string>([host]);
  // If the host looks like one of the localhost variants, try the other too.
  if (/^https?:\/\/localhost(:\d+)?$/i.test(host)) {
    candidates.add(host.replace(/\/\/localhost/i, "//127.0.0.1"));
  } else if (/^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(host)) {
    candidates.add(host.replace(/\/\/127\.0\.0\.1/i, "//localhost"));
  }
  return [...candidates];
}

/**
 * Single-host probe — shared by `probeOllama` (which orchestrates fallbacks).
 * Stays a "simple request" GET (no headers, no body, no cache option) so it
 * doesn't trigger a CORS preflight that Ollama might mishandle.
 */
async function probeOllamaSingle(
  host: string,
  origin: string,
): Promise<OllamaProbeResult> {
  const url = `${host}/api/tags`;
  let res: Response;
  try {
    // Plain `fetch(url)` — NO method, NO headers, NO body, NO cache option.
    // Anything else can promote this to a "preflighted" request, which adds
    // failure modes (PNA preflight, OPTIONS handling) we don't want here.
    res = await fetchWithTimeout(url, {}, PROBE_TIMEOUT_MS);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? err.name : "Error";
    // eslint-disable-next-line no-console
    console.info("[ollama-probe]", {
      url,
      origin,
      error: msg,
      errorName: errName,
      online: typeof navigator !== "undefined" ? navigator.onLine : "n/a",
    });
    if (err instanceof DOMException && err.name === "AbortError") {
      return { status: "timeout", host, origin, error: msg };
    }
    const online =
      typeof navigator !== "undefined" ? navigator.onLine !== false : true;
    return {
      status: online ? "cors" : "network",
      host,
      origin,
      error: `${errName}: ${msg}`,
    };
  }

  // eslint-disable-next-line no-console
  console.info("[ollama-probe]", {
    url,
    origin,
    status: res.status,
    ok: res.ok,
  });

  if (!res.ok) {
    return { status: "http", host, origin, httpStatus: res.status };
  }

  let models: OllamaProbeResult["models"];
  try {
    const data = (await res.json()) as {
      models?: Array<{ name: string; size?: number; digest?: string }>;
    };
    models = Array.isArray(data.models) ? data.models : [];
  } catch (err) {
    // Ollama answered but the body was unparseable — the probe is still "ok"
    // (the wall is down) but we surface the parse error for diagnostics.
    // eslint-disable-next-line no-console
    console.info("[ollama-probe] parse failed", {
      url,
      error: err instanceof Error ? err.message : String(err),
    });
    models = [];
  }

  return { status: "ok", host, origin, httpStatus: res.status, models };
}

/**
 * Probe Ollama and classify the outcome.
 *
 * Browsers obscure CORS failures behind the same `TypeError: Failed to fetch`
 * that network errors produce — the spec deliberately hides whether the
 * server actually answered. Our heuristic: if `navigator.onLine` is true we
 * assume the server is reachable but blocking us via CORS; otherwise we
 * assume the network is down. Imperfect but actionable.
 *
 * We try `localhost` and `127.0.0.1` in sequence — Chrome's Private Network
 * Access treats them subtly differently, and Ollama may bind to only one.
 * We return the first success; if all fail we return the last failure
 * (which is usually the most informative for the user).
 */
export async function probeOllama(
  hostOverride?: string,
): Promise<OllamaProbeResult> {
  const baseHost = (hostOverride ?? readOllamaHost()).replace(/\/+$/, "");
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "unknown";

  const candidates = buildCandidateHosts(baseHost);
  let lastResult: OllamaProbeResult | undefined;
  for (const host of candidates) {
    const result = await probeOllamaSingle(host, origin);
    if (result.status === "ok") return result;
    lastResult = result;
  }
  // Fallback shape if `candidates` was somehow empty — defensive.
  return (
    lastResult ?? {
      status: "network",
      host: baseHost,
      origin,
      error: "No candidate hosts produced a result",
    }
  );
}

/** Fire one toast about CORS — only once per session. */
function warnCorsOnce(message: string): void {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(CORS_WARNED_KEY) === "1") return;
    window.sessionStorage.setItem(CORS_WARNED_KEY, "1");
  } catch {
    /* sessionStorage may be unavailable (SSR / strict mode); fall through */
  }
  // eslint-disable-next-line no-console
  console.warn("[useAutoTitle]", message);
}

export interface UseAutoTitleResult {
  /** True once a probe of /api/tags has succeeded. False until probed or on failure. */
  isAvailable: boolean;
  /** True while the very first probe is in-flight. */
  isProbing: boolean;
  /** Generate a title for `body`. Returns null on any error / empty result. */
  suggest: (body: string, currentTitle?: string) => Promise<string | null>;
}

export function useAutoTitle(): UseAutoTitleResult {
  const [isAvailable, setIsAvailable] = useState(false);
  const [isProbing, setIsProbing] = useState(true);
  const probedRef = useRef(false);

  // Probe Ollama once on mount via the shared classifier. We only care
  // about the boolean here; the settings UI uses probeOllama() directly
  // to display a richer diagnostic.
  useEffect(() => {
    if (probedRef.current) return;
    probedRef.current = true;
    let cancelled = false;
    (async () => {
      const result = await probeOllama();
      if (cancelled) return;
      setIsAvailable(result.status === "ok");
      setIsProbing(false);
      if (result.status === "cors") {
        warnCorsOnce(
          "Ollama unreachable from the browser (likely CORS). Launch with `OLLAMA_ORIGINS=* ollama serve` to allow this origin.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const suggest = useCallback(
    async (body: string, currentTitle?: string): Promise<string | null> => {
      const trimmed = body.trim();
      if (trimmed.length < 30) return null;
      // Don't overwrite a user-chosen title.
      if (currentTitle !== undefined && !isDefaultTitle(currentTitle)) return null;

      const model = readPreferredModel();
      const key = hashBody(trimmed, model);
      const hit = cacheGet(key);
      if (hit !== undefined) return hit || null;

      const truncatedBody = trimmed.slice(0, MAX_BODY_CHARS);
      const prompt = [
        "Tu es un assistant qui suggère un titre court et clair pour une note.",
        "",
        "RÈGLES STRICTES:",
        "- 3 à 6 mots français maximum (pas plus)",
        "- Mots normaux avec espaces, JAMAIS de camelCase ou d'abréviations",
        "- Pas de guillemets, pas de ponctuation finale",
        "- Capture le sujet principal, pas tous les détails",
        "",
        "EXEMPLES:",
        'Contenu: "Idée d\'amélioration pour l\'anonymisation des données d\'entrée. Modèle existant et bibliothèque disponible."',
        "Titre: Anonymisation des données d'entrée",
        "",
        'Contenu: "Réunion équipe marketing lundi 14h pour préparer Q3."',
        "Titre: Réunion marketing Q3",
        "",
        'Contenu: "Liste des courses pour la semaine: pain, lait, fruits."',
        "Titre: Courses de la semaine",
        "",
        "Réponds UNIQUEMENT avec le titre, rien d'autre.",
        "",
        "Contenu:",
        truncatedBody,
      ].join("\n");

      const host = readOllamaHost();
      const callOllama = async (): Promise<string | null> => {
        const res = await fetchWithTimeout(
          `${host}/api/generate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              prompt,
              stream: false,
              // Low temperature: titles want determinism, not creativity.
              options: { temperature: 0.1 },
            }),
          },
          REQUEST_TIMEOUT_MS,
        );
        if (!res.ok) return null;
        const data = (await res.json()) as { response?: string };
        return cleanTitle(data.response ?? "");
      };

      try {
        let cleaned = await callOllama();
        // Reject and retry once if the title smells like a slug/camelCase
        // concatenation. Some local models (e.g. small llama variants) ignore
        // formatting instructions on the first shot but comply on a second
        // pass — cheaper than skipping the feature entirely.
        if (cleaned !== null && !isValidTitle(cleaned)) {
          cleaned = await callOllama();
          if (cleaned !== null && !isValidTitle(cleaned)) {
            // Retry also failed — skip auto-title rather than ship garbage.
            return null;
          }
        }
        if (!cleaned) return null;
        cacheSet(key, cleaned);
        return cleaned;
      } catch (err) {
        // TypeError "Failed to fetch" usually = CORS or Ollama down.
        // Surface a one-time hint so the user knows what to do.
        const msg = err instanceof Error ? err.message : String(err);
        if (/fetch|network|cors/i.test(msg)) {
          warnCorsOnce(
            "Ollama unreachable from the browser. If Ollama is running, set OLLAMA_ORIGINS=* before launching it (e.g. `OLLAMA_ORIGINS=* ollama serve`).",
          );
        }
        return null;
      }
    },
    [],
  );

  return { isAvailable, isProbing, suggest };
}

/** Read the user's "auto-title" toggle from localStorage. Default: false (opt-in). */
export function isAutoTitleEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export const AUTO_TITLE_ENABLED_KEY = ENABLED_KEY;
export const AUTO_TITLE_MODEL_KEY = DEFAULT_MODEL_KEY;
export const OLLAMA_HOST_KEY = HOST_KEY;
export const DEFAULT_OLLAMA_HOST = DEFAULT_OLLAMA_BASE_URL;

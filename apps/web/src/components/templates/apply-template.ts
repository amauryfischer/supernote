// ============================================================
// Runtime template application helpers
// ============================================================
//
// Bridges the pure `@supernote/templates` renderer to the runtime app so
// applying a template actually interpolates its placeholders:
//   - {{date}} / {{time}} / {{datetime}}  → the *current* clock (`now`)
//   - {{prompt:Question?}}                 → live user input (modal driven)
//   - {{select:a|b|c}}                     → first option (no live picker yet)
//   - everything else                      → sensible runtime defaults
//
// The heavy lifting (parsing, substitution, cursor) lives in the package.
// This module only assembles a `TemplateResolvers` bag and derives the note
// title from the rendered body.

import { listVariables, renderTemplate } from "@supernote/templates";
import type {
  Template,
  TemplateResolvers,
  RenderedTemplate,
} from "@supernote/templates";

/**
 * A `{{prompt:…}}` occurrence detected in a template body, ready to be asked
 * to the user before rendering.
 */
export interface TemplatePrompt {
  /** Raw token, e.g. `{{prompt:Sujet?|Visio}}` — unique answer key. */
  readonly raw: string;
  /** The question shown to the user, e.g. `Sujet?`. */
  readonly question: string;
  /** Optional default pre-filled in the input. */
  readonly defaultValue?: string;
}

/** Split a prompt arg `"Question?|default"` into its parts. */
function parsePromptArg(arg: string): { question: string; defaultValue?: string } {
  const pipeIdx = arg.indexOf("|");
  if (pipeIdx === -1) return { question: arg };
  return { question: arg.slice(0, pipeIdx), defaultValue: arg.slice(pipeIdx + 1) };
}

/**
 * Collect every distinct `{{prompt:…}}` in a template, in declaration order,
 * deduplicated by raw token (same token → asked once). Returns the list of
 * questions the UI must resolve before rendering.
 */
export function collectPrompts(template: Template): TemplatePrompt[] {
  const seen = new Set<string>();
  const prompts: TemplatePrompt[] = [];
  for (const variable of listVariables(template)) {
    if (variable.kind !== "prompt") continue;
    if (seen.has(variable.raw)) continue;
    seen.add(variable.raw);
    const { question, defaultValue } = parsePromptArg(variable.arg ?? "");
    prompts.push({ raw: variable.raw, question, defaultValue });
  }
  return prompts;
}

export interface RuntimeResolverOptions {
  /**
   * Answers gathered from the user keyed by the prompt's *question* string
   * (mirrors how the renderer calls `promptUser(question, default)`).
   */
  readonly promptAnswers: Record<string, string>;
  /** Vault display info, if known. */
  readonly vault?: { name: string; path: string };
  /** Current user info, if known. */
  readonly user?: { name?: string; email?: string };
}

/**
 * Build the runtime `TemplateResolvers`. Prompts resolve from the pre-gathered
 * answers (the UI asked them up front via a modal); the remaining resolvers
 * use neutral runtime defaults so a template never throws mid-render.
 */
export function buildRuntimeResolvers(opts: RuntimeResolverOptions): TemplateResolvers {
  const { promptAnswers, vault, user } = opts;
  return {
    // Answered up front by the modal flow. Fall back to the default value so
    // a skipped/empty prompt still renders deterministically.
    promptUser: async (question, defaultValue) =>
      promptAnswers[question] ?? defaultValue ?? "",
    // No inline option picker yet — pick the first choice deterministically.
    selectOption: async (options) => options[0] ?? "",
    // No entity picker in the apply flow — leave the slot empty rather than
    // cancelling the whole render.
    pickEntity: async () => null,
    incrementCounter: async () => 1,
    runJS: () => "",
    getTemplate: () => null,
    getVaultInfo: () => vault ?? { name: "Coffre", path: "/" },
    getUserInfo: () => user ?? {},
  };
}

/**
 * Render a template at runtime: interpolate {{date}}/{{time}} from the current
 * clock and substitute the gathered prompt answers. `now` is injected for
 * deterministic testing; production passes `new Date()`.
 */
export async function applyTemplate(
  template: Template,
  opts: RuntimeResolverOptions & { now?: Date },
): Promise<RenderedTemplate> {
  return renderTemplate(template, {
    resolvers: buildRuntimeResolvers(opts),
    now: opts.now ?? new Date(),
  });
}

/** Field values accepted by the entity layer. */
export type FrontmatterFieldValue = string | number | boolean | null | string[];

/**
 * Coerce a rendered template's frontmatter (`Record<string, unknown>`) into the
 * constrained field-value shape the entity layer accepts. Unsupported values
 * (objects, nested records, mixed arrays) are dropped rather than smuggled in
 * as `unknown`, keeping the create call type-safe.
 */
export function sanitizeFrontmatter(
  frontmatter: Record<string, unknown>,
): Record<string, FrontmatterFieldValue> {
  const out: Record<string, FrontmatterFieldValue> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      out[key] = value;
    } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      out[key] = value as string[];
    }
  }
  return out;
}

/**
 * Derive a note title from a rendered template body: the first non-empty line,
 * stripped of leading Markdown heading markers. Falls back to the template name.
 */
export function deriveTitleFromBody(body: string, fallback: string): string {
  for (const rawLine of body.split("\n")) {
    const line = rawLine.replace(/^#{1,6}\s+/, "").trim();
    if (line.length > 0) return line;
  }
  return fallback;
}

// ============================================================
// Template renderer — resolves all variables and computes cursor
// ============================================================

import type { Template, TemplateContext, RenderedTemplate, TemplateError } from "../types.js";
import { parseVariables } from "../parser/index.js";
import { resolveVariable } from "../variables/index.js";
import { isErr } from "@supernote/core/result";

const CURSOR_RAW = "{{cursor}}";

/**
 * Render a template body: resolve all variables in declaration order,
 * deduplicated (same raw = same resolved value), then substitute.
 *
 * @param template  The template to render
 * @param ctx       Resolution context with resolvers and current time
 * @param includeStack  Internal: prevents recursive {{template:name}} loops
 */
export async function renderTemplate(
  template: Template,
  ctx: TemplateContext,
  includeStack: string[] = [],
): Promise<RenderedTemplate> {
  const body = applyInitialBindings(template.body, ctx.initialBindings ?? {});
  const variables = parseVariables(body);
  const bindings: Record<string, unknown> = {};

  // Resolve each unique variable once (skip cursor — handled after substitution)
  for (const variable of variables) {
    if (variable.kind === "cursor") continue;
    const result = await resolveVariable(variable, ctx, includeStack);
    if (isErr(result)) {
      const error: TemplateError = result.error;
      if (error.code === "CANCELLED") {
        bindings[variable.raw] = "";
      } else {
        throw new TemplateRenderError(error);
      }
    } else {
      bindings[variable.raw] = result.value;
    }
  }

  // Substitute all non-cursor bindings first
  let rendered = body;
  for (const [raw, value] of Object.entries(bindings)) {
    rendered = replaceAll(rendered, raw, String(value ?? ""));
  }

  // Detect cursor position while {{cursor}} is still present, then remove it
  const cursorPosition = computeCursorPosition(rendered);
  rendered = replaceAll(rendered, CURSOR_RAW, "");

  return {
    body: rendered,
    frontmatter: { ...(template.frontmatter ?? {}) },
    cursorPosition,
    bindings,
  };
}

// ------ Helpers -----------------------------------------------

function applyInitialBindings(body: string, bindings: Record<string, unknown>): string {
  let result = body;
  for (const [key, value] of Object.entries(bindings)) {
    result = replaceAll(result, `{{${key}}}`, String(value ?? ""));
  }
  return result;
}

function replaceAll(str: string, search: string, replacement: string): string {
  return str.split(search).join(replacement);
}

function computeCursorPosition(body: string): { line: number; col: number } | undefined {
  const idx = body.indexOf(CURSOR_RAW);
  if (idx === -1) return undefined;
  const before = body.slice(0, idx);
  const lines = before.split("\n");
  const line = lines.length - 1;
  const col = (lines[lines.length - 1] ?? "").length;
  return { line, col };
}

// ------ Error class -------------------------------------------

export class TemplateRenderError extends Error {
  readonly templateError: TemplateError;

  constructor(error: TemplateError) {
    super(error.message);
    this.name = "TemplateRenderError";
    this.templateError = error;
  }
}

// ============================================================
// Template validation
// ============================================================

import type { Template, TemplateVariable, TemplateError, Result } from "./types.js";
import { ok, err } from "@supernote/core/result";
import { parseVariables, findAllTokens, parseToken } from "./parser/index.js";

/**
 * List all unique template variables found in the template body.
 * Useful for tooling, autocompletion, and validation UI.
 */
export function listVariables(template: Template): TemplateVariable[] {
  return parseVariables(template.body);
}

/**
 * Validate a template for structural correctness.
 * Checks:
 *   - body is a non-empty string
 *   - all {{...}} tokens are recognized
 *   - no more than one {{cursor}}
 */
export function validateTemplate(template: Template): Result<true, TemplateError> {
  if (typeof template.body !== "string" || template.body.length === 0) {
    return err<TemplateError>({
      code: "INVALID_SYNTAX",
      message: "Template body must be a non-empty string",
    });
  }

  const tokens = findAllTokens(template.body);
  const unknownTokens: string[] = [];
  let cursorCount = 0;

  for (const { raw, inner } of tokens) {
    const parsed = parseToken(inner);
    if (!parsed) {
      unknownTokens.push(raw);
    } else if (parsed.kind === "cursor") {
      cursorCount++;
    }
  }

  if (unknownTokens.length > 0) {
    return err<TemplateError>({
      code: "UNKNOWN_VARIABLE",
      message: `Unknown template variables: ${unknownTokens.join(", ")}`,
    });
  }

  if (cursorCount > 1) {
    return err<TemplateError>({
      code: "INVALID_SYNTAX",
      message: `Template may only contain one {{cursor}}, found ${cursorCount}`,
    });
  }

  return ok(true);
}

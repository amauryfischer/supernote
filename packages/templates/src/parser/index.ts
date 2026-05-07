// ============================================================
// Template parser — extracts {{variable}} tokens
// ============================================================

import type { TemplateVariable, TemplateVariableKind } from "../types.js";

/**
 * Regex that matches {{...}} template variables.
 * Captures the inner content (no nested braces).
 */
const TOKEN_RE = /\{\{([^{}]+?)\}\}/g;

function parseToken(inner: string): TemplateVariable | null {
  const trimmed = inner.trim();

  // cursor
  if (trimmed === "cursor") {
    return { raw: `{{${inner}}}`, kind: "cursor" };
  }

  // datetime (no colon suffix)
  if (trimmed === "datetime") {
    return { raw: `{{${inner}}}`, kind: "datetime" };
  }

  // date / date:format
  if (trimmed === "date" || trimmed.startsWith("date:")) {
    const arg = trimmed.includes(":") ? trimmed.slice(5) : undefined;
    return { raw: `{{${inner}}}`, kind: "date", arg };
  }

  // time / time:format
  if (trimmed === "time" || trimmed.startsWith("time:")) {
    const arg = trimmed.includes(":") ? trimmed.slice(5) : undefined;
    return { raw: `{{${inner}}}`, kind: "time", arg };
  }

  // prompt:Question? or prompt:Question?|default
  if (trimmed.startsWith("prompt:")) {
    return { raw: `{{${inner}}}`, kind: "prompt", arg: trimmed.slice(7) };
  }

  // select:opt1|opt2|opt3
  if (trimmed.startsWith("select:")) {
    const optStr = trimmed.slice(7);
    const options = optStr.split("|").map((o) => o.trim()).filter(Boolean);
    return { raw: `{{${inner}}}`, kind: "select", options };
  }

  // contact / contact:type
  if (trimmed === "contact" || trimmed.startsWith("contact:")) {
    const arg = trimmed.includes(":") ? trimmed.slice(8) : undefined;
    return { raw: `{{${inner}}}`, kind: "contact", arg };
  }

  // title
  if (trimmed === "title") {
    return { raw: `{{${inner}}}`, kind: "title" };
  }

  // vault.name / vault.path
  if (trimmed.startsWith("vault.") || trimmed === "vault") {
    return { raw: `{{${inner}}}`, kind: "vault", arg: trimmed };
  }

  // user / user.email / user.name
  if (trimmed === "user" || trimmed.startsWith("user.")) {
    return { raw: `{{${inner}}}`, kind: "user", arg: trimmed };
  }

  // random
  if (trimmed === "random") {
    return { raw: `{{${inner}}}`, kind: "random" };
  }

  // ulid
  if (trimmed === "ulid") {
    return { raw: `{{${inner}}}`, kind: "ulid" };
  }

  // counter:scope
  if (trimmed.startsWith("counter:")) {
    return { raw: `{{${inner}}}`, kind: "counter", arg: trimmed.slice(8) };
  }

  // js:expression
  if (trimmed.startsWith("js:")) {
    return { raw: `{{${inner}}}`, kind: "js", arg: trimmed.slice(3) };
  }

  // template:name
  if (trimmed.startsWith("template:")) {
    return { raw: `{{${inner}}}`, kind: "template", arg: trimmed.slice(9) };
  }

  return null;
}

/** Extract all template variables from a body string (preserving order, deduping by raw). */
export function parseVariables(body: string): TemplateVariable[] {
  const seen = new Set<string>();
  const results: TemplateVariable[] = [];

  for (const match of body.matchAll(TOKEN_RE)) {
    const inner = match[1];
    if (!inner) continue;
    const variable = parseToken(inner);
    if (!variable) continue;
    if (!seen.has(variable.raw)) {
      seen.add(variable.raw);
      results.push(variable);
    }
  }

  return results;
}

/** Return all raw token matches including duplicates (for replacement). */
export function findAllTokens(body: string): Array<{ raw: string; inner: string }> {
  const results: Array<{ raw: string; inner: string }> = [];
  for (const match of body.matchAll(TOKEN_RE)) {
    const raw = match[0] ?? "";
    const inner = match[1] ?? "";
    results.push({ raw, inner });
  }
  return results;
}

export { parseToken };
export type { TemplateVariableKind };

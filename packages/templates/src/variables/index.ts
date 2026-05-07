// ============================================================
// Variable resolution strategies
// ============================================================

import { ulid as generateUlid } from "ulid";
import { formatDate, DEFAULT_DATE_FORMAT, DEFAULT_TIME_FORMAT, DEFAULT_DATETIME_FORMAT } from "../date/format.js";
import type { TemplateVariable, TemplateContext, TemplateError, Template } from "../types.js";
import type { Result } from "@supernote/core/result";
import { ok, err } from "@supernote/core/result";

export type ResolveResult = Result<string, TemplateError>;

/** Parse "Question?|default" into { question, defaultValue } */
function parsePromptArg(arg: string): { question: string; defaultValue?: string } {
  const pipeIdx = arg.indexOf("|");
  if (pipeIdx === -1) return { question: arg };
  return { question: arg.slice(0, pipeIdx), defaultValue: arg.slice(pipeIdx + 1) };
}

/** Resolve a single template variable to a string value. */
export async function resolveVariable(
  variable: TemplateVariable,
  ctx: TemplateContext,
  includeStack: string[],
): Promise<ResolveResult> {
  const { resolvers, now } = ctx;

  switch (variable.kind) {
    case "date": {
      const fmt = variable.arg ?? DEFAULT_DATE_FORMAT;
      return ok(formatDate(now, fmt));
    }

    case "time": {
      const fmt = variable.arg ?? DEFAULT_TIME_FORMAT;
      return ok(formatDate(now, fmt));
    }

    case "datetime":
      return ok(formatDate(now, DEFAULT_DATETIME_FORMAT));

    case "cursor":
      // Handled separately during rendering; return placeholder
      return ok("");

    case "prompt": {
      const arg = variable.arg ?? "";
      const { question, defaultValue } = parsePromptArg(arg);
      const answer = await resolvers.promptUser(question, defaultValue);
      if (answer === null) {
        return err<TemplateError>({ code: "CANCELLED", message: `User cancelled prompt: ${question}`, raw: variable.raw });
      }
      return ok(answer);
    }

    case "select": {
      const options = variable.options ?? [];
      const chosen = await resolvers.selectOption(options);
      if (chosen === null) {
        return err<TemplateError>({ code: "CANCELLED", message: "User cancelled selection", raw: variable.raw });
      }
      return ok(chosen);
    }

    case "contact": {
      const entity = await resolvers.pickEntity(variable.arg);
      if (entity === null) {
        return err<TemplateError>({ code: "CANCELLED", message: "User cancelled entity pick", raw: variable.raw });
      }
      return ok(entity.label);
    }

    case "title": {
      // title = alias for first line of body; resolved post-render by caller
      return ok("");
    }

    case "vault": {
      const vault = resolvers.getVaultInfo();
      if (variable.arg === "vault.name" || variable.arg === "vault") return ok(vault.name);
      if (variable.arg === "vault.path") return ok(vault.path);
      return ok(vault.name);
    }

    case "user": {
      const user = resolvers.getUserInfo();
      if (variable.arg === "user.email") return ok(user.email ?? "");
      if (variable.arg === "user.name" || variable.arg === "user") return ok(user.name ?? "");
      return ok(user.name ?? "");
    }

    case "random":
      return ok(String(Math.random()));

    case "ulid":
      return ok(generateUlid());

    case "counter": {
      const scope = variable.arg ?? "global";
      const count = await resolvers.incrementCounter(scope);
      return ok(String(count));
    }

    case "js": {
      const expr = variable.arg ?? "";
      try {
        const value = resolvers.runJS(expr);
        return ok(String(value ?? ""));
      } catch (e) {
        return err<TemplateError>({
          code: "JS_EVAL_ERROR",
          message: `JS eval failed: ${String(e)}`,
          raw: variable.raw,
        });
      }
    }

    case "template": {
      const name = variable.arg ?? "";
      if (includeStack.includes(name)) {
        return err<TemplateError>({
          code: "RECURSIVE_INCLUDE",
          message: `Recursive template include detected: ${name}`,
          raw: variable.raw,
        });
      }
      const nested: Template | null = resolvers.getTemplate(name);
      if (!nested) {
        return err<TemplateError>({
          code: "UNKNOWN_VARIABLE",
          message: `Template not found: ${name}`,
          raw: variable.raw,
        });
      }
      // Inline import to avoid circular dependency
      const { renderTemplate } = await import("../renderer/index.js");
      const rendered = await renderTemplate(nested, ctx, [...includeStack, name]);
      return ok(rendered.body);
    }

    default: {
      const _exhaustive: never = variable.kind;
      return err<TemplateError>({
        code: "UNKNOWN_VARIABLE",
        message: `Unknown variable kind: ${String(_exhaustive)}`,
        raw: variable.raw,
      });
    }
  }
}

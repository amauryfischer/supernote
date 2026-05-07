// ============================================================
// Public types for @supernote/templates
// ============================================================

import type { Result } from "@supernote/core/result";

// ------ EntityRef -----------------------------------------------

export interface EntityRef {
  readonly id: string;
  readonly typeId?: string;
  readonly label: string;
}

// ------ Template ------------------------------------------------

export interface Template {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly icon?: string;
  /** Default entity typeId for newly created notes from this template */
  readonly entityType?: string;
  readonly defaultPath?: string;
  /** Markdown body with template variables */
  readonly body: string;
  /** Initial frontmatter field values */
  readonly frontmatter?: Record<string, unknown>;
  readonly postCreate?: {
    readonly focusBlock?: string;
    readonly runFormula?: string;
  };
}

// ------ TemplateContext -----------------------------------------

export interface TemplateResolvers {
  promptUser(question: string, defaultValue?: string): Promise<string | null>;
  selectOption(options: string[]): Promise<string | null>;
  pickEntity(typeFilter?: string): Promise<EntityRef | null>;
  incrementCounter(scope: string): Promise<number>;
  runJS(expr: string): unknown;
  getTemplate(name: string): Template | null;
  getVaultInfo(): { name: string; path: string };
  getUserInfo(): { name?: string; email?: string };
}

export interface TemplateContext {
  readonly resolvers: TemplateResolvers;
  readonly now: Date;
  readonly initialBindings?: Record<string, unknown>;
}

// ------ RenderedTemplate ----------------------------------------

export interface RenderedTemplate {
  readonly body: string;
  readonly frontmatter: Record<string, unknown>;
  readonly cursorPosition?: { readonly line: number; readonly col: number };
  /** All resolved variable values keyed by variable name/expression */
  readonly bindings: Record<string, unknown>;
}

// ------ TemplateVariable ----------------------------------------

export type TemplateVariableKind =
  | "date"
  | "time"
  | "datetime"
  | "cursor"
  | "prompt"
  | "select"
  | "contact"
  | "title"
  | "vault"
  | "user"
  | "random"
  | "ulid"
  | "counter"
  | "js"
  | "template";

export interface TemplateVariable {
  readonly raw: string;
  readonly kind: TemplateVariableKind;
  /** format string, question, scope, expression, etc. */
  readonly arg?: string;
  /** for select: list of options */
  readonly options?: string[];
}

// ------ TemplateError -------------------------------------------

export type TemplateErrorCode =
  | "UNKNOWN_VARIABLE"
  | "RECURSIVE_INCLUDE"
  | "JS_EVAL_ERROR"
  | "INVALID_SYNTAX"
  | "CANCELLED";

export interface TemplateError {
  readonly code: TemplateErrorCode;
  readonly message: string;
  readonly raw?: string;
}

// ------ Re-export Result ----------------------------------------

export type { Result };

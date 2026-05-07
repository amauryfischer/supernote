// ============================================================
// @supernote/templates — public API
// ============================================================

export type {
  Template,
  TemplateContext,
  TemplateResolvers,
  RenderedTemplate,
  TemplateVariable,
  TemplateVariableKind,
  TemplateError,
  TemplateErrorCode,
  EntityRef,
  Result,
} from "./types.js";

export { renderTemplate, TemplateRenderError } from "./renderer/index.js";
export { listVariables, validateTemplate } from "./validator.js";
export { parseVariables } from "./parser/index.js";
export { formatDate } from "./date/format.js";
export { SEED_TEMPLATES, DAILY_JOURNAL, MEETING_NOTES, RECIPE, PROJECT_BRIEF } from "./seeds/index.js";

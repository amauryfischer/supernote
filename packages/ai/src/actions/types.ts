// ============================================================
// @supernote/ai/actions — types
// ============================================================

export type AIActionId =
  | "reformat"
  | "summarize"
  | "fix-spelling";

export interface AIActionParams {
  targetLanguage?: string;
  tone?: "formel" | "casual" | "neutre" | "technique";
  customPrompt?: string;
}

export interface AIActionContext {
  parentBlock?: string;
  noteTitle?: string;
}

export interface AIActionInput {
  actionId: AIActionId;
  selection: string;
  context: AIActionContext;
  params?: AIActionParams;
}

export type AIActionChunk =
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; code: string; message: string };

export interface AIActionDef {
  id: AIActionId;
  label: string;
  shortcut?: string;
}

// ============================================================
// Agent loop types — local Ollama with tool calling
// ============================================================

import type {
  ChatMessage,
  ToolCall,
  ToolDefinition,
  ToolParametersSchema,
  OllamaClient,
} from "../ollama/types.js";

/**
 * Concrete handler for a tool the model can invoke. The agent matches
 * `definition.function.name` from the model's `tool_calls` to one of
 * these handlers and runs `execute(args)`. The returned value is JSON-
 * serialized and fed back into the conversation as a `role: "tool"`
 * message.
 */
export interface AgentTool {
  definition: ToolDefinition;
  /**
   * Execute the tool. Receives the raw arguments object the model
   * produced and returns a JSON-serializable result (or a string that
   * will be sent verbatim).
   */
  execute(args: Record<string, unknown>): Promise<unknown>;
}

export interface AgentRunOptions {
  client: OllamaClient;
  model?: string;
  /**
   * System prompt prepended to the conversation. Optional — callers
   * that already supplied a `system` message in `messages` can omit it.
   */
  system?: string;
  messages: ChatMessage[];
  tools: AgentTool[];
  /** Hard cap on tool-call iterations to prevent runaway loops. */
  maxSteps?: number;
  /** Optional event sink so UI can stream tool calls / assistant text. */
  onEvent?: (event: AgentEvent) => void;
  /** AbortSignal to cancel a run mid-flight. */
  signal?: AbortSignal;
  temperature?: number;
}

export type AgentEvent =
  | { type: "assistant_text"; text: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; result: unknown; error?: string }
  | { type: "step_done"; step: number }
  | { type: "done"; finalText: string };

export interface AgentRunResult {
  /** Full message history after the run (including tool calls + results). */
  messages: ChatMessage[];
  /** Final assistant text response. */
  finalText: string;
  /** Number of tool-call iterations performed. */
  steps: number;
  /** True when the loop hit `maxSteps` without a terminal assistant message. */
  stopped: boolean;
}

export type { ChatMessage, ToolCall, ToolDefinition, ToolParametersSchema };

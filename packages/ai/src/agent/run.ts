// ============================================================
// Agent loop — drives Ollama tool calling until the model
// produces a final assistant message with no tool_calls.
// ============================================================

import type { ChatMessage, ToolCall } from "../ollama/types.js";
import type {
  AgentRunOptions,
  AgentRunResult,
  AgentTool,
} from "./types.js";

const DEFAULT_MAX_STEPS = 8;

function buildToolIndex(tools: AgentTool[]): Map<string, AgentTool> {
  const map = new Map<string, AgentTool>();
  for (const tool of tools) {
    map.set(tool.definition.function.name, tool);
  }
  return map;
}

function newCallId(step: number, index: number): string {
  return `call_${step}_${index}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function runAgent(opts: AgentRunOptions): Promise<AgentRunResult> {
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const toolIndex = buildToolIndex(opts.tools);
  const toolDefinitions = opts.tools.map((t) => t.definition);

  const messages: ChatMessage[] = [];
  if (opts.system && !opts.messages.some((m) => m.role === "system")) {
    messages.push({ role: "system", content: opts.system });
  }
  messages.push(...opts.messages);

  let step = 0;
  let finalText = "";
  let stopped = false;

  while (step < maxSteps) {
    if (opts.signal?.aborted) {
      stopped = true;
      break;
    }
    step += 1;

    // Drain the chat iterator into a single assistant message. With
    // tools enabled the client always returns a single chunk; without
    // tools we concatenate streamed chunks.
    let assistantText = "";
    let toolCalls: ToolCall[] | undefined;
    const iter = opts.client.chat({
      messages,
      tools: toolDefinitions,
      ...(opts.model !== undefined ? { model: opts.model } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    });
    for await (const chunk of iter) {
      if (chunk.content) {
        assistantText += chunk.content;
        if (!chunk.tool_calls) {
          opts.onEvent?.({ type: "assistant_text", text: chunk.content });
        }
      }
      if (chunk.tool_calls && chunk.tool_calls.length > 0) {
        toolCalls = chunk.tool_calls;
      }
    }

    // Assign ids to the model's tool calls (Ollama doesn't emit any).
    const calls = (toolCalls ?? []).map((c, i) => ({
      id: c.id ?? newCallId(step, i),
      function: c.function,
    }));

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: assistantText,
      ...(calls.length > 0 ? { tool_calls: calls } : {}),
    };
    messages.push(assistantMessage);

    if (calls.length === 0) {
      finalText = assistantText;
      opts.onEvent?.({ type: "step_done", step });
      break;
    }

    for (const call of calls) {
      const name = call.function.name;
      const args = call.function.arguments ?? {};
      opts.onEvent?.({ type: "tool_call", id: call.id!, name, arguments: args });

      const tool = toolIndex.get(name);
      if (!tool) {
        const errMsg = `Unknown tool: ${name}`;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content: JSON.stringify({ error: errMsg }),
        });
        opts.onEvent?.({
          type: "tool_result",
          id: call.id!,
          name,
          result: null,
          error: errMsg,
        });
        continue;
      }

      try {
        const result = await tool.execute(args);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content: safeStringify(result),
        });
        opts.onEvent?.({ type: "tool_result", id: call.id!, name, result });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name,
          content: JSON.stringify({ error: errMsg }),
        });
        opts.onEvent?.({
          type: "tool_result",
          id: call.id!,
          name,
          result: null,
          error: errMsg,
        });
      }
    }

    opts.onEvent?.({ type: "step_done", step });
  }

  if (step >= maxSteps && !finalText) {
    stopped = true;
  }
  opts.onEvent?.({ type: "done", finalText });
  return { messages, finalText, steps: step, stopped };
}

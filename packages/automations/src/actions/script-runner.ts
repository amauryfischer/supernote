// ============================================================
// run-script action — sandboxed JS via node:vm
// ============================================================

import { runInNewContext } from "node:vm";

export interface ScriptRunResult {
  readonly output: unknown;
  readonly logs: string[];
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Execute a JS script in a sandboxed VM context with limited globals.
 */
export function runScript(
  script: string,
  contextVars: Record<string, unknown> = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): ScriptRunResult {
  const logs: string[] = [];
  const sandbox: Record<string, unknown> = {
    ...contextVars,
    console: {
      log: (...args: unknown[]) => logs.push(args.map(String).join(" ")),
      warn: (...args: unknown[]) => logs.push("[WARN] " + args.map(String).join(" ")),
      error: (...args: unknown[]) => logs.push("[ERROR] " + args.map(String).join(" ")),
    },
    Math,
    JSON,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
  };

  const output = runInNewContext(script, sandbox, { timeout: timeoutMs });
  return { output, logs };
}

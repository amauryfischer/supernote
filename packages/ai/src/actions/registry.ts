import type { AIActionDef } from "./types.js";

export const AI_ACTIONS_MVP: readonly AIActionDef[] = [
  { id: "reformat", label: "Reformater", shortcut: "Mod+K Mod+R" },
  { id: "summarize", label: "Résumer", shortcut: "Mod+K Mod+S" },
  { id: "fix-spelling", label: "Corriger orthographe", shortcut: "Mod+K Mod+C" },
] as const;

export function findActionDef(id: string): AIActionDef | undefined {
  return AI_ACTIONS_MVP.find((a) => a.id === id);
}

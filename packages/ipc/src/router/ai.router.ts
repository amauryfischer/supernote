import { z } from "zod";
import { router, publicProcedure } from "./trpc.js";
import {
  AI_ACTIONS_MVP,
  getDefaultPrompt,
} from "@supernote/ai/actions";

const ActionIdEnum = z.enum(["reformat", "summarize", "fix-spelling"]);

export const GetPromptInput = z.object({
  actionId: ActionIdEnum,
});

export const GetPromptOutput = z.object({
  prompt: z.string(),
  source: z.enum(["default", "vault-override"]),
});

export const AIActionDefSchema = z.object({
  id: ActionIdEnum,
  label: z.string(),
  shortcut: z.string().optional(),
});

export const aiRouter = router({
  /**
   * Retourne la liste des actions IA disponibles côté client.
   */
  listActions: publicProcedure
    .output(z.array(AIActionDefSchema))
    .query(() => [...AI_ACTIONS_MVP]),

  /**
   * Retourne le prompt résolu pour une action.
   *
   * Phase 1 : retourne le default uniquement (pas de lookup vault).
   * Phase 2 : merge avec `.supernote/prompts/<id>.md` si présent.
   */
  getPrompt: publicProcedure
    .input(GetPromptInput)
    .output(GetPromptOutput)
    .query(({ input }) => ({
      prompt: getDefaultPrompt(input.actionId),
      source: "default" as const,
    })),
});

export type AIRouter = typeof aiRouter;

import { describe, it, expect } from "vitest";
import { aiRouter } from "./ai.router.js";

describe("aiRouter", () => {
  const ctx = { vaultPath: null };

  it("listActions retourne le registry MVP", async () => {
    const caller = aiRouter.createCaller(ctx);
    const out = await caller.listActions();
    const ids = out.map((a) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining(["reformat", "summarize", "fix-spelling"]),
    );
  });

  it("getPrompt(reformat) retourne le default", async () => {
    const caller = aiRouter.createCaller(ctx);
    const out = await caller.getPrompt({ actionId: "reformat" });
    expect(out.prompt).toContain("{{selection}}");
    expect(out.source).toBe("default");
  });

  it("getPrompt valide l'actionId", async () => {
    const caller = aiRouter.createCaller(ctx);
    await expect(
      // @ts-expect-error : id invalide délibérément
      caller.getPrompt({ actionId: "inconnu" }),
    ).rejects.toThrow();
  });
});

import { describe, it, expect } from "vitest";
import { splitQuotedReply } from "./email-quote";

describe("splitQuotedReply", () => {
  it("sépare le texte neuf de la citation (top-post)", () => {
    const raw = [
      "Merci pour le récap !",
      "",
      "Le 24 juin 2026 à 10:00, Ada a écrit :",
      "> Bonjour à vous 2,",
      "> voici le récap…",
    ].join("\n");
    const { body, quoted } = splitQuotedReply(raw);
    expect(body).toBe("Merci pour le récap !");
    expect(quoted).toContain("Bonjour à vous 2");
    expect(quoted).toContain("Le 24 juin 2026 à 10:00, Ada a écrit :");
  });

  it("corps entièrement cité → body vide, quoted complet", () => {
    const raw = ["> Bonjour à vous 2,", "> Pour faire suite…", "> Bien à vous,"].join("\n");
    const { body, quoted } = splitQuotedReply(raw);
    expect(body).toBe("");
    expect(quoted).toContain("Bonjour à vous 2");
  });

  it("sans citation → tout en body", () => {
    const raw = "Juste un message simple\nsur deux lignes.";
    const { body, quoted } = splitQuotedReply(raw);
    expect(body).toBe("Juste un message simple\nsur deux lignes.");
    expect(quoted).toBe("");
  });

  it("attribution anglaise (wrote:)", () => {
    const raw = ["Thanks!", "", "On Tue, 23 Jun 2026, Ada <a@b.io> wrote:", "> original"].join("\n");
    const { body, quoted } = splitQuotedReply(raw);
    expect(body).toBe("Thanks!");
    expect(quoted).toContain("> original");
  });

  it("séparateur message d'origine Outlook", () => {
    const raw = ["Voir ci-dessous.", "", "-----Message d'origine-----", "De : x", "Texte cité"].join("\n");
    const { body } = splitQuotedReply(raw);
    expect(body).toBe("Voir ci-dessous.");
  });

  it("chaîne vide → vide", () => {
    expect(splitQuotedReply("")).toEqual({ body: "", quoted: "" });
  });
});

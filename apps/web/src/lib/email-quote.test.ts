import { describe, it, expect } from "vitest";
import { splitQuotedReply, stripSignature, parseEmailBody } from "./email-quote";

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

describe("stripSignature", () => {
  it("coupe au délimiteur standard '-- '", () => {
    const raw = ["Le texte du mail.", "-- ", "Jean Dupont", "01 23 45 67 89"].join("\n");
    const { body, signature } = stripSignature(raw);
    expect(body).toBe("Le texte du mail.");
    expect(signature).toContain("Jean Dupont");
  });

  it("coupe à une salutation précédée de contenu", () => {
    const raw = ["Voici ma réponse.", "", "Cordialement,", "Jean Dupont", "[image]"].join("\n");
    const { body, signature } = stripSignature(raw);
    expect(body).toBe("Voici ma réponse.");
    expect(signature).toContain("Cordialement,");
    expect(signature).toContain("[image]");
  });

  it("salutation seule (pas de contenu avant) → NON coupée", () => {
    const { body, signature } = stripSignature("Merci");
    expect(body).toBe("Merci");
    expect(signature).toBe("");
  });

  it("sans signature → tout en body", () => {
    const { body, signature } = stripSignature("Une simple ligne.");
    expect(body).toBe("Une simple ligne.");
    expect(signature).toBe("");
  });
});

describe("parseEmailBody", () => {
  it("retire citation ET signature", () => {
    const raw = [
      "Bien reçu, merci !",
      "",
      "Cordialement,",
      "Ada",
      "",
      "Le 24 juin 2026, Bob a écrit :",
      "> message d'origine",
    ].join("\n");
    const { body, quoted, signature } = parseEmailBody(raw);
    expect(body).toBe("Bien reçu, merci !");
    expect(signature).toContain("Cordialement,");
    expect(quoted).toContain("> message d'origine");
  });
});

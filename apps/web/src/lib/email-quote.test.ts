import { describe, it, expect } from "vitest";
import {
  splitQuotedReply,
  stripSignature,
  parseEmailBody,
  cleanInlineLinks,
  collapseBlankLines,
  cleanBody,
} from "./email-quote";

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

describe("cleanInlineLinks", () => {
  it("retire l'artefact <mailto:…> mais garde le label", () => {
    expect(cleanInlineLinks("c.delongcamp@vortex-io.fr<mailto:c.delongcamp@vortex-io.fr>")).toBe(
      "c.delongcamp@vortex-io.fr",
    );
  });
  it("retire l'artefact <https:…> (label texte)", () => {
    expect(cleanInlineLinks("Prendre RDV<https://meetings-eu1.hubspot.com/x>")).toBe("Prendre RDV");
  });
  it("retire l'artefact <http:…> (url affichée)", () => {
    expect(cleanInlineLinks("www.vortex-io.fr<http://www.vortex-io.fr/>")).toBe("www.vortex-io.fr");
  });
  it("retire l'espace + chevron du cas [linkedin] <https://…>", () => {
    expect(cleanInlineLinks("  [linkedin] <https://www.linkedin.com/company/vortex-io/>")).toBe(
      "  [linkedin]",
    );
  });
  it("ne touche pas un < > qui n'est pas une URL", () => {
    expect(cleanInlineLinks("a < b et c > d")).toBe("a < b et c > d");
  });
});

describe("collapseBlankLines", () => {
  it("réduit 3+ lignes vides à 1 (max 2 \\n)", () => {
    expect(collapseBlankLines("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
  it("trim les espaces en fin de ligne", () => {
    expect(collapseBlankLines("a   \nb\t")).toBe("a\nb");
  });
  it("conserve une seule ligne vide", () => {
    expect(collapseBlankLines("a\n\nb")).toBe("a\n\nb");
  });
});

describe("splitQuotedReply — bloc d'en-têtes de transfert (De:/Envoyé:/Objet:)", () => {
  it("coupe au bloc d'en-têtes cités", () => {
    const raw = [
      "Voici l'info.",
      "",
      'De : "Hadrien Buguet" <hadrien@x.fr>',
      'À : "Amaury" <amaury@x.fr>',
      "Envoyé: jeudi 25 Juin 2026 14:46",
      "Objet : Re: Séisme",
      "Bonjour monsieur,",
    ].join("\n");
    const { body, quoted } = splitQuotedReply(raw);
    expect(body).toBe("Voici l'info.");
    expect(quoted).toContain("De :");
    expect(quoted).toContain("Bonjour monsieur");
  });

  it("une ligne « From: … » isolée n'est PAS prise pour une citation", () => {
    const { body, quoted } = splitQuotedReply("From: moi, je pense que oui.\nLa suite du message.");
    expect(quoted).toBe("");
    expect(body).toContain("La suite");
  });
});

describe("cleanBody (exemple A — liens inline Outlook)", () => {
  const exA = [
    "Charlotte de Longcamp",
    "Cheffe de projet",
    "",
    "+33 (0)7 49 12 92 76",
    "c.delongcamp@vortex-io.fr<mailto:c.delongcamp@vortex-io.fr>",
    "",
    "",
    "",
    "Prendre RDV<https://meetings-eu1.hubspot.com/charlotte-de-longcamp>",
    "www.vortex-io.fr<http://www.vortex-io.fr/>",
    "",
    "  [linkedin] <https://www.linkedin.com/company/vortex-io/>",
  ].join("\n");

  it("plus aucun artefact <mailto:…>/<https:…>/<http:…>", () => {
    const out = cleanBody(exA);
    expect(out).not.toMatch(/<mailto:/);
    expect(out).not.toMatch(/<https?:/);
    expect(out).toContain("c.delongcamp@vortex-io.fr");
    expect(out).toContain("Prendre RDV");
    expect(out).toContain("www.vortex-io.fr");
    expect(out).toContain("[linkedin]");
  });

  it("plus de 3 lignes vides consécutives", () => {
    expect(cleanBody(exA)).not.toMatch(/\n{3,}/);
  });
});

describe("stripSignature (séparateurs étendus + bloc contact)", () => {
  it("coupe à une ligne de tirets longue (≥3)", () => {
    const raw = ["Le vrai message.", "--------------------------------", "Franck", "Expert"].join("\n");
    const { body, signature } = stripSignature(raw);
    expect(body).toBe("Le vrai message.");
    expect(signature).toContain("Franck");
  });
  it("coupe à une ligne d'underscores (≥3)", () => {
    const raw = ["Texte.", "________", "Jean", "01 23 45 67 89"].join("\n");
    const { body } = stripSignature(raw);
    expect(body).toBe("Texte.");
  });

  it("exemple B — bloc signature SANS formule de politesse détecté", () => {
    const exB = [
      "--------------------------------",
      "Franck THOMAS-LAVIELLE",
      "Expert financier TPE / PME",
      "",
      "Analyse et Stratégie financière - Valorisation - Financement - Contrôle de gestion - Organisation",
      "",
      "[Φ(K) α At = Audit + Formation + Conseil + Coaching de Dirigeants]",
      "",
      "+ (33) 6 52 38 12 82 /  https://franckthomaslavielle.com",
    ].join("\n");
    const realBody = ["Bonjour,", "", "Merci pour votre message, je reviens vers vous rapidement.", ""].join("\n");
    const { body, signature } = stripSignature(realBody + exB);
    expect(body).toContain("Merci pour votre message");
    expect(body).not.toContain("Franck THOMAS-LAVIELLE");
    expect(signature).toContain("Franck THOMAS-LAVIELLE");
    expect(signature).toContain("+ (33) 6 52 38 12 82");
  });

  it("bloc contact final sans politesse, séparé par lignes vides", () => {
    const raw = [
      "Bonjour,",
      "",
      "Voici les informations demandées pour le dossier.",
      "",
      "",
      "Charlotte de Longcamp",
      "Cheffe de projet",
      "+33 (0)7 49 12 92 76",
      "c.delongcamp@vortex-io.fr",
    ].join("\n");
    const { body, signature } = stripSignature(raw);
    expect(body).toContain("Voici les informations demandées");
    expect(body).not.toContain("Charlotte de Longcamp");
    expect(signature).toContain("Charlotte de Longcamp");
  });

  it("message court avec 1 seul contact → NON sur-coupé", () => {
    const raw = ["Vous pouvez me joindre au 01 23 45 67 89 si besoin.", "Merci d'avance pour votre retour rapide."].join("\n");
    const { body, signature } = stripSignature(raw);
    // Pas de formule de politesse isolée ni de bloc contact (1 marqueur) → intact.
    expect(signature).toBe("");
    expect(body).toContain("01 23 45 67 89");
  });

  it("message court sans signature → intact", () => {
    const { body, signature } = stripSignature("Parfait, c'est noté.\nÀ tout à l'heure en réunion.");
    expect(signature).toBe("");
    expect(body).toBe("Parfait, c'est noté.\nÀ tout à l'heure en réunion.");
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

  it("exemple A — nettoie les artefacts de liens et coupe la signature", () => {
    const raw = [
      "Bonjour Amaury,",
      "",
      "Merci pour votre retour, je vous transmets le devis ci-joint.",
      "",
      "Cordialement,",
      "",
      "Charlotte de Longcamp",
      "Cheffe de projet",
      "",
      "+33 (0)7 49 12 92 76",
      "c.delongcamp@vortex-io.fr<mailto:c.delongcamp@vortex-io.fr>",
      "",
      "",
      "",
      "Prendre RDV<https://meetings-eu1.hubspot.com/charlotte-de-longcamp>",
      "www.vortex-io.fr<http://www.vortex-io.fr/>",
      "",
      "  [linkedin] <https://www.linkedin.com/company/vortex-io/>",
    ].join("\n");
    const { body, signature } = parseEmailBody(raw);
    expect(body).toContain("Merci pour votre retour");
    expect(body).not.toContain("Charlotte de Longcamp");
    expect(signature).toContain("Charlotte de Longcamp");
    // Aucun artefact de lien inline ni dans le corps ni dans la signature.
    expect(body).not.toMatch(/<(?:mailto:|https?:)/);
    expect(signature).not.toMatch(/<(?:mailto:|https?:)/);
    expect(signature).not.toMatch(/\n{3,}/);
  });

  it("exemple B — bloc signature sans politesse, corps préservé", () => {
    const raw = [
      "Bonjour,",
      "",
      "Je vous confirme notre rendez-vous de la semaine prochaine.",
      "",
      "--------------------------------",
      "Franck THOMAS-LAVIELLE",
      "Expert financier TPE / PME",
      "",
      "Analyse et Stratégie financière - Valorisation - Financement - Contrôle de gestion - Organisation",
      "",
      "[Φ(K) α At = Audit + Formation + Conseil + Coaching de Dirigeants]",
      "",
      "+ (33) 6 52 38 12 82 /  https://franckthomaslavielle.com",
    ].join("\n");
    const { body, signature } = parseEmailBody(raw);
    expect(body).toContain("Je vous confirme notre rendez-vous");
    expect(body).not.toContain("Franck THOMAS-LAVIELLE");
    expect(signature).toContain("Franck THOMAS-LAVIELLE");
  });

  it("message court sans signature → corps intact, signature vide", () => {
    const { body, signature } = parseEmailBody("Parfait, merci ! On se voit demain.");
    expect(body).toBe("Parfait, merci ! On se voit demain.");
    expect(signature).toBe("");
  });
});

import { describe, it, expect } from "vitest";
import {
  upsertTemplate,
  removeTemplate,
  appendSignature,
  appendBlock,
  applyTemplate,
  parseTemplates,
  serializeTemplates,
  SIGNATURE_DELIMITER,
  type MailTemplate,
} from "./mail-templates";

const sig: MailTemplate = { id: "1", name: "Pro", kind: "signature", body: "Jean Dupont\n01 23 45 67 89" };
const mail: MailTemplate = { id: "2", name: "Relance", kind: "email", subject: "Relance", body: "Bonjour,\n\nJe reviens vers vous." };

describe("upsertTemplate", () => {
  it("ajoute un template absent", () => {
    expect(upsertTemplate([], sig)).toEqual([sig]);
  });
  it("remplace un template existant (même id)", () => {
    const edited = { ...sig, name: "Perso" };
    const out = upsertTemplate([sig, mail], edited);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(edited);
    expect(out[1]).toEqual(mail);
  });
  it("ne mute pas la liste d'origine", () => {
    const list = [sig];
    upsertTemplate(list, mail);
    expect(list).toEqual([sig]);
  });
});

describe("removeTemplate", () => {
  it("retire par id", () => {
    expect(removeTemplate([sig, mail], "1")).toEqual([mail]);
  });
  it("id inconnu → liste inchangée (copie)", () => {
    expect(removeTemplate([sig], "x")).toEqual([sig]);
  });
});

describe("appendSignature", () => {
  it("ajoute la signature via le délimiteur standard", () => {
    const out = appendSignature("Mon message.", "Jean");
    expect(out).toBe(`Mon message.${SIGNATURE_DELIMITER}Jean`);
  });
  it("corps vide → signature précédée du marqueur '-- '", () => {
    expect(appendSignature("", "Jean")).toBe("-- \nJean");
  });
  it("signature vide → corps inchangé", () => {
    expect(appendSignature("Mon message.", "  ")).toBe("Mon message.");
  });
});

describe("appendBlock", () => {
  it("sépare par une ligne vide", () => {
    expect(appendBlock("Bonjour.", "Suite.")).toBe("Bonjour.\n\nSuite.");
  });
  it("corps vide → bloc seul", () => {
    expect(appendBlock("", "Suite.")).toBe("Suite.");
  });
});

describe("applyTemplate", () => {
  it("signature : ajoute au corps, objet inchangé", () => {
    const out = applyTemplate({ subject: "Objet", body: "Texte" }, sig);
    expect(out.subject).toBe("Objet");
    expect(out.body).toBe(`Texte${SIGNATURE_DELIMITER}Jean Dupont\n01 23 45 67 89`);
  });
  it("email : remplit l'objet s'il est vide", () => {
    const out = applyTemplate({ subject: "", body: "" }, mail);
    expect(out.subject).toBe("Relance");
    expect(out.body).toBe("Bonjour,\n\nJe reviens vers vous.");
  });
  it("email : NE clobber PAS un objet déjà saisi", () => {
    const out = applyTemplate({ subject: "Déjà là", body: "" }, mail);
    expect(out.subject).toBe("Déjà là");
  });
});

describe("parse/serialize round-trip", () => {
  it("round-trip conserve les templates", () => {
    const list = [sig, mail];
    expect(parseTemplates(serializeTemplates(list))).toEqual(list);
  });
  it("JSON invalide → liste vide", () => {
    expect(parseTemplates("{bad")).toEqual([]);
  });
  it("rejette les entrées malformées", () => {
    const raw = JSON.stringify([
      sig,
      { id: "x" }, // pas de kind/body
      { id: "y", name: "z", kind: "bogus", body: "" }, // kind invalide
      mail,
    ]);
    expect(parseTemplates(raw)).toEqual([sig, mail]);
  });
  it("strippe subject sur une signature", () => {
    const raw = JSON.stringify([{ id: "s", name: "n", kind: "signature", body: "b", subject: "ne devrait pas rester" }]);
    const out = parseTemplates(raw);
    expect(out[0]).toEqual({ id: "s", name: "n", kind: "signature", body: "b" });
  });
});

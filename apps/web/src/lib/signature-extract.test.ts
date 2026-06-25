import { describe, it, expect } from "vitest";
import {
  extractSignatureFields,
  parseSignatureBlock,
  hasAnyExtractedField,
  buildContactApplications,
  findContactByEmail,
  normalizeEmailKey,
} from "./signature-extract";

describe("parseSignatureBlock — téléphones", () => {
  it("classe un fixe FR avec libellé Tél", () => {
    const r = parseSignatureBlock("Tél : 01 23 45 67 89");
    expect(r.phone).toBe("01 23 45 67 89");
    expect(r.mobile).toBeUndefined();
  });

  it("classe un mobile via libellé Mobile (EN/FR)", () => {
    const r = parseSignatureBlock("Mobile: +33 6 12 34 56 78");
    expect(r.mobile).toBe("+33 6 12 34 56 78");
  });

  it("classe un mobile via libellé Portable", () => {
    const r = parseSignatureBlock("Portable 07.11.22.33.44");
    expect(r.mobile).toBe("07.11.22.33.44");
  });

  it("détecte un mobile FR 06/07 sans libellé", () => {
    const r = parseSignatureBlock("06 98 76 54 32");
    expect(r.mobile).toBe("06 98 76 54 32");
    expect(r.phone).toBeUndefined();
  });

  it("classe un numéro non-06/07 sans libellé en phone", () => {
    const r = parseSignatureBlock("04 91 00 00 00");
    expect(r.phone).toBe("04 91 00 00 00");
    expect(r.mobile).toBeUndefined();
  });

  it("sépare fixe et mobile sur deux lignes", () => {
    const r = parseSignatureBlock("Tel: 01 44 55 66 77\nMob: 06 00 11 22 33");
    expect(r.phone).toBe("01 44 55 66 77");
    expect(r.mobile).toBe("06 00 11 22 33");
  });

  it("ignore les numéros de fax", () => {
    const r = parseSignatureBlock("Fax : 01 23 45 67 90");
    expect(r.phone).toBeUndefined();
    expect(r.mobile).toBeUndefined();
  });

  it("ignore un nombre trop court (pas un téléphone)", () => {
    const r = parseSignatureBlock("Bureau 12 - étage 3");
    expect(r.phone).toBeUndefined();
  });

  it("gère le format international groupé +44", () => {
    const r = parseSignatureBlock("Phone: +44 20 7946 0958");
    expect(r.phone).toBe("+44 20 7946 0958");
  });

  it("gère le format US avec parenthèses", () => {
    const r = parseSignatureBlock("Cell: (415) 555-0132");
    expect(r.mobile).toBe("(415) 555-0132");
  });
});

describe("parseSignatureBlock — URLs (website / linkedin)", () => {
  it("extrait un site web https", () => {
    const r = parseSignatureBlock("https://acme.fr");
    expect(r.website).toBe("https://acme.fr");
  });

  it("normalise un domaine nu www en https", () => {
    const r = parseSignatureBlock("www.exemple.com");
    expect(r.website).toBe("https://www.exemple.com");
  });

  it("reconnaît LinkedIn et le sépare du website", () => {
    const r = parseSignatureBlock("https://acme.io\nhttps://www.linkedin.com/in/jdupont");
    expect(r.website).toBe("https://acme.io");
    expect(r.linkedin).toBe("https://www.linkedin.com/in/jdupont");
  });

  it("reconnaît un domaine LinkedIn nu", () => {
    const r = parseSignatureBlock("linkedin.com/in/marie-curie");
    expect(r.linkedin).toBe("https://linkedin.com/in/marie-curie");
    expect(r.website).toBeUndefined();
  });

  it("reconnaît un raccourci lnkd.in", () => {
    const r = parseSignatureBlock("lnkd.in/abcd");
    expect(r.linkedin).toBe("https://lnkd.in/abcd");
  });

  it("ne confond pas une adresse email avec un website", () => {
    const r = parseSignatureBlock("jean.dupont@acme.fr");
    expect(r.website).toBeUndefined();
    expect(r.linkedin).toBeUndefined();
  });

  it("retire une ponctuation finale parasite", () => {
    const r = parseSignatureBlock("Visitez www.acme.fr.");
    expect(r.website).toBe("https://www.acme.fr");
  });
});

describe("parseSignatureBlock — rôle & société", () => {
  it("capture un rôle FR explicite", () => {
    const r = parseSignatureBlock("Directrice marketing");
    expect(r.role).toBe("Directrice marketing");
  });

  it("capture un rôle EN (Head of Sales)", () => {
    const r = parseSignatureBlock("Head of Sales");
    expect(r.role).toBe("Head of Sales");
  });

  it("sépare 'Rôle | Société' avec un pipe", () => {
    const r = parseSignatureBlock("Consultant senior | Acme Consulting");
    expect(r.role).toBe("Consultant senior");
    expect(r.company).toBe("Acme Consulting");
  });

  it("sépare 'Rôle — Société' avec un tiret cadratin", () => {
    const r = parseSignatureBlock("CTO — TechLabs SAS");
    expect(r.role).toBe("CTO");
    expect(r.company).toBe("TechLabs SAS");
  });

  it("gère 'Rôle chez Société'", () => {
    const r = parseSignatureBlock("Responsable commercial chez Globex Group");
    expect(r.role).toBe("Responsable commercial");
    expect(r.company).toBe("Globex Group");
  });

  it("capture une société via suffixe juridique seule sur sa ligne", () => {
    const r = parseSignatureBlock("Initech SARL");
    expect(r.company).toBe("Initech SARL");
  });

  it("ignore les lignes contenant un email/url pour rôle/société", () => {
    const r = parseSignatureBlock("contact@acme.fr\nDirecteur général");
    expect(r.role).toBe("Directeur général");
    expect(r.company).toBeUndefined();
  });

  it("ignore une ligne de prose trop longue", () => {
    const long =
      "Je suis responsable de toute une série de choses très importantes dans cette grande entreprise mondiale prestigieuse";
    const r = parseSignatureBlock(long);
    expect(r.role).toBeUndefined();
  });
});

describe("extractSignatureFields — bout-en-bout via stripSignature", () => {
  it("extrait une signature FR complète après '-- '", () => {
    const body = [
      "Bonjour,",
      "",
      "Merci pour votre retour, c'est noté.",
      "",
      "-- ",
      "Jean Dupont",
      "Directeur marketing | Acme SAS",
      "Mobile : 06 12 34 56 78",
      "Tél : 01 23 45 67 89",
      "www.acme.fr",
      "https://www.linkedin.com/in/jdupont",
    ].join("\n");
    const r = extractSignatureFields(body);
    expect(r.role).toBe("Directeur marketing");
    expect(r.company).toBe("Acme SAS");
    expect(r.mobile).toBe("06 12 34 56 78");
    expect(r.phone).toBe("01 23 45 67 89");
    expect(r.website).toBe("https://www.acme.fr");
    expect(r.linkedin).toBe("https://www.linkedin.com/in/jdupont");
  });

  it("extrait une signature EN coupée à 'Best regards'", () => {
    const body = [
      "Hi team,",
      "",
      "Sounds good, let's ship it.",
      "",
      "Best regards,",
      "Marie Curie",
      "Head of Engineering, Globex Inc",
      "Cell: +1 (415) 555-0132",
      "https://globex.com",
    ].join("\n");
    const r = extractSignatureFields(body);
    expect(r.role).toBe("Head of Engineering");
    expect(r.company).toBe("Globex Inc");
    expect(r.mobile).toBe("+1 (415) 555-0132");
    expect(r.website).toBe("https://globex.com");
  });

  it("ne capture rien quand le corps n'a pas de signature exploitable", () => {
    const body = "Ok merci !";
    const r = extractSignatureFields(body);
    expect(hasAnyExtractedField(r)).toBe(false);
  });

  it("retombe sur le corps entier si aucun délimiteur (bloc coordonnées brut)", () => {
    const body = ["Jean Dupont", "Gérant — Initech SARL", "06 11 22 33 44"].join("\n");
    const r = extractSignatureFields(body);
    expect(r.role).toBe("Gérant");
    expect(r.company).toBe("Initech SARL");
    expect(r.mobile).toBe("06 11 22 33 44");
  });

  it("gère une chaîne vide sans planter", () => {
    const r = extractSignatureFields("");
    expect(hasAnyExtractedField(r)).toBe(false);
  });
});

describe("hasAnyExtractedField", () => {
  it("vrai si au moins un champ présent", () => {
    expect(hasAnyExtractedField({ phone: "01" })).toBe(true);
    expect(hasAnyExtractedField({ linkedin: "x" })).toBe(true);
  });
  it("faux si objet vide", () => {
    expect(hasAnyExtractedField({})).toBe(false);
  });
});

describe("buildContactApplications", () => {
  it("mappe les champs extraits vers les champs personne", () => {
    const apps = buildContactApplications({
      mobile: "06 12 34 56 78",
      role: "Directeur",
      company: "Acme SAS",
      linkedin: "https://linkedin.com/in/x",
    });
    const byField = Object.fromEntries(apps.map((a) => [a.fieldName, a.extracted]));
    expect(byField.phone).toBe("06 12 34 56 78");
    expect(byField.role).toBe("Directeur");
    expect(byField.company).toBe("Acme SAS");
    expect(byField.linkedin).toBe("https://linkedin.com/in/x");
  });

  it("préfère le mobile au fixe pour le champ phone", () => {
    const apps = buildContactApplications({ phone: "01 11 11 11 11", mobile: "06 22 22 22 22" });
    const phone = apps.find((a) => a.fieldName === "phone");
    expect(phone?.extracted).toBe("06 22 22 22 22");
  });

  it("retombe sur le fixe si pas de mobile", () => {
    const apps = buildContactApplications({ phone: "01 11 11 11 11" });
    expect(apps.find((a) => a.fieldName === "phone")?.extracted).toBe("01 11 11 11 11");
  });

  it("ignore le website (pas de champ sur personne)", () => {
    const apps = buildContactApplications({ website: "https://acme.fr" });
    expect(apps).toHaveLength(0);
  });

  it("signale un conflit quand le contact a déjà une valeur différente", () => {
    const apps = buildContactApplications(
      { company: "Acme SAS" },
      { company: "Ancienne Corp" },
    );
    const c = apps.find((a) => a.fieldName === "company");
    expect(c?.conflict).toBe(true);
    expect(c?.current).toBe("Ancienne Corp");
  });

  it("pas de conflit quand la valeur existante est identique", () => {
    const apps = buildContactApplications({ company: "Acme" }, { company: "Acme" });
    expect(apps.find((a) => a.fieldName === "company")?.conflict).toBe(false);
  });

  it("n'inclut que les champs réellement extraits", () => {
    const apps = buildContactApplications({ role: "CTO" });
    expect(apps.map((a) => a.fieldName)).toEqual(["role"]);
  });
});

describe("findContactByEmail / normalizeEmailKey", () => {
  const contacts = [
    { id: "1", fields: { email: "Alice@Acme.FR", name: "Alice" } },
    { id: "2", fields: { email: "bob@globex.com", name: "Bob" } },
    { id: "3", fields: { name: "Sans email" } },
  ];

  it("trouve un contact insensible à la casse", () => {
    expect(findContactByEmail(contacts, "alice@acme.fr")?.id).toBe("1");
  });

  it("trim les espaces de l'adresse cherchée", () => {
    expect(findContactByEmail(contacts, "  bob@globex.com  ")?.id).toBe("2");
  });

  it("renvoie null si aucune correspondance", () => {
    expect(findContactByEmail(contacts, "nobody@x.io")).toBeNull();
  });

  it("renvoie null pour une adresse vide/undefined", () => {
    expect(findContactByEmail(contacts, "")).toBeNull();
    expect(findContactByEmail(contacts, undefined)).toBeNull();
  });

  it("normalizeEmailKey trim + minuscule", () => {
    expect(normalizeEmailKey("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(normalizeEmailKey(undefined)).toBe("");
  });
});

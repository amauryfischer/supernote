import { describe, it, expect } from "vitest";
import { buildForwardSubject, buildForwardedBody } from "./mail-forward";
import type { EmailMessage } from "./gmail";

function msg(p: Partial<EmailMessage>): EmailMessage {
  return {
    id: "m",
    threadId: "t",
    subject: "",
    from: { name: "", email: "" },
    to: [],
    date: "",
    snippet: "",
    bodyText: "",
    webLink: "",
    attachments: [],
    ...p,
  };
}

describe("buildForwardSubject", () => {
  it("ajoute Fwd: si absent", () => {
    expect(buildForwardSubject("Sujet")).toBe("Fwd: Sujet");
  });
  it("ne double pas Fwd:", () => {
    expect(buildForwardSubject("Fwd: Sujet")).toBe("Fwd: Sujet");
  });
  it("insensible à la casse", () => {
    expect(buildForwardSubject("FWD: x")).toBe("FWD: x");
    expect(buildForwardSubject("fwd:x")).toBe("fwd:x");
    expect(buildForwardSubject("fwd : x")).toBe("fwd : x");
  });
  it("ne confond pas Re: avec Fwd:", () => {
    expect(buildForwardSubject("Re: Sujet")).toBe("Fwd: Re: Sujet");
  });
  it("vide → Fwd:", () => {
    expect(buildForwardSubject("  ")).toBe("Fwd:");
  });
});

describe("buildForwardedBody", () => {
  it("compose l'en-tête de transfert + métadonnées + corps", () => {
    const m = msg({
      from: { name: "Alice", email: "alice@x.fr" },
      to: [
        { name: "Bob", email: "bob@y.fr" },
        { name: "", email: "carol@z.fr" },
      ],
      date: "2026-01-02T10:00:00Z",
      subject: "Rapport",
      bodyText: "Voici le rapport.\nMerci.",
    });
    expect(buildForwardedBody(m)).toBe(
      [
        "---------- Message transféré ----------",
        "De: Alice <alice@x.fr>",
        "Date: 2026-01-02T10:00:00Z",
        "Objet: Rapport",
        "À: Bob <bob@y.fr>, carol@z.fr",
        "",
        "Voici le rapport.\nMerci.",
      ].join("\n"),
    );
  });

  it("retombe sur le snippet si bodyText est vide", () => {
    const m = msg({
      from: { name: "", email: "alice@x.fr" },
      subject: "Hello",
      snippet: "extrait court",
    });
    expect(buildForwardedBody(m)).toContain("De: alice@x.fr");
    expect(buildForwardedBody(m)).toContain("Objet: Hello");
    expect(buildForwardedBody(m).endsWith("extrait court")).toBe(true);
  });

  it("gère les champs absents sans planter", () => {
    const m = msg({});
    const body = buildForwardedBody(m);
    expect(body).toContain("---------- Message transféré ----------");
    expect(body).toContain("De: ");
    expect(body).toContain("Date: ");
    expect(body).toContain("Objet: ");
    expect(body).toContain("À: ");
  });
});

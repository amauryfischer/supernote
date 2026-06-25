import { describe, it, expect } from "vitest";
import {
  ensureRe,
  pickReplyTo,
  replyHeaders,
  buildReplyParams,
  pickReplyAll,
  buildQuotedBody,
} from "./mail-reply";
import type { EmailThread, EmailMessage } from "./gmail";

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
function thread(messages: EmailMessage[]): EmailThread {
  return { id: "t1", messages, labelIds: [] };
}

describe("ensureRe", () => {
  it("ajoute Re: si absent", () => expect(ensureRe("Sujet")).toBe("Re: Sujet"));
  it("ne double pas Re:", () => expect(ensureRe("Re: Sujet")).toBe("Re: Sujet"));
  it("insensible casse/espace", () => {
    expect(ensureRe("RE:Sujet")).toBe("RE:Sujet");
    expect(ensureRe("re : x")).toBe("re : x");
  });
  it("vide → Re:", () => expect(ensureRe("  ")).toBe("Re:"));
});

describe("pickReplyTo", () => {
  it("répond à l'expéditeur si ce n'est pas moi", () => {
    const t = thread([msg({ from: { name: "A", email: "a@x.fr" } })]);
    expect(pickReplyTo(t, "me@x.fr")).toBe("a@x.fr");
  });
  it("dernier message de moi → répond au destinataire", () => {
    const t = thread([
      msg({ from: { name: "Me", email: "me@x.fr" }, to: [{ name: "B", email: "b@y.fr" }] }),
    ]);
    expect(pickReplyTo(t, "me@x.fr")).toBe("b@y.fr");
  });
  it("prend le dernier message du fil", () => {
    const t = thread([
      msg({ from: { name: "A", email: "a@x.fr" } }),
      msg({ from: { name: "C", email: "c@z.fr" } }),
    ]);
    expect(pickReplyTo(t, "me@x.fr")).toBe("c@z.fr");
  });
  it("thread vide → ''", () => expect(pickReplyTo(thread([]), "me@x.fr")).toBe(""));
});

describe("replyHeaders", () => {
  it("In-Reply-To + References chaînées", () => {
    const t = thread([msg({ messageId: "<id2>", references: "<id0> <id1>" })]);
    expect(replyHeaders(t)).toEqual({ inReplyTo: "<id2>", references: "<id0> <id1> <id2>" });
  });
  it("sans references précédentes → references = messageId", () => {
    const t = thread([msg({ messageId: "<id1>" })]);
    expect(replyHeaders(t)).toEqual({ inReplyTo: "<id1>", references: "<id1>" });
  });
  it("sans messageId → {}", () => {
    expect(replyHeaders(thread([msg({})]))).toEqual({});
  });
});

describe("pickReplyAll", () => {
  it("destinataire principal = pickReplyTo, les autres en cc, dédupliqués", () => {
    const t = thread([
      msg({
        from: { name: "A", email: "a@x.fr" },
        to: [
          { name: "Me", email: "me@x.fr" },
          { name: "B", email: "b@y.fr" },
        ],
      }),
      msg({
        from: { name: "B", email: "b@y.fr" },
        to: [
          { name: "A", email: "a@x.fr" },
          { name: "C", email: "c@z.fr" },
          { name: "Me", email: "me@x.fr" },
        ],
      }),
    ]);
    // Dernier message vient de B → réponse simple = B ; cc = A, C (pas moi, pas B).
    expect(pickReplyAll(t, "me@x.fr")).toEqual({ to: "b@y.fr", cc: ["a@x.fr", "c@z.fr"] });
  });

  it("exclut soi-même de cc (insensible à la casse)", () => {
    const t = thread([
      msg({ from: { name: "A", email: "a@x.fr" }, to: [{ name: "Me", email: "ME@X.fr" }] }),
    ]);
    expect(pickReplyAll(t, "me@x.fr")).toEqual({ to: "a@x.fr", cc: [] });
  });

  it("n'inclut pas le destinataire principal dans cc", () => {
    const t = thread([
      msg({
        from: { name: "A", email: "a@x.fr" },
        to: [{ name: "B", email: "b@y.fr" }],
      }),
    ]);
    expect(pickReplyAll(t, "me@x.fr")).toEqual({ to: "a@x.fr", cc: ["b@y.fr"] });
  });

  it("dernier message de moi → to = destinataire, cc = autres participants", () => {
    const t = thread([
      msg({ from: { name: "A", email: "a@x.fr" }, to: [{ name: "Me", email: "me@x.fr" }] }),
      msg({
        from: { name: "Me", email: "me@x.fr" },
        to: [
          { name: "A", email: "a@x.fr" },
          { name: "C", email: "c@z.fr" },
        ],
      }),
    ]);
    expect(pickReplyAll(t, "me@x.fr")).toEqual({ to: "a@x.fr", cc: ["c@z.fr"] });
  });

  it("thread vide → to '' et cc []", () => {
    expect(pickReplyAll(thread([]), "me@x.fr")).toEqual({ to: "", cc: [] });
  });
});

describe("buildQuotedBody", () => {
  it("ligne d'attribution + corps préfixé '> '", () => {
    const m = msg({
      from: { name: "Alice", email: "a@x.fr" },
      date: "2024-01-02T10:00:00.000Z",
      bodyText: "Bonjour\nÇa va ?",
    });
    const out = buildQuotedBody(m);
    const lines = out.split("\n");
    expect(lines[0]).toMatch(/^Le .+, Alice a écrit :$/);
    expect(lines[1]).toBe("> Bonjour");
    expect(lines[2]).toBe("> Ça va ?");
  });

  it("préfixe les lignes vides par '>' seul", () => {
    const m = msg({
      from: { name: "", email: "b@y.fr" },
      date: "2024-01-02T10:00:00.000Z",
      bodyText: "Para 1\n\nPara 2",
    });
    const lines = buildQuotedBody(m).split("\n");
    expect(lines.slice(1)).toEqual(["> Para 1", ">", "> Para 2"]);
  });

  it("utilise l'email si pas de nom, le snippet si pas de bodyText", () => {
    const m = msg({ from: { name: "", email: "b@y.fr" }, date: "", snippet: "extrait" });
    const out = buildQuotedBody(m);
    expect(out.startsWith("b@y.fr a écrit :\n")).toBe(true);
    expect(out.endsWith("> extrait")).toBe(true);
  });

  it("date absente/illisible → attribution sans 'Le …'", () => {
    const m = msg({ from: { name: "Bob", email: "b@y.fr" }, date: "", bodyText: "x" });
    expect(buildQuotedBody(m).split("\n")[0]).toBe("Bob a écrit :");
  });
});

describe("buildReplyParams", () => {
  it("agrège sujet Re: + destinataire + headers + threadId", () => {
    const t = thread([
      msg({ subject: "Bonjour", from: { name: "A", email: "a@x.fr" }, messageId: "<id1>" }),
    ]);
    expect(buildReplyParams(t, "me@x.fr")).toEqual({
      threadId: "t1",
      to: "a@x.fr",
      subject: "Re: Bonjour",
      inReplyTo: "<id1>",
      references: "<id1>",
    });
  });
});

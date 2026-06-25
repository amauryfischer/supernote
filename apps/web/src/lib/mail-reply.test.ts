import { describe, it, expect } from "vitest";
import { ensureRe, pickReplyTo, replyHeaders, buildReplyParams } from "./mail-reply";
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

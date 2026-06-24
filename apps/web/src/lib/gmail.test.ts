import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getGmailProfile, parseGmailMessage, parseAddress, decodeBody, type GmailRawMessage } from "./gmail";

// requestAccessToken touche GIS → on le stubbe pour tous les tests gmail.
vi.mock("./google-drive", () => ({
  requestAccessToken: vi.fn(async () => "fake-token"),
}));

describe("getGmailProfile", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ emailAddress: "me@example.com" }),
      })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renvoie l'adresse du compte connecté", async () => {
    const email = await getGmailProfile("cid");
    expect(email).toBe("me@example.com");
  });
});

describe("parseAddress", () => {
  it('découpe "Nom <email>"', () => {
    expect(parseAddress("Ada Lovelace <ada@calc.io>")).toEqual({ name: "Ada Lovelace", email: "ada@calc.io" });
  });
  it("email nu → name = email", () => {
    expect(parseAddress("ada@calc.io")).toEqual({ name: "ada@calc.io", email: "ada@calc.io" });
  });
  it("chaîne vide → vide", () => {
    expect(parseAddress("")).toEqual({ name: "", email: "" });
  });
});

describe("decodeBody", () => {
  it("décode du base64url", () => {
    // "Héllo" en UTF-8 → base64url
    const b64url = "SMOpbGxv";
    expect(decodeBody(b64url)).toBe("Héllo");
  });
});

describe("parseGmailMessage", () => {
  const raw: GmailRawMessage = {
    id: "m1",
    threadId: "t1",
    snippet: "Aperçu...",
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "Subject", value: "Réunion" },
        { name: "From", value: "Ada <ada@calc.io>" },
        { name: "To", value: "Bob <bob@x.io>, carol@x.io" },
        { name: "Date", value: "Tue, 23 Jun 2026 10:00:00 +0200" },
      ],
      parts: [
        { mimeType: "text/plain", body: { data: "Qm9uam91cg" } }, // "Bonjour"
        { mimeType: "text/html", body: { data: "PGI+aGk8L2I+" } }, // "<b>hi</b>"
      ],
    },
  };

  it("normalise en EmailMessage (corps = text/plain)", () => {
    const m = parseGmailMessage(raw);
    expect(m.id).toBe("m1");
    expect(m.threadId).toBe("t1");
    expect(m.subject).toBe("Réunion");
    expect(m.from).toEqual({ name: "Ada", email: "ada@calc.io" });
    expect(m.to).toEqual([
      { name: "Bob", email: "bob@x.io" },
      { name: "carol@x.io", email: "carol@x.io" },
    ]);
    expect(m.snippet).toBe("Aperçu...");
    expect(m.bodyText).toBe("Bonjour");
    expect(m.date).toMatch(/^2026-06-23/);
    expect(m.webLink).toBe("https://mail.google.com/mail/u/0/#all/m1");
  });

  it("headers manquants → champs vides, pas de throw", () => {
    const m = parseGmailMessage({ id: "x", threadId: "x", payload: { headers: [] } });
    expect(m.subject).toBe("");
    expect(m.from).toEqual({ name: "", email: "" });
    expect(m.bodyText).toBe("");
  });
});

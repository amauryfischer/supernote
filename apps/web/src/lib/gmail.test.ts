import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getGmailProfile, parseGmailMessage, parseAddress, decodeBody, type GmailRawMessage } from "./gmail";
import { searchThreads, getThread, listThreadSummaries, type ThreadSummary } from "./gmail";
import { toBase64Url, buildRawMessage, GMAIL_COMPOSE_SCOPE } from "./gmail";

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

  it("ne renvoie pas un mono-part binaire comme corps", () => {
    const m = parseGmailMessage({
      id: "b",
      threadId: "b",
      payload: {
        mimeType: "image/png",
        headers: [{ name: "Subject", value: "Photo" }],
        body: { data: "iVBORw0KGgo" }, // entête PNG, pas du texte
      },
    });
    expect(m.bodyText).toBe("");
  });

  it("descend dans un multipart imbriqué (mixed → alternative → text/plain)", () => {
    const m = parseGmailMessage({
      id: "n",
      threadId: "n",
      payload: {
        mimeType: "multipart/mixed",
        headers: [],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [{ mimeType: "text/plain", body: { data: "Qm9uam91cg" } }], // "Bonjour"
          },
        ],
      },
    });
    expect(m.bodyText).toBe("Bonjour");
  });
});

describe("searchThreads", () => {
  it("retourne les threads (id + snippet)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          threads: [
            { id: "t1", snippet: "premier" },
            { id: "t2", snippet: "second" },
          ],
        }),
      })),
    );
    const out: ThreadSummary[] = await searchThreads("cid", "is:unread");
    expect(out.map((t) => t.id)).toEqual(["t1", "t2"]);
    vi.unstubAllGlobals();
  });

  it("aucun résultat → []", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    expect(await searchThreads("cid", "vide")).toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe("getThread", () => {
  it("parse tous les messages du thread", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          id: "t1",
          messages: [
            {
              id: "m1",
              threadId: "t1",
              snippet: "s",
              payload: { headers: [{ name: "Subject", value: "Hi" }] },
            },
          ],
        }),
      })),
    );
    const thread = await getThread("cid", "t1");
    expect(thread.id).toBe("t1");
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]!.subject).toBe("Hi");
    vi.unstubAllGlobals();
  });
});

describe("listThreadSummaries", () => {
  it("enrichit chaque thread avec sujet/expéditeur/date (list + metadata)", async () => {
    const fetchMock = vi
      .fn()
      // 1) threads.list
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: [{ id: "t1", snippet: "snip" }] }),
      })
      // 2) threads.get?format=metadata (t1)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "t1",
          snippet: "snip",
          messages: [
            {
              id: "m1",
              threadId: "t1",
              snippet: "snip",
              payload: {
                headers: [
                  { name: "Subject", value: "Réunion" },
                  { name: "From", value: "Ada <ada@calc.io>" },
                  { name: "Date", value: "Tue, 23 Jun 2026 10:00:00 +0200" },
                ],
              },
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const items = await listThreadSummaries("cid", "in:inbox");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "t1",
      subject: "Réunion",
      from: { name: "Ada", email: "ada@calc.io" },
      snippet: "snip",
    });
    expect(items[0]!.date).toMatch(/^2026-06-23/);
    vi.unstubAllGlobals();
  });
});

describe("toBase64Url", () => {
  it("encode en base64url et round-trip avec decodeBody", () => {
    const enc = toBase64Url("Héllo 👋");
    expect(enc).not.toMatch(/[+/=]/); // url-safe, sans padding
    expect(decodeBody(enc)).toBe("Héllo 👋");
  });
});

describe("buildRawMessage", () => {
  it("inclut To, Subject, corps, charset UTF-8", () => {
    const raw = buildRawMessage({ to: "ada@calc.io", subject: "Bonjour", body: "Coucou" });
    expect(raw).toContain("To: ada@calc.io");
    expect(raw).toContain("Subject: Bonjour");
    expect(raw).toMatch(/charset="?UTF-8"?/i);
    expect(raw).toContain("Coucou");
  });
  it("encode (RFC2047) un sujet non-ASCII", () => {
    const raw = buildRawMessage({ subject: "Réunion café", body: "x" });
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?.+\?=/);
  });
  it("omet To si absent", () => {
    const raw = buildRawMessage({ subject: "s", body: "b" });
    expect(raw).not.toMatch(/^To:/m);
  });
});

describe("GMAIL_COMPOSE_SCOPE", () => {
  it("est le scope compose", () => {
    expect(GMAIL_COMPOSE_SCOPE).toBe("https://www.googleapis.com/auth/gmail.compose");
  });
});

import { createDraft, buildGmailDraftUrl } from "./gmail";
import { requestAccessToken } from "./google-drive";

describe("createDraft", () => {
  it("POST /drafts avec message raw et renvoie draftId; scope compose", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "draft_1", message: { id: "m1" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await createDraft("cid", { to: "a@b.io", subject: "Hi", body: "yo" });
    expect(out.draftId).toBe("draft_1");
    expect(vi.mocked(requestAccessToken)).toHaveBeenCalledWith(
      "cid",
      expect.objectContaining({ scope: "https://www.googleapis.com/auth/gmail.compose" }),
    );
    const call = fetchMock.mock.calls[0] as [unknown, RequestInit] | undefined;
    expect(String(call?.[0])).toContain("/drafts");
    const init = call?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("raw");
    vi.unstubAllGlobals();
  });

  it("lève une erreur explicite sur réponse non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, text: async () => "denied" })));
    await expect(createDraft("cid", { subject: "s", body: "b" })).rejects.toThrow(/Gmail draft 403/);
    vi.unstubAllGlobals();
  });

  it("lève si la réponse 200 n'a pas d'id (pas de fausse réussite)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    await expect(createDraft("cid", { subject: "s", body: "b" })).rejects.toThrow(/sans id/);
    vi.unstubAllGlobals();
  });
});

describe("buildGmailDraftUrl", () => {
  it("construit l'URL du brouillon", () => {
    expect(buildGmailDraftUrl("draft_1")).toContain("draft_1");
    expect(buildGmailDraftUrl("draft_1")).toMatch(/^https:\/\/mail\.google\.com\//);
  });
});

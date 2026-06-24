import { describe, it, expect } from "vitest";
import { buildGmailThreadUrl } from "./gmailEmbedUrl";

describe("buildGmailThreadUrl", () => {
  it("construit l'URL web Gmail d'un thread", () => {
    expect(buildGmailThreadUrl("abc123")).toBe("https://mail.google.com/mail/u/0/#all/abc123");
  });
  it("encode les caractères spéciaux du threadId", () => {
    expect(buildGmailThreadUrl("a/b")).toBe("https://mail.google.com/mail/u/0/#all/a%2Fb");
  });
  it("threadId vide → chaîne vide", () => {
    expect(buildGmailThreadUrl("")).toBe("");
  });
});

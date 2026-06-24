import { describe, it, expect } from "vitest";
import { emailToMarkdown, emailSourceValue, autoMapBaseFields } from "./mail-capture";
import type { EmailMessage } from "@/lib/gmail";

const msg: EmailMessage = {
  id: "m1",
  threadId: "t1",
  subject: "Compte rendu réunion",
  from: { name: "Ada Lovelace", email: "ada@calc.io" },
  to: [{ name: "Bob", email: "bob@x.io" }],
  date: "2026-06-23T08:00:00.000Z",
  snippet: "Voici le compte rendu…",
  bodyText: "Bonjour,\n\nVoici le compte rendu.\n\nAda",
  webLink: "https://mail.google.com/mail/u/0/#all/m1",
};

describe("emailToMarkdown", () => {
  it("compose un corps avec en-tête De/Date + corps", () => {
    const md = emailToMarkdown(msg);
    expect(md).toContain("**De :** Ada Lovelace <ada@calc.io>");
    expect(md).toContain("Voici le compte rendu.");
    expect(md).toContain("[Ouvrir dans Gmail]");
  });
});

describe("emailSourceValue", () => {
  it("résout chaque source", () => {
    expect(emailSourceValue(msg, "subject")).toBe("Compte rendu réunion");
    expect(emailSourceValue(msg, "fromName")).toBe("Ada Lovelace");
    expect(emailSourceValue(msg, "fromEmail")).toBe("ada@calc.io");
    expect(emailSourceValue(msg, "date")).toBe("2026-06-23T08:00:00.000Z");
    expect(emailSourceValue(msg, "snippet")).toBe("Voici le compte rendu…");
    expect(emailSourceValue(msg, "body")).toContain("Bonjour");
  });
});

describe("autoMapBaseFields", () => {
  it("auto-mappe par nom/type (titre→subject, email→fromEmail, date→date)", () => {
    const fields = [
      { name: "title", label: "Titre", type: "text" },
      { name: "email", label: "Email", type: "email" },
      { name: "received", label: "Reçu le", type: "date" },
      { name: "priority", label: "Priorité", type: "select" },
    ];
    const map = autoMapBaseFields(fields);
    expect(map.title).toBe("subject");
    expect(map.email).toBe("fromEmail");
    expect(map.received).toBe("date");
    expect(map.priority).toBe(""); // select non auto-mappable
  });
});

import { describe, it, expect } from "vitest";
import type { EmailMessage } from "./gmail";
import {
  buildEventDraft,
  buildGoogleCalendarUrl,
  buildIcs,
  buildIcsDataUrl,
  detectDateTime,
  formatLocalStamp,
  formatUtcStamp,
  DEFAULT_EVENT_DURATION_MS,
} from "./email-to-event";

function msg(over: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: "m1",
    threadId: "t1",
    subject: "Réunion projet",
    from: { name: "Alice Martin", email: "alice@acme.fr" },
    to: [{ name: "Moi", email: "me@acme.fr" }],
    date: "2026-06-20T10:00:00.000Z",
    snippet: "On se voit bientôt",
    bodyText: "Bonjour,\n\nOn se cale ça ?\n\nCordialement,\nAlice",
    webLink: "https://mail.google.com/mail/u/0/#all/m1",
    ...over,
  };
}

describe("formatLocalStamp / formatUtcStamp", () => {
  it("formate l'estampille locale YYYYMMDDTHHMMSS", () => {
    const d = new Date(2026, 5, 12, 14, 30, 0); // 12 juin 2026 14:30 local
    expect(formatLocalStamp(d)).toBe("20260612T143000");
  });

  it("formate l'estampille UTC avec Z", () => {
    const d = new Date(Date.UTC(2026, 5, 12, 8, 5, 9));
    expect(formatUtcStamp(d)).toBe("20260612T080509Z");
  });
});

describe("detectDateTime", () => {
  const now = new Date(2026, 0, 1, 12, 0, 0);

  it("renvoie null quand rien à détecter", () => {
    expect(detectDateTime("aucune date ici", now)).toBeNull();
    expect(detectDateTime("", now)).toBeNull();
  });

  it("détecte une date ISO", () => {
    const d = detectDateTime("le 2026-06-12 ça te va ?", now);
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(5);
    expect(d!.getDate()).toBe(12);
  });

  it("détecte une date FR numérique jour/mois/année", () => {
    const d = detectDateTime("rdv le 12/06/2026", now);
    expect(d!.getDate()).toBe(12);
    expect(d!.getMonth()).toBe(5);
    expect(d!.getFullYear()).toBe(2026);
  });

  it("complète l'année courante quand absente", () => {
    const d = detectDateTime("le 03/07 si possible", now);
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(6);
    expect(d!.getDate()).toBe(3);
  });

  it("détecte un mois textuel FR avec heure", () => {
    const d = detectDateTime("on se voit le 12 juin 2026 à 14h30", now);
    expect(d!.getMonth()).toBe(5);
    expect(d!.getDate()).toBe(12);
    expect(d!.getHours()).toBe(14);
    expect(d!.getMinutes()).toBe(30);
  });

  it("détecte un mois textuel EN month-day", () => {
    const d = detectDateTime("see you June 12, 2026", now);
    expect(d!.getMonth()).toBe(5);
    expect(d!.getDate()).toBe(12);
  });

  it("interprète l'heure 12h (pm/am)", () => {
    const pm = detectDateTime("call at 2pm on 2026-06-12", now);
    expect(pm!.getHours()).toBe(14);
    const am = detectDateTime("meet at 9 am on 2026-06-12", now);
    expect(am!.getHours()).toBe(9);
    const noon = detectDateTime("call at 12pm on 2026-06-12", now);
    expect(noon!.getHours()).toBe(12);
    const midnight = detectDateTime("call at 12am on 2026-06-12", now);
    expect(midnight!.getHours()).toBe(0);
  });

  it("défaut 9h quand jour sans heure", () => {
    const d = detectDateTime("rdv le 12/06/2026", now);
    expect(d!.getHours()).toBe(9);
    expect(d!.getMinutes()).toBe(0);
  });
});

describe("buildEventDraft", () => {
  it("titre = sujet, détails = de + corps propre + lien", () => {
    const draft = buildEventDraft(msg(), { detectDate: false });
    expect(draft.title).toBe("Réunion projet");
    expect(draft.details).toContain("De : Alice Martin");
    expect(draft.details).toContain("On se cale ça ?");
    // signature retirée par parseEmailBody
    expect(draft.details).not.toContain("Cordialement");
    expect(draft.details).toContain("https://mail.google.com/mail/u/0/#all/m1");
  });

  it("titre fallback quand sujet vide", () => {
    const draft = buildEventDraft(msg({ subject: "" }), { detectDate: false });
    expect(draft.title).toBe("Évènement (email)");
  });

  it("pas de date sans détection", () => {
    const draft = buildEventDraft(msg(), { detectDate: false });
    expect(draft.start).toBeNull();
    expect(draft.end).toBeNull();
  });

  it("détecte la date et cale une fin = start + durée par défaut", () => {
    const draft = buildEventDraft(
      msg({ bodyText: "Rdv le 12/06/2026 à 14h pour le point." }),
      { detectDate: true, now: new Date(2026, 0, 1) },
    );
    expect(draft.start).not.toBeNull();
    expect(draft.end!.getTime() - draft.start!.getTime()).toBe(DEFAULT_EVENT_DURATION_MS);
  });

  it("tronque un corps très long", () => {
    const big = "x".repeat(2000);
    const draft = buildEventDraft(msg({ bodyText: big, subject: "S" }), { detectDate: false });
    expect(draft.details).toContain("…");
    expect(draft.details.length).toBeLessThan(1000);
  });
});

describe("buildGoogleCalendarUrl", () => {
  it("URL TEMPLATE avec params encodés", () => {
    const url = buildGoogleCalendarUrl(msg(), { detectDate: false });
    expect(url.startsWith("https://calendar.google.com/calendar/render?")).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("action")).toBe("TEMPLATE");
    expect(parsed.searchParams.get("text")).toBe("Réunion projet");
    expect(parsed.searchParams.get("details")).toContain("De : Alice Martin");
    // l'encodage round-trip correctement (accents, espaces)
    expect(url).toContain("text=R%C3%A9union+projet");
  });

  it("omet dates sans détection", () => {
    const url = buildGoogleCalendarUrl(msg(), { detectDate: false });
    expect(new URL(url).searchParams.get("dates")).toBeNull();
  });

  it("injecte dates au format plage quand détecté", () => {
    const url = buildGoogleCalendarUrl(
      msg({ bodyText: "Rdv le 12/06/2026 à 14h." }),
      { detectDate: true, now: new Date(2026, 0, 1) },
    );
    const dates = new URL(url).searchParams.get("dates");
    expect(dates).toBe("20260612T140000/20260612T150000");
  });
});

describe("buildIcs", () => {
  const fixedNow = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));

  it("produit un VCALENDAR/VEVENT bien formé", () => {
    const ics = buildIcs(msg(), { detectDate: false, now: fixedNow });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    // séparateur CRLF
    expect(ics).toContain("\r\n");
    expect(ics).not.toMatch(/[^\r]\n/); // pas de LF orphelin
  });

  it("UID dérivé de l'id du message", () => {
    const ics = buildIcs(msg(), { detectDate: false, now: fixedNow });
    expect(ics).toContain("UID:m1@supernote.mail");
  });

  it("SUMMARY = sujet, DTSTART/DTEND présents", () => {
    const ics = buildIcs(msg(), { detectDate: false, now: fixedNow });
    expect(ics).toContain("SUMMARY:Réunion projet");
    expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
    expect(ics).toMatch(/DTEND:\d{8}T\d{6}Z/);
  });

  it("échappe les caractères spéciaux ICS (virgule, point-virgule, retour ligne)", () => {
    const ics = buildIcs(
      msg({ subject: "A; B, C\nD", bodyText: "x", webLink: "" }),
      { detectDate: false, now: fixedNow },
    );
    expect(ics).toContain("SUMMARY:A\\; B\\, C\\nD");
  });

  it("cale sur now quand aucune date détectée, fin = +1h", () => {
    const ics = buildIcs(msg(), { detectDate: false, now: fixedNow });
    expect(ics).toContain(`DTSTART:${formatUtcStamp(fixedNow)}`);
    const end = new Date(fixedNow.getTime() + DEFAULT_EVENT_DURATION_MS);
    expect(ics).toContain(`DTEND:${formatUtcStamp(end)}`);
  });

  it("plie les lignes longues à 75 octets", () => {
    const ics = buildIcs(
      msg({ subject: "x".repeat(200), webLink: "" }),
      { detectDate: false, now: fixedNow },
    );
    for (const line of ics.split("\r\n")) {
      // une ligne pliée commence par un espace ; chaque segment <= 75
      expect(line.length).toBeLessThanOrEqual(75);
    }
  });
});

describe("buildIcsDataUrl", () => {
  it("produit une data-URL text/calendar décodable", () => {
    const url = buildIcsDataUrl(msg(), { detectDate: false, now: new Date(Date.UTC(2026, 0, 1)) });
    expect(url.startsWith("data:text/calendar;charset=utf-8,")).toBe(true);
    const decoded = decodeURIComponent(url.slice("data:text/calendar;charset=utf-8,".length));
    expect(decoded).toContain("BEGIN:VCALENDAR");
    expect(decoded).toContain("SUMMARY:Réunion projet");
  });
});

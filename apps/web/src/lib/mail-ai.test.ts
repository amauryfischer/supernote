import { afterEach, describe, expect, it, vi } from "vitest";

// Mock des dépendances à effet de bord pour que l'import du module reste pur en
// environnement node (pas de window, pas de réseau). Seules les fonctions PURES
// (builders de prompt + parsing) et `isAiConfigured` sont testées ici.
const getAiSettingsMock = vi.fn<() => { baseUrl: string; model: string }>(() => ({
  baseUrl: "http://127.0.0.1:11434",
  model: "llama3.2",
}));

vi.mock("@/lib/ai/settings", () => ({
  getAiSettings: () => getAiSettingsMock(),
}));

import {
  buildClassifyQuadrantPrompt,
  buildExtractActionsPrompt,
  buildReplyPrompt,
  buildSummaryPrompt,
  isAiConfigured,
  parseActionsResponse,
  parseQuadrantResponse,
  serializeThread,
  threadSubject,
  type MailAiThread,
} from "./mail-ai";

function makeThread(overrides?: Partial<MailAiThread>): MailAiThread {
  return {
    id: "t1",
    messages: [
      {
        subject: "Réunion budget Q3",
        from: { name: "Alice Martin", email: "alice@example.com" },
        date: "2026-06-20T10:00:00Z",
        bodyText: "Bonjour, peux-tu valider le budget avant vendredi ?",
      },
      {
        subject: "Re: Réunion budget Q3",
        from: { name: "Bob Durand", email: "bob@example.com" },
        date: "2026-06-21T09:00:00Z",
        bodyText: "Oui, je regarde ça aujourd'hui et je reviens vers toi.",
      },
    ],
    ...overrides,
  };
}

describe("isAiConfigured", () => {
  afterEach(() => {
    getAiSettingsMock.mockReturnValue({
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.2",
    });
  });

  it("vrai quand baseUrl et model sont renseignés", () => {
    getAiSettingsMock.mockReturnValue({
      baseUrl: "http://127.0.0.1:11434",
      model: "llama3.2",
    });
    expect(isAiConfigured()).toBe(true);
  });

  it("faux quand le model est vide", () => {
    getAiSettingsMock.mockReturnValue({ baseUrl: "http://127.0.0.1:11434", model: "" });
    expect(isAiConfigured()).toBe(false);
  });

  it("faux quand le model est blanc", () => {
    getAiSettingsMock.mockReturnValue({ baseUrl: "http://127.0.0.1:11434", model: "   " });
    expect(isAiConfigured()).toBe(false);
  });

  it("faux quand baseUrl est vide", () => {
    getAiSettingsMock.mockReturnValue({ baseUrl: "", model: "llama3.2" });
    expect(isAiConfigured()).toBe(false);
  });
});

describe("serializeThread", () => {
  it("sérialise expéditeur + objet + corps en texte brut", () => {
    const out = serializeThread(makeThread());
    expect(out).toContain("Alice Martin <alice@example.com>");
    expect(out).toContain("Objet : Réunion budget Q3");
    expect(out).toContain("valider le budget avant vendredi");
    expect(out).toContain("Bob Durand <bob@example.com>");
  });

  it("tronque un corps trop long avec un marqueur", () => {
    const long = "x".repeat(5000);
    const out = serializeThread(
      makeThread({
        messages: [
          {
            subject: "Long",
            from: { name: "A", email: "a@b.c" },
            date: "",
            bodyText: long,
          },
        ],
      }),
    );
    expect(out).toContain("…");
    expect(out.length).toBeLessThan(long.length);
  });

  it("ne garde que les messages les plus récents au-delà de la limite", () => {
    const many: MailAiThread = {
      id: "t",
      messages: Array.from({ length: 20 }, (_, i) => ({
        subject: `S${i}`,
        from: { name: `N${i}`, email: `n${i}@x.y` },
        date: "",
        bodyText: `corps-${i}`,
      })),
    };
    const out = serializeThread(many);
    // Le message 0 (le plus ancien) doit avoir été élagué.
    expect(out).not.toContain("corps-0");
    expect(out).toContain("corps-19");
  });

  it("gère un expéditeur sans nom (email seul) et un objet vide", () => {
    const out = serializeThread(
      makeThread({
        messages: [
          {
            subject: "",
            from: { name: "", email: "x@y.z" },
            date: "",
            bodyText: "salut",
          },
        ],
      }),
    );
    expect(out).toContain("De : x@y.z");
    expect(out).toContain("Objet : (sans objet)");
  });
});

describe("threadSubject", () => {
  it("renvoie l'objet du premier message", () => {
    expect(threadSubject(makeThread())).toBe("Réunion budget Q3");
  });

  it("fallback explicite si pas de message", () => {
    expect(threadSubject({ id: "t", messages: [] })).toBe("(sans objet)");
  });
});

describe("buildSummaryPrompt", () => {
  it("contient la consigne de résumé, l'objet et le corps", () => {
    const p = buildSummaryPrompt(makeThread());
    expect(p).toMatch(/résume/i);
    expect(p).toContain("Objet du fil : Réunion budget Q3");
    expect(p).toContain("Fil de discussion :");
    expect(p).toContain("valider le budget avant vendredi");
  });

  it("est déterministe", () => {
    expect(buildSummaryPrompt(makeThread())).toBe(buildSummaryPrompt(makeThread()));
  });
});

describe("buildReplyPrompt", () => {
  it("contient la consigne de réponse, l'objet et le fil", () => {
    const p = buildReplyPrompt(makeThread());
    expect(p).toMatch(/brouillon/i);
    expect(p).toContain("Objet du fil : Réunion budget Q3");
    expect(p).toContain("Fil de discussion :");
  });

  it("intègre la consigne utilisateur quand fournie", () => {
    const p = buildReplyPrompt(makeThread(), { instruction: "Sois bref et formel" });
    expect(p).toContain("Sois bref et formel");
  });

  it("intègre les notes de contexte quand fournies", () => {
    const p = buildReplyPrompt(makeThread(), {
      contextNotes: ["Note interne sur le budget Q3", "Décision validée par la direction"],
    });
    expect(p).toContain("Contexte issu de tes notes");
    expect(p).toContain("[Note 1] Note interne sur le budget Q3");
    expect(p).toContain("[Note 2] Décision validée par la direction");
  });

  it("n'ajoute pas de section contexte quand aucune note", () => {
    const p = buildReplyPrompt(makeThread(), { contextNotes: [] });
    expect(p).not.toContain("Contexte issu de tes notes");
  });

  it("cible le destinataire externe quand `recipient` fourni (associé = contexte)", () => {
    const p = buildReplyPrompt(makeThread(), { recipient: "Client <client@acme.com>" });
    expect(p).toContain("ADRESSÉE à : Client <client@acme.com>");
    expect(p).toMatch(/notre organisation.*NOTRE côté/s);
  });

  it("pas de section destinataire sans `recipient`", () => {
    const p = buildReplyPrompt(makeThread());
    expect(p).not.toContain("ADRESSÉE à");
  });
});

describe("buildClassifyQuadrantPrompt", () => {
  it("liste les 4 quadrants, exige du JSON et inclut le fil", () => {
    const p = buildClassifyQuadrantPrompt(makeThread());
    expect(p).toContain('"do"');
    expect(p).toContain('"schedule"');
    expect(p).toContain('"delegate"');
    expect(p).toContain('"eliminate"');
    expect(p).toMatch(/JSON/);
    expect(p).toContain("Objet du fil : Réunion budget Q3");
  });
});

describe("buildExtractActionsPrompt", () => {
  it("exige un tableau JSON d'actions et inclut le fil", () => {
    const p = buildExtractActionsPrompt(makeThread());
    expect(p).toMatch(/JSON/);
    expect(p).toContain('{"text": "..."}');
    expect(p).toContain("Fil de discussion :");
  });
});

describe("parseQuadrantResponse", () => {
  it("parse un JSON valide", () => {
    expect(parseQuadrantResponse('{"quadrant": "do"}')).toBe("do");
    expect(parseQuadrantResponse('{"quadrant":"delegate"}')).toBe("delegate");
  });

  it("parse un JSON entouré de prose / fences", () => {
    expect(parseQuadrantResponse('Voici: ```json\n{"quadrant": "eliminate"}\n```')).toBe(
      "eliminate",
    );
  });

  it("retombe sur le mot-clé brut si pas de JSON exploitable", () => {
    expect(parseQuadrantResponse("Je pense que c'est à schedule")).toBe("schedule");
    expect(parseQuadrantResponse("clearly DO this now")).toBe("do");
  });

  it("fallback 'schedule' sur JSON invalide", () => {
    expect(parseQuadrantResponse("{not json}")).toBe("schedule");
  });

  it("fallback 'schedule' sur quadrant inconnu dans le JSON", () => {
    expect(parseQuadrantResponse('{"quadrant": "later"}')).toBe("schedule");
  });

  it("fallback 'schedule' sur réponse vide", () => {
    expect(parseQuadrantResponse("")).toBe("schedule");
  });
});

describe("parseActionsResponse", () => {
  it("parse un tableau d'objets {text}", () => {
    expect(
      parseActionsResponse('[{"text": "Valider le budget"}, {"text": "Répondre à Bob"}]'),
    ).toEqual([{ text: "Valider le budget" }, { text: "Répondre à Bob" }]);
  });

  it("parse un tableau de chaînes", () => {
    expect(parseActionsResponse('["Faire A", "Faire B"]')).toEqual([
      { text: "Faire A" },
      { text: "Faire B" },
    ]);
  });

  it("ignore les entrées vides et déduplique", () => {
    expect(
      parseActionsResponse('[{"text": "A"}, {"text": "  "}, {"text": "a"}, {"text": "B"}]'),
    ).toEqual([{ text: "A" }, { text: "B" }]);
  });

  it("retourne [] sur JSON invalide ou absence de tableau", () => {
    expect(parseActionsResponse("pas de json")).toEqual([]);
    expect(parseActionsResponse('{"text": "x"}')).toEqual([]);
    expect(parseActionsResponse("")).toEqual([]);
  });

  it("extrait le tableau JSON même entouré de prose", () => {
    expect(parseActionsResponse('Actions: [{"text": "X"}] voilà')).toEqual([{ text: "X" }]);
  });
});

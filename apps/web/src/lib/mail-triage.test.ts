import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actionToLabelOps,
  addSnooze,
  INBOX_LABEL,
  listDue,
  loadSnoozed,
  nextMonday,
  removeSnooze,
  saveSnoozed,
  SNOOZE_PRESETS,
  SNOOZE_STORAGE_KEY,
  tonight,
  tomorrowMorning,
  type SnoozeEntry,
} from "./mail-triage";

// ─── Stub localStorage (l'environnement vitest est `node`, pas de DOM) ────────

function installLocalStorage(): Record<string, string> {
  const backing: Record<string, string> = {};
  const stub: Storage = {
    get length() {
      return Object.keys(backing).length;
    },
    clear: () => {
      for (const k of Object.keys(backing)) delete backing[k];
    },
    getItem: (k: string) => (k in backing ? backing[k]! : null),
    key: (i: number) => Object.keys(backing)[i] ?? null,
    removeItem: (k: string) => {
      delete backing[k];
    },
    setItem: (k: string, v: string) => {
      backing[k] = String(v);
    },
  };
  vi.stubGlobal("window", { localStorage: stub });
  return backing;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── actionToLabelOps (mapping pur) ───────────────────────────────────────────

describe("actionToLabelOps", () => {
  it("Done retire INBOX, n'ajoute rien", () => {
    expect(actionToLabelOps("done")).toEqual({ addLabelIds: [], removeLabelIds: [INBOX_LABEL] });
  });

  it("Archive retire INBOX (identique à Done côté Gmail)", () => {
    expect(actionToLabelOps("archive")).toEqual({ addLabelIds: [], removeLabelIds: ["INBOX"] });
  });

  it("Snooze retire INBOX (l'échéance est gérée par le store, pas par les labels)", () => {
    expect(actionToLabelOps("snooze")).toEqual({ addLabelIds: [], removeLabelIds: ["INBOX"] });
  });
});

// ─── Store snooze : load / save / dédoublonnage ───────────────────────────────

describe("loadSnoozed / saveSnoozed", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("renvoie [] quand le store est vide", () => {
    expect(loadSnoozed()).toEqual([]);
  });

  it("persiste puis relit des entrées", () => {
    const entries: SnoozeEntry[] = [
      { threadId: "t1", until: 1000 },
      { threadId: "t2", until: 2000 },
    ];
    saveSnoozed(entries);
    expect(loadSnoozed()).toEqual(entries);
  });

  it("dédoublonne par threadId à l'écriture (la dernière entrée gagne)", () => {
    saveSnoozed([
      { threadId: "t1", until: 1000 },
      { threadId: "t1", until: 5000 },
    ]);
    expect(loadSnoozed()).toEqual([{ threadId: "t1", until: 5000 }]);
  });

  it("ignore un JSON invalide sans lever", () => {
    window.localStorage.setItem(SNOOZE_STORAGE_KEY, "{pas du json");
    expect(loadSnoozed()).toEqual([]);
  });

  it("filtre les entrées malformées (champ manquant / type faux)", () => {
    window.localStorage.setItem(
      SNOOZE_STORAGE_KEY,
      JSON.stringify([
        { threadId: "ok", until: 42 },
        { threadId: "", until: 1 }, // threadId vide → rejeté
        { threadId: "x", until: "non-num" }, // until non numérique → rejeté
        { until: 5 }, // pas de threadId → rejeté
        "scalaire", // pas un objet → rejeté
      ]),
    );
    expect(loadSnoozed()).toEqual([{ threadId: "ok", until: 42 }]);
  });

  it("renvoie [] quand window est absent (garde SSR/node)", () => {
    // Pas de localStorage installé sur ce test → window indéfini.
    expect(loadSnoozed()).toEqual([]);
  });
});

describe("addSnooze / removeSnooze", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("addSnooze ajoute une échéance et persiste", () => {
    addSnooze("t1", 1234);
    expect(loadSnoozed()).toEqual([{ threadId: "t1", until: 1234 }]);
  });

  it("addSnooze remplace l'échéance d'un thread déjà snoozé (re-snooze)", () => {
    addSnooze("t1", 1000);
    const after = addSnooze("t1", 9000);
    expect(after).toEqual([{ threadId: "t1", until: 9000 }]);
    expect(loadSnoozed()).toEqual([{ threadId: "t1", until: 9000 }]);
  });

  it("removeSnooze retire l'échéance d'un thread", () => {
    saveSnoozed([
      { threadId: "t1", until: 1 },
      { threadId: "t2", until: 2 },
    ]);
    removeSnooze("t1");
    expect(loadSnoozed()).toEqual([{ threadId: "t2", until: 2 }]);
  });

  it("removeSnooze est un no-op pour un thread absent", () => {
    saveSnoozed([{ threadId: "t1", until: 1 }]);
    removeSnooze("inconnu");
    expect(loadSnoozed()).toEqual([{ threadId: "t1", until: 1 }]);
  });
});

// ─── listDue (horloge injectée) ───────────────────────────────────────────────

describe("listDue", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("renvoie les threads dont l'échéance est atteinte (until <= now)", () => {
    saveSnoozed([
      { threadId: "passe", until: 100 },
      { threadId: "pile", until: 500 },
      { threadId: "futur", until: 900 },
    ]);
    expect(listDue(500)).toEqual([
      { threadId: "passe", until: 100 },
      { threadId: "pile", until: 500 },
    ]);
  });

  it("renvoie [] si rien n'est dû", () => {
    saveSnoozed([{ threadId: "futur", until: 9_999 }]);
    expect(listDue(0)).toEqual([]);
  });
});

// ─── Presets d'échéance (calcul pur sur Date injectée) ────────────────────────

describe("snooze presets (calcul d'échéance)", () => {
  it("tonight = 18 h aujourd'hui quand on est le matin", () => {
    const now = new Date(2026, 5, 25, 9, 0, 0); // 25 juin 2026, 09:00
    const until = new Date(tonight(now));
    expect(until.getHours()).toBe(18);
    expect(until.getDate()).toBe(25);
  });

  it("tonight bascule à demain 18 h si on est déjà après 18 h", () => {
    const now = new Date(2026, 5, 25, 20, 0, 0); // 20:00
    const until = new Date(tonight(now));
    expect(until.getHours()).toBe(18);
    expect(until.getDate()).toBe(26); // lendemain
  });

  it("tomorrowMorning = 8 h le lendemain", () => {
    const now = new Date(2026, 5, 25, 14, 0, 0);
    const until = new Date(tomorrowMorning(now));
    expect(until.getHours()).toBe(8);
    expect(until.getDate()).toBe(26);
  });

  it("nextMonday vise le lundi suivant 8 h (depuis un jeudi)", () => {
    // 25 juin 2026 est un jeudi → prochain lundi = 29 juin.
    const now = new Date(2026, 5, 25, 10, 0, 0);
    const until = new Date(nextMonday(now));
    expect(until.getDay()).toBe(1); // lundi
    expect(until.getDate()).toBe(29);
    expect(until.getHours()).toBe(8);
  });

  it("nextMonday saute d'une semaine quand on est déjà lundi", () => {
    // 29 juin 2026 est un lundi → on vise le lundi 6 juillet.
    const now = new Date(2026, 5, 29, 10, 0, 0);
    const until = new Date(nextMonday(now));
    expect(until.getDay()).toBe(1);
    expect(until.getDate()).toBe(6);
    expect(until.getMonth()).toBe(6); // juillet (0-indexé)
  });

  it("toutes les échéances calculées sont strictement futures", () => {
    const now = new Date(2026, 5, 25, 18, 30, 0); // après 18 h, pile un cas limite
    for (const preset of SNOOZE_PRESETS) {
      expect(preset.computeUntil(now)).toBeGreaterThan(now.getTime());
    }
  });

  it("expose 3 presets dans l'ordre attendu", () => {
    expect(SNOOZE_PRESETS.map((p) => p.id)).toEqual(["tonight", "tomorrow", "monday"]);
  });
});

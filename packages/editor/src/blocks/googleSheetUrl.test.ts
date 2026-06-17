import { describe, it, expect } from "vitest";
import {
  parseGoogleSheetUrl,
  buildPubhtmlUrl,
  buildOpenUrl,
} from "./googleSheetUrl.js";

const ID = "1AbC_dEf-GhIjKlMnOpQrStUvWxYz0123456789";

describe("parseGoogleSheetUrl", () => {
  it("extrait id + gid d'une URL /edit#gid=", () => {
    expect(
      parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=42`),
    ).toEqual({ spreadsheetId: ID, gid: "42" });
  });

  it("extrait id + gid d'une URL /edit?gid=", () => {
    expect(
      parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?gid=7&foo=bar`),
    ).toEqual({ spreadsheetId: ID, gid: "7" });
  });

  it("défaut gid=0 sans gid dans l'URL", () => {
    expect(
      parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit`),
    ).toEqual({ spreadsheetId: ID, gid: "0" });
  });

  it("reconnaît la forme publiée /d/e/<id>", () => {
    const pub = "e/2PACX-1vABCdef_123-456";
    expect(
      parseGoogleSheetUrl(`https://docs.google.com/spreadsheets/d/${pub}/pubhtml?gid=9`),
    ).toEqual({ spreadsheetId: pub, gid: "9" });
  });

  it("tolère les espaces autour", () => {
    expect(
      parseGoogleSheetUrl(`  https://docs.google.com/spreadsheets/d/${ID}/edit  `),
    ).toEqual({ spreadsheetId: ID, gid: "0" });
  });

  it("renvoie null pour une URL non-Sheets", () => {
    expect(parseGoogleSheetUrl("https://example.com/foo")).toBeNull();
    expect(parseGoogleSheetUrl("https://docs.google.com/document/d/xyz/edit")).toBeNull();
    expect(parseGoogleSheetUrl("")).toBeNull();
    expect(parseGoogleSheetUrl("   ")).toBeNull();
  });
});

describe("buildPubhtmlUrl", () => {
  it("construit une URL pubhtml embarquable avec gid", () => {
    const url = buildPubhtmlUrl({ spreadsheetId: ID, gid: "42" });
    expect(url).toContain(`/spreadsheets/d/${ID}/pubhtml?`);
    expect(url).toContain("embedded=true");
    expect(url).toContain("widget=true");
    expect(url).toContain("single=true");
    expect(url).toContain("gid=42");
  });

  it("gère la forme publiée /d/e/<id>", () => {
    const url = buildPubhtmlUrl({ spreadsheetId: "e/2PACX-1vABC", gid: "0" });
    expect(url).toContain("/spreadsheets/d/e/2PACX-1vABC/pubhtml?");
  });
});

describe("buildOpenUrl", () => {
  it("ouvre l'éditeur pour un classeur normal", () => {
    expect(buildOpenUrl({ spreadsheetId: ID, gid: "42" })).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=42`,
    );
  });

  it("ouvre la vue publiée pour la forme /d/e/<id>", () => {
    expect(buildOpenUrl({ spreadsheetId: "e/2PACX-1vABC", gid: "0" })).toBe(
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vABC/pubhtml#gid=0",
    );
  });
});

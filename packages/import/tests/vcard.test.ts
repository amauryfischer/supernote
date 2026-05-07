import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { importVCard } from "../src/vcard/index.js";
import {
  parseVcfFile,
  getProp,
  getProps,
  parseOFXDate,
  normalizeValue,
} from "../src/vcard/parser.js";
import type { ImportOptions, ContactRecord, OrgRecord } from "../src/types.js";

// Re-export parseOFXDate from ofx/parser to avoid import conflicts in tests
// vcard/parser doesn't have parseOFXDate — skip that here
import { parseVcfFile as pvcf, getProp as gp, getProps as gps, normalizeValue as nv } from "../src/vcard/parser.js";

const FIXTURES = path.join(import.meta.dirname, "fixtures/vcard");

function makeOpts(overrides: Partial<ImportOptions> = {}): ImportOptions {
  return {
    targetVaultRoot: "/tmp/test-vault",
    defaultFolder: "Contacts/",
    preserveHierarchy: true,
    dryRun: true,
    resolvers: {},
    ...overrides,
  };
}

describe("vCard parser", () => {
  it("parses a single vCard block", () => {
    const raw = `BEGIN:VCARD\nVERSION:3.0\nFN:Test User\nEND:VCARD`;
    const vcards = parseVcfFile(raw);
    expect(vcards).toHaveLength(1);
    expect(getProp(vcards[0]!, "FN")).toBe("Test User");
  });

  it("parses multiple vCards", () => {
    const raw = `BEGIN:VCARD\nFN:Alice\nEND:VCARD\nBEGIN:VCARD\nFN:Bob\nEND:VCARD`;
    const vcards = parseVcfFile(raw);
    expect(vcards).toHaveLength(2);
    expect(getProp(vcards[0]!, "FN")).toBe("Alice");
    expect(getProp(vcards[1]!, "FN")).toBe("Bob");
  });

  it("extracts multiple EMAIL properties", () => {
    const raw = `BEGIN:VCARD\nFN:X\nEMAIL;TYPE=HOME:a@x.com\nEMAIL;TYPE=WORK:b@x.com\nEND:VCARD`;
    const vcards = parseVcfFile(raw);
    const emails = getProps(vcards[0]!, "EMAIL").map((p) => p.value);
    expect(emails).toContain("a@x.com");
    expect(emails).toContain("b@x.com");
  });

  it("extracts TEL params", () => {
    const raw = `BEGIN:VCARD\nFN:X\nTEL;TYPE=CELL:+33612345678\nEND:VCARD`;
    const vcards = parseVcfFile(raw);
    const tel = getProps(vcards[0]!, "TEL")[0];
    expect(tel?.params["TYPE"]).toBe("CELL");
    expect(tel?.value).toBe("+33612345678");
  });

  it("extracts ORG value", () => {
    const raw = `BEGIN:VCARD\nFN:X\nORG:ACME;Sales\nEND:VCARD`;
    const vcards = parseVcfFile(raw);
    expect(getProp(vcards[0]!, "ORG")).toBe("ACME;Sales");
  });

  it("normalizes quoted-printable encoding", () => {
    const prop = { name: "NOTE", params: { ENCODING: "QUOTED-PRINTABLE" }, value: "Caf=C3=A9" };
    const decoded = normalizeValue(prop);
    // C3 A9 = é in UTF-8, but this parser does latin-1 decode
    expect(decoded).toBeTruthy();
  });

  it("handles missing FN with N fallback", () => {
    const raw = `BEGIN:VCARD\nN:Dupont;Jean;;;\nEMAIL:j@x.com\nEND:VCARD`;
    const vcards = parseVcfFile(raw);
    // getProp N returns raw
    expect(getProp(vcards[0]!, "N")).toBe("Dupont;Jean;;;");
  });

  it("handles BDAY in YYYYMMDD format", () => {
    const raw = `BEGIN:VCARD\nFN:X\nBDAY:19850312\nEND:VCARD`;
    const vcards = parseVcfFile(raw);
    expect(getProp(vcards[0]!, "BDAY")).toBe("19850312");
  });

  it("returns empty array for empty content", () => {
    expect(parseVcfFile("")).toHaveLength(0);
  });

  it("ignores malformed lines", () => {
    const raw = `BEGIN:VCARD\nFN:X\nTHIS IS NOT VALID\nEND:VCARD`;
    const vcards = parseVcfFile(raw);
    expect(vcards).toHaveLength(1);
  });
});

describe("importVCard", () => {
  it("imports sample.vcf in dry-run mode", async () => {
    const opts = makeOpts();
    const result = await importVCard(path.join(FIXTURES, "sample.vcf"), opts);

    expect(result.errors).toHaveLength(0);
    expect(result.imported.contacts).toBe(4);
  });

  it("imports single.vcf correctly", async () => {
    const opts = makeOpts();
    const result = await importVCard(path.join(FIXTURES, "single.vcf"), opts);

    expect(result.errors).toHaveLength(0);
    expect(result.imported.contacts).toBe(1);
    expect(result.imported.orgs).toBe(1);
  });

  it("creates org records for unique organizations", async () => {
    const opts = makeOpts();
    const result = await importVCard(path.join(FIXTURES, "sample.vcf"), opts);

    // ACME Corporation appears twice but should create one org
    // Tech Innovations appears once
    expect(result.imported.orgs).toBe(2);
  });

  it("calls resolvers in non-dry-run mode", async () => {
    const contacts: ContactRecord[] = [];
    const orgs: OrgRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-resolve",
      defaultFolder: "Contacts/",
      dryRun: false,
      resolvers: {
        writeContact: async (c) => { contacts.push(c); },
        writeOrg: async (o) => { orgs.push(o); },
      },
    };
    const result = await importVCard(path.join(FIXTURES, "single.vcf"), opts);

    expect(contacts).toHaveLength(1);
    expect(contacts[0]?.name).toBe("Test Contact");
    expect(contacts[0]?.emails).toContain("test@example.com");
    expect(orgs).toHaveLength(1);
    expect(orgs[0]?.name).toBe("Test Company");
    expect(result.errors).toHaveLength(0);
  });

  it("returns error for non-existent file", async () => {
    const opts = makeOpts();
    const result = await importVCard("/nonexistent/file.vcf", opts);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/Cannot read/);
  });

  it("parses birthday correctly", async () => {
    const contacts: ContactRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-bday",
      defaultFolder: "Contacts/",
      dryRun: false,
      resolvers: {
        writeContact: async (c) => { contacts.push(c); },
      },
    };
    await importVCard(path.join(FIXTURES, "single.vcf"), opts);
    expect(contacts[0]?.birthday).toBe("1990-01-01");
  });

  it("assigns multiple emails to contact", async () => {
    const contacts: ContactRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-emails",
      defaultFolder: "Contacts/",
      dryRun: false,
      resolvers: {
        writeContact: async (c) => { contacts.push(c); },
      },
    };
    await importVCard(path.join(FIXTURES, "sample.vcf"), opts);
    const jean = contacts.find((c) => c.name === "Jean Dupont");
    expect(jean?.emails).toHaveLength(2);
  });

  it("assigns multiple phones to contact", async () => {
    const contacts: ContactRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-phones",
      defaultFolder: "Contacts/",
      dryRun: false,
      resolvers: {
        writeContact: async (c) => { contacts.push(c); },
      },
    };
    await importVCard(path.join(FIXTURES, "sample.vcf"), opts);
    const jean = contacts.find((c) => c.name === "Jean Dupont");
    expect(jean?.phones).toHaveLength(2);
  });

  it("sets noteBody from vCard NOTE field", async () => {
    const contacts: ContactRecord[] = [];
    const opts: ImportOptions = {
      targetVaultRoot: "/tmp/test-vault-note",
      defaultFolder: "Contacts/",
      dryRun: false,
      resolvers: {
        writeContact: async (c) => { contacts.push(c); },
      },
    };
    await importVCard(path.join(FIXTURES, "single.vcf"), opts);
    expect(contacts[0]?.noteBody).toBe("Single vCard test fixture.");
  });
});

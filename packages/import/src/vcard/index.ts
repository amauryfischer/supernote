import fs from "node:fs/promises";
import path from "node:path";
import type { ImportOptions, ImportResult, ContactRecord, OrgRecord } from "../types.js";
import {
  emptyResult,
  addError,
  incContacts,
  incOrgs,
} from "../utils/result.js";
import { generateId } from "../utils/id.js";
import { buildMarkdown } from "../utils/markdown.js";
import { logger } from "../utils/logger.js";
import {
  parseVcfFile,
  getProp,
  getProps,
  normalizeValue,
  type VCard,
} from "./parser.js";

/** Extract full name from vCard */
function extractName(vcard: VCard): string {
  const fn = getProp(vcard, "FN");
  if (fn) return fn.trim();

  const n = getProp(vcard, "N");
  if (n) {
    const parts = n.split(";").map((p) => p.trim()).filter(Boolean);
    return parts.slice(0, 2).reverse().join(" ");
  }

  return "Unknown Contact";
}

/** Extract all emails from vCard */
function extractEmails(vcard: VCard): string[] {
  return getProps(vcard, "EMAIL")
    .map((p) => normalizeValue(p).trim())
    .filter(Boolean);
}

/** Extract all phone numbers */
function extractPhones(vcard: VCard): string[] {
  return getProps(vcard, "TEL")
    .map((p) => normalizeValue(p).trim())
    .filter(Boolean);
}

/** Extract organization */
function extractOrg(vcard: VCard): string | undefined {
  const org = getProp(vcard, "ORG");
  if (!org) return undefined;
  // ORG may have multiple levels: Company;Department
  return org.split(";")[0]?.trim() || undefined;
}

/** Extract birthday */
function extractBirthday(vcard: VCard): string | undefined {
  const bday = getProp(vcard, "BDAY");
  if (!bday) return undefined;
  // Normalize to ISO date
  const clean = bday.replace(/[^0-9-]/g, "");
  if (clean.length === 8) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  }
  return clean || undefined;
}

/** Extract base64 photo data */
function extractPhoto(vcard: VCard): string | undefined {
  const props = getProps(vcard, "PHOTO");
  const photoProp = props.find(
    (p) => p.params["ENCODING"]?.toUpperCase() === "B" ||
           p.params["ENCODING"]?.toUpperCase() === "BASE64" ||
           p.params["VALUE"]?.toUpperCase() === "URI"
  );
  if (!photoProp) return undefined;

  const enc = photoProp.params["ENCODING"]?.toUpperCase();
  if (enc === "B" || enc === "BASE64") {
    const type = photoProp.params["TYPE"]?.toLowerCase() ?? "jpeg";
    return `data:image/${type};base64,${photoProp.value.replace(/\s/g, "")}`;
  }

  return photoProp.value || undefined;
}

/** Build note body from vCard NOTE field */
function buildNoteBody(vcard: VCard): string {
  const note = getProp(vcard, "NOTE");
  if (!note) return "";
  return normalizeValue({ name: "NOTE", params: {}, value: note }).trim();
}

/** Convert vCard to ContactRecord and write files */
async function processVCard(
  vcard: VCard,
  opts: ImportOptions,
  orgSet: Map<string, OrgRecord>
): Promise<ContactRecord | null> {
  const name = extractName(vcard);
  if (!name || name === "Unknown Contact") {
    logger.warn("Skipping vCard with no name");
    return null;
  }

  const id = generateId();
  const emails = extractEmails(vcard);
  const phones = extractPhones(vcard);
  const orgName = extractOrg(vcard);
  const birthday = extractBirthday(vcard);
  const photo = extractPhoto(vcard);
  const noteBody = buildNoteBody(vcard);

  // Register org if new
  if (orgName && !orgSet.has(orgName)) {
    const orgId = generateId();
    const folder = opts.defaultFolder ?? "Contacts/";
    orgSet.set(orgName, {
      id: orgId,
      filePath: path.join(opts.targetVaultRoot, "Organisations", `${orgName}.md`),
      name: orgName,
    });
  }

  const folder = opts.defaultFolder ?? "Contacts/";
  const safeName = name.replace(/[/\\:*?"<>|]/g, "-").slice(0, 150);
  const filePath = path.join(opts.targetVaultRoot, folder, `${safeName}.md`);

  const fields: Record<string, unknown> = {
    name,
    ...(emails.length > 0 && { email: emails }),
    ...(phones.length > 0 && { phone: phones }),
    ...(orgName && { organization: `[[${orgName}]]` }),
    ...(birthday && { birthday }),
    ...(photo && { photo }),
  };

  return {
    id,
    filePath,
    name,
    emails,
    phones,
    organization: orgName,
    birthday,
    photo,
    noteBody,
  };
}

/** Build markdown for a contact */
function buildContactMarkdown(record: ContactRecord): string {
  const fm: Record<string, unknown> = {
    id: record.id,
    type: "personne",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    source: "vcard",
    fields: {
      name: record.name,
      ...(record.emails.length > 0 && { email: record.emails }),
      ...(record.phones.length > 0 && { phone: record.phones }),
      ...(record.organization && { organization: `[[${record.organization}]]` }),
      ...(record.birthday && { birthday: record.birthday }),
      ...(record.photo && { photo: record.photo }),
    },
  };

  const body = record.noteBody || `# ${record.name}`;
  return buildMarkdown(fm, body);
}

/** Build markdown for an organisation */
function buildOrgMarkdown(org: OrgRecord): string {
  const fm: Record<string, unknown> = {
    id: org.id,
    type: "organisation",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    source: "vcard",
    fields: { name: org.name },
  };

  return buildMarkdown(fm, `# ${org.name}`);
}

/** Main vCard importer */
export async function importVCard(
  filePath: string,
  opts: ImportOptions
): Promise<ImportResult> {
  logger.info({ filePath }, "Starting vCard import");
  let result = emptyResult();

  let content: string;
  try {
    content = await fs.readFile(filePath, "utf-8");
  } catch (err) {
    return addError(emptyResult(), filePath, `Cannot read vCard file: ${String(err)}`, err);
  }

  const vcards = parseVcfFile(content);
  logger.info({ count: vcards.length }, "Parsed vCards");

  const orgSet = new Map<string, OrgRecord>();

  for (let i = 0; i < vcards.length; i++) {
    const vcard = vcards[i];
    if (!vcard) continue;
    try {
      const record = await processVCard(vcard, opts, orgSet);
      if (!record) {
        result = { ...result, skipped: result.skipped + 1 };
        continue;
      }

      if (!opts.dryRun) {
        await fs.mkdir(path.dirname(record.filePath), { recursive: true });
        await fs.writeFile(record.filePath, buildContactMarkdown(record), "utf-8");
        await opts.resolvers.writeContact?.(record);
      }
      result = incContacts(result);
      logger.debug({ name: record.name }, "Imported contact");
    } catch (err) {
      logger.error({ err, index: i }, "Error processing vCard");
      result = addError(result, `vcard[${i}]`, String(err), err);
    }
  }

  // Write all discovered orgs
  for (const [, org] of orgSet) {
    try {
      if (!opts.dryRun) {
        await fs.mkdir(path.dirname(org.filePath), { recursive: true });
        await fs.writeFile(org.filePath, buildOrgMarkdown(org), "utf-8");
        await opts.resolvers.writeOrg?.(org);
      }
      result = incOrgs(result);
      logger.debug({ name: org.name }, "Imported organisation");
    } catch (err) {
      result = addError(result, org.name, String(err), err);
    }
  }

  logger.info({ result }, "vCard import complete");
  return result;
}

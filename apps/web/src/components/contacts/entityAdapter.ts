/**
 * Adapts a tRPC EntitySummary / Entity to the local Contact interface.
 *
 * The Supernote entity model stores all domain fields in a `fields` record.
 * For a "personne" entity the expected keys are:
 *   name, emails (JSON), phones (JSON), organisationId, relationType,
 *   birthday, tags (JSON array), social (JSON), notes, lastInteractionDate, photoUrl.
 *
 * When tRPC is unavailable (browser / mode dégradé) callers fall back to
 * fixture data, so this adapter only runs when IPC is live.
 */

import type { EntitySummary, Entity, FieldValue } from "@supernote/ipc";
import type { Contact, Email, Phone, SocialLinks, RelationType } from "./fixtures";

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

// ── Public adapters ───────────────────────────────────────────────────────────

/** Matches a Crockford-style ULID basename (26 chars, [0-9A-Z]). Files
 *  created by the slash-menu "create-on-fly" path are named `<ULID>.md`,
 *  which would otherwise leak as a display name. */
const ULID_RE = /^[0-9A-Z]{26}$/;

/** Derive a safe display name from filePath when fields.name is missing.
 *  Strips the .md extension and any leading directories. Never falls back
 *  to entity.typeName / entity.typeId (which would surface "personne" /
 *  "Personne" / type slugs in the UI when the user expects a person's name).
 *  Also rejects ULID-shaped basenames (e.g. `00MOWIBR8J23MZG1QDFD.md`) so the
 *  caller can degrade to the localized "Sans nom" placeholder instead of
 *  showing a raw entity id to the user. */
function fallbackNameFromPath(filePath: string, typeId: string): string {
  const base = filePath.split("/").pop() ?? "";
  const stripped = base.replace(/\.[^.]+$/, "").trim();
  // If the filename is identical to the typeId (e.g. "personne.md"), or
  // matches the typeId case-insensitively, refuse — that's a structural slug,
  // not a human name.
  if (!stripped) return "";
  if (stripped.toLowerCase() === typeId.toLowerCase()) return "";
  // Reject ULID-shaped basenames — these are entity ids, not names.
  if (ULID_RE.test(stripped)) return "";
  return stripped;
}

/** Map an EntitySummary (no body) from tRPC to the Contact shape.
 *
 *  Display-name resolution order (the bug we keep fighting: `personne`
 *  surfacing as the contact's name):
 *    1. fields.name        — canonical for `personne` entities
 *    2. fields.title       — defensive: some imports / pickers use `title`
 *    3. fields.fullName    — defensive: vCard / CSV imports may use camelCase
 *    4. filePath basename  — only when it's not the typeId slug
 *    5. "Sans nom"         — last resort, never the typeId / typeName
 *
 *  We deliberately do NOT fall back to entity.typeName ("Personne") or
 *  entity.typeId ("personne"). Surfacing the type slug as the human name
 *  is the exact bug the user reports.
 */
export function entityToContact(entity: EntitySummary | Entity): Contact {
  const f = entity.fields;

  const candidates = [f["name"], f["title"], f["fullName"]];
  let name = "";
  for (const c of candidates) {
    const s = str(c).trim();
    if (s.length > 0) { name = s; break; }
  }
  if (!name) name = fallbackNameFromPath(entity.filePath, entity.typeId);
  if (!name) name = "Sans nom";

  // Aliases: stored as a JSON-encoded string array. Tolerate a raw array
  // (defensive: some import paths skip the JSON wrap) and a plain
  // comma/newline-separated string (legacy / hand-edited frontmatter).
  const aliasesRaw = f["aliases"];
  let aliases: string[] = [];
  if (Array.isArray(aliasesRaw)) {
    aliases = aliasesRaw.filter((a): a is string => typeof a === "string" && a.length > 0);
  } else if (typeof aliasesRaw === "string" && aliasesRaw.trim().length > 0) {
    const trimmed = aliasesRaw.trim();
    if (trimmed.startsWith("[")) {
      aliases = parseJsonField<string[]>(trimmed, []).filter(
        (a): a is string => typeof a === "string" && a.length > 0,
      );
    } else {
      aliases = trimmed
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
  }

  return {
    id: entity.id,
    name,
    photoUrl: str(f["photoUrl"]) || undefined,
    emails: parseJsonField<Email[]>(f["emails"], []),
    phones: parseJsonField<Phone[]>(f["phones"], []),
    organisationId: str(f["organisationId"]) || undefined,
    relationType: (str(f["relationType"]) as RelationType) || "connaissance",
    birthday: str(f["birthday"]) || undefined,
    tags: Array.isArray(entity.tags) ? entity.tags : parseJsonField<string[]>(f["tags"], []),
    aliases,
    social: parseJsonField<SocialLinks>(f["social"], {}),
    notes: "body" in entity ? entity.body : str(f["notes"]),
    lastInteractionDate: str(f["lastInteractionDate"]) || undefined,
  };
}

/** Map EntitySummary[] to Contact[] (list view). */
export function entitiesToContacts(entities: EntitySummary[]): Contact[] {
  return entities.map(entityToContact);
}

/** Build the fields record for entities.create from form state. */
export interface ContactFormFields {
  name: string;
  emails: Email[];
  phones: Phone[];
  birthday?: string;
  organisationId?: string;
  relationType: RelationType;
  linkedin?: string;
  twitter?: string;
  github?: string;
  tags: string[];
  aliases?: string[];
  notes: string;
}

export function contactFormToEntityFields(
  form: ContactFormFields,
): Record<string, FieldValue> {
  return {
    name: form.name,
    emails: JSON.stringify(form.emails),
    phones: JSON.stringify(form.phones),
    birthday: form.birthday ?? "",
    organisationId: form.organisationId ?? "",
    relationType: form.relationType,
    aliases: JSON.stringify(form.aliases ?? []),
    social: JSON.stringify({
      linkedin: form.linkedin ?? "",
      twitter: form.twitter ?? "",
      github: form.github ?? "",
    }),
    notes: form.notes,
    lastInteractionDate: "",
  };
}

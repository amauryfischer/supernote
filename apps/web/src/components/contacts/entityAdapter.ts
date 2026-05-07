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

/** Map an EntitySummary (no body) from tRPC to the Contact shape. */
export function entityToContact(entity: EntitySummary | Entity): Contact {
  const f = entity.fields;
  return {
    id: entity.id,
    name: str(f["name"]) || entity.typeName,
    photoUrl: str(f["photoUrl"]) || undefined,
    emails: parseJsonField<Email[]>(f["emails"], []),
    phones: parseJsonField<Phone[]>(f["phones"], []),
    organisationId: str(f["organisationId"]) || undefined,
    relationType: (str(f["relationType"]) as RelationType) || "connaissance",
    birthday: str(f["birthday"]) || undefined,
    tags: Array.isArray(entity.tags) ? entity.tags : parseJsonField<string[]>(f["tags"], []),
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
    social: JSON.stringify({
      linkedin: form.linkedin ?? "",
      twitter: form.twitter ?? "",
      github: form.github ?? "",
    }),
    notes: form.notes,
    lastInteractionDate: "",
  };
}

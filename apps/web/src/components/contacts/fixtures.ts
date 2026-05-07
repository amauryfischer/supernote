/**
 * Mock data for the Contacts CRM page.
 * Default: empty. Use demo-fixtures.ts for demo data.
 */

export type RelationType =
  | "ami"
  | "famille"
  | "collègue"
  | "client"
  | "mentor"
  | "connaissance"
  | "partenaire";

export type InteractionKind =
  | "réunion"
  | "appel"
  | "email"
  | "déjeuner"
  | "message"
  | "note";

export interface Organisation {
  id: string;
  name: string;
  industry: string;
  website?: string;
}

export interface Email {
  value: string;
  label: "pro" | "perso" | "autre";
}

export interface Phone {
  value: string;
  label: "mobile" | "fixe" | "pro";
}

export interface SocialLinks {
  linkedin?: string;
  twitter?: string;
  github?: string;
}

export interface Interaction {
  id: string;
  contactId: string;
  date: string;
  kind: InteractionKind;
  title: string;
  notes?: string;
}

export interface Contact {
  id: string;
  name: string;
  photoUrl?: string;
  emails: Email[];
  phones: Phone[];
  organisationId?: string;
  relationType: RelationType;
  birthday?: string;
  tags: string[];
  social: SocialLinks;
  notes: string;
  lastInteractionDate?: string;
}

export const ORGANISATIONS: Organisation[] = [];

export const CONTACTS: Contact[] = [];

export const INTERACTIONS: Interaction[] = [];

/**
 * Mail templates ("template blocks") — modèles réutilisables insérables au
 * compose : soit un email complet (objet + corps), soit juste une signature.
 *
 * Persistance : localStorage typé (clé `supernote.mail.templates`), même esprit
 * que `EmailComposer`/`DEFAULT_EMAIL_KEY` — self-contained, pas de dépendance au
 * schéma `AppSettings`. Toute la logique (CRUD, parse, application au compose)
 * est PURE et testée ; l'I/O localStorage est isolée dans load/save.
 */

import { newId } from "@supernote/core";

export type MailTemplateKind = "email" | "signature";

export interface MailTemplate {
  id: string;
  name: string;
  kind: MailTemplateKind;
  /** Objet — pertinent pour kind "email" ; ignoré pour "signature". */
  subject?: string;
  body: string;
}

/** Délimiteur de signature standard (RFC 3676) — cohérent avec `email-quote`. */
export const SIGNATURE_DELIMITER = "\n-- \n";

const STORAGE_KEY = "supernote.mail.templates";

// ─── Logique pure ─────────────────────────────────────────────────────────────

/** Crée un template vierge (id ulid). `subject` présent seulement pour "email". */
export function createTemplate(kind: MailTemplateKind): MailTemplate {
  return kind === "email"
    ? { id: newId(), name: "Nouveau modèle", kind, subject: "", body: "" }
    : { id: newId(), name: "Nouvelle signature", kind, body: "" };
}

/** Insère (nouveau) ou remplace (même id) un template. Retourne une NOUVELLE liste. */
export function upsertTemplate(list: MailTemplate[], t: MailTemplate): MailTemplate[] {
  const i = list.findIndex((x) => x.id === t.id);
  if (i === -1) return [...list, t];
  const next = list.slice();
  next[i] = t;
  return next;
}

/** Retire un template par id. Retourne une NOUVELLE liste. */
export function removeTemplate(list: MailTemplate[], id: string): MailTemplate[] {
  return list.filter((t) => t.id !== id);
}

/** Ajoute une signature au corps via le délimiteur standard (idempotent côté délimiteur). */
export function appendSignature(body: string, signature: string): string {
  const sig = signature.trim();
  if (!sig) return body;
  const base = body.replace(/\s+$/, "");
  return base ? `${base}${SIGNATURE_DELIMITER}${sig}` : `${SIGNATURE_DELIMITER.replace(/^\n/, "")}${sig}`;
}

/** Concatène un bloc au corps existant (séparation par ligne vide). */
export function appendBlock(body: string, block: string): string {
  const b = block.trim();
  if (!b) return body;
  const base = body.replace(/\s+$/, "");
  return base ? `${base}\n\n${b}` : b;
}

export interface ComposeDraft {
  subject: string;
  body: string;
}

/**
 * Applique un template à un brouillon en cours (pur, non destructif) :
 * - "signature" → ajoute la signature au corps via le délimiteur ; objet inchangé.
 * - "email" → ajoute le corps comme nouveau bloc ; remplit l'objet seulement s'il
 *   est encore vide (ne clobber jamais un objet déjà saisi).
 */
export function applyTemplate(current: ComposeDraft, t: MailTemplate): ComposeDraft {
  if (t.kind === "signature") {
    return { subject: current.subject, body: appendSignature(current.body, t.body) };
  }
  const subject = current.subject.trim() ? current.subject : (t.subject ?? "");
  return { subject, body: appendBlock(current.body, t.body) };
}

// ─── Sérialisation (pure, testable) ───────────────────────────────────────────

function isKind(v: unknown): v is MailTemplateKind {
  return v === "email" || v === "signature";
}

/** Parse du JSON brut → liste validée (entrées malformées rejetées). */
export function parseTemplates(raw: string): MailTemplate[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: MailTemplate[] = [];
  for (const item of data) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !r.id) continue;
    if (typeof r.name !== "string") continue;
    if (!isKind(r.kind)) continue;
    if (typeof r.body !== "string") continue;
    const t: MailTemplate = { id: r.id, name: r.name, kind: r.kind, body: r.body };
    if (r.kind === "email" && typeof r.subject === "string") t.subject = r.subject;
    out.push(t);
  }
  return out;
}

export function serializeTemplates(list: MailTemplate[]): string {
  return JSON.stringify(list);
}

// ─── I/O localStorage ─────────────────────────────────────────────────────────

export function loadTemplates(): MailTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? parseTemplates(raw) : [];
  } catch {
    return [];
  }
}

export function saveTemplates(list: MailTemplate[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeTemplates(list));
  } catch {
    /* quota / private mode — best-effort */
  }
}

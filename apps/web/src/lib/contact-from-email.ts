/**
 * Pré-remplissage d'un contact `personne` depuis l'expéditeur d'un email.
 *
 * Heuristiques déterministes (nom affiché, partie locale, domaine, signature)
 * et rapprochement avec le coffre (contact au même email, organisation au même
 * domaine ou au nom proche). L'IA locale ne fait que compléter : voir
 * `buildContactPrompt` / `parseContactAiResponse`. Pur, sans React ni IPC.
 */

import { parseEmailBody } from "./email-quote";
import { parseSignatureBlock } from "./signature-extract";

export interface ContactDraft {
  firstName: string;
  lastName: string;
  email: string;
  organisation: string;
  role: string;
  phone: string;
  website: string;
  linkedin: string;
}

export interface EmailContactGuess {
  draft: ContactDraft;
  /** Domaine professionnel de l'expéditeur, vide pour un webmail. */
  domain: string;
  /** noreply, notifications… : probablement pas une personne. */
  automated: boolean;
  phoneLabel: "mobile" | "fixe";
  /** Texte fourni à l'IA : signature, sinon fin de la réponse (citation retirée). */
  signature: string;
}

export interface EntityRow {
  id: string;
  fields: Record<string, unknown>;
}

// ─── Normalisation ──────────────────────────────────────────────────────────

const PARTICLES = new Set([
  "de", "du", "des", "d'", "le", "la", "les", "van", "von", "der", "den",
  "da", "di", "del", "della", "dos", "das", "et", "en", "of", "the", "and",
]);

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Clé de comparaison : sans accents, sans casse, sans ponctuation. */
export function looseKey(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function capitalize(w: string): string {
  return w.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

// Casse d'origine conservée si mixte (« McDonald ») : on ne corrige que le tout-majuscule / tout-minuscule.
function fixCase(w: string, index: number): string {
  if (w !== w.toUpperCase() && w !== w.toLowerCase()) return w;
  if (index > 0 && PARTICLES.has(w.toLowerCase())) return w.toLowerCase();
  return capitalize(w);
}

function fixCaseWords(words: string[]): string {
  return words.map(fixCase).join(" ");
}

// ─── Nom ────────────────────────────────────────────────────────────────────

interface PersonName {
  first: string;
  last: string;
}

/** « Prénom Nom », « NOM Prénom », « Nom, Prénom ». Null si moins de deux mots. */
export function splitPersonName(raw: string): PersonName | null {
  const s = raw.trim();
  if (!s || s.includes("@")) return null;
  const comma = s.split(",").map((p) => p.trim());
  if (comma.length === 2 && comma[0] && comma[1]) {
    return { first: fixCaseWords(comma[1].split(/\s+/)), last: fixCaseWords(comma[0].split(/\s+/)) };
  }
  const words = s.split(/\s+/);
  if (words.length < 2) return null;
  // Convention française : le nom de famille est souvent écrit en capitales.
  const isUpper = (w: string) => w.length >= 2 && /\p{L}/u.test(w) && w === w.toUpperCase();
  const upper = words.filter(isUpper);
  if (upper.length > 0 && upper.length < words.length) {
    return { first: fixCaseWords(words.filter((w) => !isUpper(w))), last: fixCaseWords(upper) };
  }
  return { first: fixCase(words[0]!, 0), last: words.slice(1).map((w, i) => fixCase(w, i + 1)).join(" ") };
}

/** Sépare le nom affiché d'un éventuel indice d'organisation (« X via Y », « X — Y », « X (Y) »). */
function cleanDisplayName(raw: string): { person: string; orgHint: string } {
  const s = raw.replace(/^["'\s]+|["'\s]+$/g, "");
  if (s.includes("@")) return { person: "", orgHint: "" };
  const via = s.match(/^(.+?)\s+via\s+(.+)$/i);
  if (via) return { person: via[1]!.trim(), orgHint: via[2]!.trim() };
  const paren = s.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (paren) return { person: paren[1]!.trim(), orgHint: paren[2]!.trim() };
  const sep = s.match(/\s+(?:[—–|·]|-)\s+/);
  if (sep && sep.index !== undefined) {
    return { person: s.slice(0, sep.index).trim(), orgHint: s.slice(sep.index + sep[0].length).trim() };
  }
  return { person: s, orgHint: "" };
}

/**
 * `prenom.nom`, `p.nom`, `prenom_nom`, `prenom-nom` ; `nom.prenom` reconnu seulement
 * si le nom affiché (un seul mot) désigne la seconde partie. Sans indice, l'ordre
 * prénom.nom est supposé : c'est la convention la plus courante.
 */
function splitLocalPart(local: string, hint: string): PersonName | null {
  const clean = local.split("+")[0]!.replace(/\d+/g, "");
  let parts = clean.split(/[._]/).filter(Boolean);
  if (parts.length < 2) parts = clean.split("-").filter(Boolean);
  if (parts.length < 2) return null;
  const h = looseKey(hint);
  const matches = (p: string) => !!h && (looseKey(p) === h || (p.length === 1 && h.startsWith(p.toLowerCase())));
  const i = parts.findIndex(matches);
  const firstIdx = i === -1 ? 0 : i;
  const first = i === -1 ? parts[0]! : hint;
  const rest = parts.filter((_, k) => k !== firstIdx);
  return {
    first: first.length === 1 ? `${first.toUpperCase()}.` : fixCase(first, 0),
    last: rest.map((w, k) => fixCase(w, k + 1)).join(" "),
  };
}

// ─── Domaine & organisation ─────────────────────────────────────────────────

const WEBMAIL_LABELS = new Set([
  "gmail", "googlemail", "hotmail", "outlook", "live", "msn", "yahoo", "ymail",
  "icloud", "aol", "gmx", "proton", "protonmail", "wanadoo", "neuf", "bbox",
  "yandex", "tutanota", "fastmail", "zoho",
]);
const WEBMAIL_DOMAINS = new Set([
  "orange.fr", "free.fr", "sfr.fr", "laposte.net", "me.com", "mac.com", "pm.me",
  "mail.com", "hey.com", "club-internet.fr", "numericable.fr", "aliceadsl.fr",
]);
// Suffixes publics à deux niveaux (gouv.fr, co.uk…) : l'organisation est le label d'avant.
const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "gouv", "ac", "edu", "asso", "nom"]);

const AUTOMATED_LOCAL =
  /(^|[._+-])(no-?reply|do-?not-?reply|ne-?pas-?repondre|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?|newsletters?|digest|automated|robot)([._+-]|$)/i;
const GENERIC_LOCAL =
  /^(contact|info|infos|information|hello|bonjour|admin|support|help|aide|sales|ventes?|commercial|compta|comptabilite|facturation|factures?|billing|invoices?|rh|hr|jobs|recrutement|careers|accueil|secretariat|direction|office|team|equipe|services?|communication|presse|press|marketing|webmaster|reservations?|booking)$/i;

function registrableLabel(domain: string): string {
  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return labels[0] ?? "";
  const twoLevel = labels.length >= 3 && SECOND_LEVEL.has(labels.at(-2)!) && labels.at(-1)!.length === 2;
  return labels[labels.length - (twoLevel ? 3 : 2)]!;
}

/**
 * Label de domaine → nom lisible : tirets en espaces, mots de ≤ 3 lettres ou
 * sans voyelle en sigle, particules en minuscules.
 * `vortex-io` → « Vortex IO », `sgzds` → « SGZDS », `banque-de-france` → « Banque de France ».
 */
export function prettyOrgName(label: string): string {
  return label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w, i) => {
      if (PARTICLES.has(w)) return i > 0 ? w : capitalize(w);
      if (w.length <= 3 || !/[aeiouy]/.test(w)) return w.toUpperCase();
      return capitalize(w);
    })
    .join(" ");
}

// ─── Devinette complète ─────────────────────────────────────────────────────

export function guessContactFromEmail(
  from: { name: string; email: string },
  bodyText: string,
): EmailContactGuess {
  const email = from.email.trim().toLowerCase();
  const [local = "", fullDomain = ""] = email.split("@");
  const label = registrableLabel(fullDomain);
  const webmail = WEBMAIL_LABELS.has(label) || WEBMAIL_DOMAINS.has(fullDomain);
  const automated = AUTOMATED_LOCAL.test(local) || local.includes("noreply");
  const generic = automated || GENERIC_LOCAL.test(local);

  const { person, orgHint } = cleanDisplayName(from.name ?? "");
  // contact@cabinet-martin.fr signé « Cabinet Comptable Martin » : le nom affiché est l'organisation.
  const personIsOrg = !person || looseKey(person) === looseKey(label) || (generic && !orgHint);
  let names: PersonName | null = personIsOrg ? null : splitPersonName(person);
  if (!names && !generic) names = splitLocalPart(local, personIsOrg ? "" : person);
  if (!names && !personIsOrg) names = { first: fixCase(person, 0), last: "" };

  const { body, signature } = parseEmailBody(bodyText);
  const sig = parseSignatureBlock(signature || body);
  const orgFromName = personIsOrg ? person : orgHint;

  return {
    draft: {
      firstName: names?.first ?? "",
      lastName: names?.last ?? "",
      email,
      organisation: sig.company || orgFromName || (webmail || !label ? "" : prettyOrgName(label)),
      role: sig.role ?? "",
      phone: sig.mobile ?? sig.phone ?? "",
      website: sig.website || (webmail || !fullDomain ? "" : `https://${fullDomain}`),
      linkedin: sig.linkedin ?? "",
    },
    domain: webmail ? "" : fullDomain,
    automated,
    phoneLabel: sig.mobile ? "mobile" : "fixe",
    signature: signature || body.slice(-800),
  };
}

// ─── Rapprochement avec le coffre ───────────────────────────────────────────

function parseJsonList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string" || !v.trim().startsWith("[")) return [];
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function jsonValues(v: unknown): string[] {
  return parseJsonList(v)
    .map((e) => (e && typeof e === "object" ? str((e as Record<string, unknown>).value) : str(e)))
    .filter(Boolean);
}

function socialLinkedin(v: unknown): string {
  if (typeof v !== "string" || !v.trim().startsWith("{")) return "";
  try {
    const parsed: unknown = JSON.parse(v);
    return parsed && typeof parsed === "object" ? str((parsed as Record<string, unknown>).linkedin) : "";
  } catch {
    return "";
  }
}

/** Les deux vocabulaires du type `personne` coexistent : `email` (bases) et `emails` JSON (fiche contact). */
export function contactEmails(fields: Record<string, unknown>): string[] {
  return [str(fields.email), ...jsonValues(fields.emails)].map((e) => e.toLowerCase()).filter(Boolean);
}

export function contactPhones(fields: Record<string, unknown>): string[] {
  return [str(fields.phone), ...jsonValues(fields.phones)].filter(Boolean);
}

export function contactLinkedin(fields: Record<string, unknown>): string {
  return str(fields.linkedin) || socialLinkedin(fields.social);
}

export function entityName(row: EntityRow): string {
  return str(row.fields.name);
}

export function joinName(d: Pick<ContactDraft, "firstName" | "lastName">): string {
  return [d.firstName.trim(), d.lastName.trim()].filter(Boolean).join(" ");
}

export type ContactMatch<T extends EntityRow = EntityRow> = { row: T; by: "email" | "nom" } | null;

/** Même email d'abord ; à défaut, même nom complet (deux mots minimum). */
export function findContactMatch<T extends EntityRow>(contacts: T[], email: string, fullName: string): ContactMatch<T> {
  const e = email.trim().toLowerCase();
  const byEmail = e ? contacts.find((c) => contactEmails(c.fields).includes(e)) : undefined;
  if (byEmail) return { row: byEmail, by: "email" };
  if (fullName.trim().split(/\s+/).length < 2) return null;
  const key = looseKey(fullName);
  const byName = contacts.find((c) => looseKey(entityName(c)) === key);
  return byName ? { row: byName, by: "nom" } : null;
}

function hostOf(url: string): string {
  if (!url) return "";
  try {
    return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Organisation déjà liée aux collègues du même domaine (la plus fréquente),
 * sinon organisation dont le site web porte ce domaine.
 */
export function findOrgForDomain(contacts: EntityRow[], orgs: EntityRow[], domain: string): EntityRow | null {
  if (!domain) return null;
  const byId = new Map(orgs.map((o) => [o.id, o]));
  const counts = new Map<string, number>();
  for (const c of contacts) {
    const orgId = str(c.fields.organisationId);
    if (!byId.has(orgId)) continue;
    if (contactEmails(c.fields).some((e) => e.endsWith(`@${domain}`))) {
      counts.set(orgId, (counts.get(orgId) ?? 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) return byId.get(best[0]) ?? null;
  return (
    orgs.find((o) => {
      const host = hostOf(str(o.fields.website));
      return !!host && (domain === host || domain.endsWith(`.${host}`));
    }) ?? null
  );
}

function orgKey(name: string): string {
  return looseKey(name.replace(/\b(sas|sasu|sarl|eurl|sa|inc|ltd|llc|gmbh|group|groupe)\b\.?/gi, ""));
}

/** Nom identique (hors accents, casse, forme juridique), sinon préfixe commun d'au moins 4 caractères. */
export function findOrgByName(orgs: EntityRow[], name: string): EntityRow | null {
  const key = orgKey(name);
  if (key.length < 2) return null;
  const exact = orgs.find((o) => orgKey(entityName(o)) === key);
  if (exact) return exact;
  if (key.length < 4) return null;
  return (
    orgs.find((o) => {
      const k = orgKey(entityName(o));
      return k.length >= 4 && (k.startsWith(key) || key.startsWith(k));
    }) ?? null
  );
}

/** Valeurs actuelles d'un contact existant, dans la forme du formulaire. */
export function draftFromContact(row: EntityRow, orgs: EntityRow[], email: string): ContactDraft {
  const f = row.fields;
  const name = entityName(row);
  const split = splitPersonName(name);
  const org = orgs.find((o) => o.id === str(f.organisationId));
  return {
    firstName: split?.first ?? name,
    lastName: split?.last ?? "",
    email: contactEmails(f)[0] ?? email,
    organisation: (org && entityName(org)) || str(f.company),
    role: str(f.role),
    phone: contactPhones(f)[0] ?? "",
    website: "",
    linkedin: contactLinkedin(f),
  };
}

// ─── IA locale ──────────────────────────────────────────────────────────────

const AI_KEYS = ["firstName", "lastName", "organisation", "role", "phone", "website", "linkedin"] as const;
export type AiContactKey = (typeof AI_KEYS)[number];

/** Texte brut uniquement (bodyText, jamais de HTML) : l'en-tête From et la signature. */
export function buildContactPrompt(from: { name: string; email: string }, signature: string): string {
  return [
    "Tu remplis la fiche contact de l'EXPÉDITEUR d'un email.",
    "Réponds UNIQUEMENT avec cet objet JSON, sans texte autour :",
    '{"firstName":"","lastName":"","organisation":"","role":"","phone":"","website":"","linkedin":""}',
    '- Laisse "" toute information absente : n\'invente rien.',
    "- organisation = l'employeur de l'expéditeur (jamais un webmail comme Gmail).",
    "- role = son intitulé de poste.",
    "",
    `Expéditeur : ${from.name} <${from.email}>`,
    "Signature :",
    signature.slice(0, 1500),
  ].join("\n");
}

function parseObject(raw: string): Record<string, unknown> | null {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v: unknown = JSON.parse(s);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const greedy = raw.match(/\{[\s\S]*\}/);
  if (greedy) {
    const whole = tryParse(greedy[0]);
    if (whole) return whole;
  }
  // Modèles « à réflexion » : du texte entre accolades peut précéder la réponse, on garde le dernier objet valide.
  const flat = raw.match(/\{[^{}]*\}/g) ?? [];
  for (let i = flat.length - 1; i >= 0; i--) {
    const obj = tryParse(flat[i]!);
    if (obj) return obj;
  }
  return null;
}

/** Garde seulement des chaînes courtes et plausibles : la sortie du modèle n'est pas fiable. */
export function parseContactAiResponse(raw: string): Partial<Record<AiContactKey, string>> {
  const obj = parseObject(raw ?? "");
  if (!obj) return {};
  const out: Partial<Record<AiContactKey, string>> = {};
  for (const k of AI_KEYS) {
    const s = str(obj[k]);
    if (s && s.length <= 120 && !s.includes("@") && !/[<>]/.test(s)) out[k] = s;
  }
  const digits = (out.phone ?? "").replace(/\D/g, "").length;
  if (out.phone && (digits < 8 || digits > 15 || !/^[+\d\s().\/-]+$/.test(out.phone))) delete out.phone;
  if (out.website && !/^(https?:\/\/)?[\w-]+(\.[\w-]+)+/i.test(out.website)) delete out.website;
  if (out.linkedin && !/linkedin\.[a-z]+\//i.test(out.linkedin)) delete out.linkedin;
  if (out.website && !/^https?:\/\//i.test(out.website)) out.website = `https://${out.website}`;
  if (out.linkedin && !/^https?:\/\//i.test(out.linkedin)) out.linkedin = `https://${out.linkedin}`;
  return out;
}
